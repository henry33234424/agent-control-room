import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import type { CreateRoomRequest } from '@control-room/shared-types';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { toRoomDto, toSessionDto, toMessageDto, toPinDto } from '../lib/dto.js';
import { removeWorktree } from '@control-room/git-worktree';
import { approvalService } from '../services/approval-service.js';

const RECENT_MESSAGE_LIMIT = 200;

export async function roomRoutes(app: FastifyInstance) {
  // Create room
  app.post<{ Body: CreateRoomRequest }>('/api/rooms', async (req, reply) => {
    const { name, repoPath, defaultBranch } = req.body;

    if (!existsSync(repoPath)) {
      return reply.status(400).send({ error: `Path does not exist: ${repoPath}` });
    }
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd: repoPath, stdio: 'pipe' });
    } catch {
      return reply.status(400).send({ error: `Not a git repository: ${repoPath}` });
    }

    const room = await prisma.room.create({
      data: { name, repoPath, defaultBranch: defaultBranch ?? 'main' },
    });

    return toRoomDto(room);
  });

  // Get room with snapshot
  app.get<{ Params: { roomId: string } }>('/api/rooms/:roomId', async (req, reply) => {
    const room = await prisma.room.findUnique({
      where: { id: req.params.roomId },
      include: {
        sessions: { orderBy: { updatedAt: 'desc' } },
        chatMessages: { orderBy: { createdAt: 'desc' }, take: RECENT_MESSAGE_LIMIT },
        pinnedBriefItems: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!room) return reply.status(404).send({ error: 'Room not found' });

    const pendingApprovals = await approvalService.listPendingByRoom(req.params.roomId);

    return {
      room: toRoomDto(room),
      sessions: room.sessions.map(toSessionDto),
      recentMessages: room.chatMessages.reverse().map(toMessageDto),
      pinnedBrief: room.pinnedBriefItems.map(toPinDto),
      pendingApprovals,
    };
  });

  // List rooms
  app.get('/api/rooms', async () => {
    const rooms = await prisma.room.findMany({ orderBy: { updatedAt: 'desc' } });
    return rooms.map(toRoomDto);
  });

  // Delete room and all associated data
  app.delete<{ Params: { roomId: string } }>('/api/rooms/:roomId', async (req, reply) => {
    const { roomId } = req.params;
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) return reply.status(404).send({ error: 'Room not found' });

    // Fix #1: Reject if any run is still active
    const activeRuns = await prisma.run.findMany({
      where: { roomId, status: { in: ['queued', 'preparing', 'running', 'waitingApproval', 'waitingUserInput', 'summarizing'] } },
    });
    if (activeRuns.length > 0) {
      return reply.status(409).send({
        error: `Cannot delete: ${activeRuns.length} run(s) still active. Wait for them to finish or cancel first.`,
      });
    }

    // Fix #2: Clean up actual git worktrees on disk
    const worktrees = await prisma.worktree.findMany({ where: { roomId } });
    for (const wt of worktrees) {
      try {
        removeWorktree(room.repoPath, wt.path);
      } catch {
        // Best-effort cleanup — don't block deletion
      }
    }

    // Delete DB records in dependency order
    await prisma.handoffBundleMessageLink.deleteMany({ where: { bundle: { roomId } } });
    await prisma.handoffBundle.deleteMany({ where: { roomId } });
    await prisma.pinnedBriefHistory.deleteMany({ where: { roomId } });
    await prisma.pinnedBriefItem.deleteMany({ where: { roomId } });
    await prisma.runtimeEvent.deleteMany({ where: { roomId } });
    await prisma.artifact.deleteMany({ where: { roomId } });
    await prisma.approval.deleteMany({ where: { roomId } });
    await prisma.run.deleteMany({ where: { roomId } });
    await prisma.chatMessage.deleteMany({ where: { roomId } });
    await prisma.agentSession.deleteMany({ where: { roomId } });
    await prisma.worktree.deleteMany({ where: { roomId } });
    await prisma.room.delete({ where: { id: roomId } });

    return { ok: true };
  });
}
