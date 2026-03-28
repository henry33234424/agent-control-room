import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import type { CreateSessionRequest, UpdateSessionRequest } from '@control-room/shared-types';
import { toSessionDto } from '../lib/dto.js';
import { roomChannel } from '../ws/room-channel.js';
import { ptyManager } from '../ws/pty-manager.js';
import { removeWorktree } from '@control-room/git-worktree';

function normalizeSessionName(name: string): string {
  return name.trim().toLowerCase();
}

async function hasSessionNameConflict(
  roomId: string,
  name: string,
  excludeSessionId?: string,
): Promise<boolean> {
  const sessions = await prisma.agentSession.findMany({
    where: { roomId },
    select: { id: true, name: true },
  });

  const normalized = normalizeSessionName(name);
  return sessions.some(
    (session) =>
      session.id !== excludeSessionId && normalizeSessionName(session.name) === normalized,
  );
}

export async function sessionRoutes(app: FastifyInstance) {
  app.post<{ Params: { roomId: string }; Body: CreateSessionRequest }>(
    '/api/rooms/:roomId/sessions',
    async (req, reply) => {
      const { roomId } = req.params;
      const { agent, mode } = req.body;
      const name = req.body.name.trim();

      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room) return reply.status(404).send({ error: 'Room not found' });
      if (!name) return reply.status(400).send({ error: 'Session name is required' });
      if (await hasSessionNameConflict(roomId, name)) {
        return reply.status(409).send({ error: 'Session name already exists in this project' });
      }

      const session = await prisma.agentSession.create({
        data: { roomId, agent, name, mode: mode ?? 'readWrite' },
      });

      const dto = toSessionDto(session);

      // Broadcast so left sidebar updates in real time
      roomChannel.broadcast(roomId, { type: 'session.updated', data: dto });

      return dto;
    },
  );

  app.get<{ Params: { roomId: string } }>(
    '/api/rooms/:roomId/sessions',
    async (req) => {
      const sessions = await prisma.agentSession.findMany({
        where: { roomId: req.params.roomId },
        orderBy: { updatedAt: 'desc' },
      });
      return sessions.map(toSessionDto);
    },
  );

  app.patch<{ Params: { roomId: string; sessionId: string }; Body: UpdateSessionRequest }>(
    '/api/rooms/:roomId/sessions/:sessionId',
    async (req, reply) => {
      const { roomId, sessionId } = req.params;
      const name = req.body.name.trim();
      if (!name) return reply.status(400).send({ error: 'Session name is required' });

      const existing = await prisma.agentSession.findFirst({
        where: { id: sessionId, roomId },
      });
      if (!existing) return reply.status(404).send({ error: 'Session not found' });
      if (await hasSessionNameConflict(roomId, name, sessionId)) {
        return reply.status(409).send({ error: 'Session name already exists in this project' });
      }

      const updated = await prisma.agentSession.update({
        where: { id: sessionId },
        data: { name },
      });

      const dto = toSessionDto(updated);
      roomChannel.broadcast(roomId, { type: 'session.updated', data: dto });
      return dto;
    },
  );

  app.delete<{ Params: { roomId: string; sessionId: string } }>(
    '/api/rooms/:roomId/sessions/:sessionId',
    async (req, reply) => {
      const { roomId, sessionId } = req.params;

      const session = await prisma.agentSession.findFirst({
        where: { id: sessionId, roomId },
      });
      if (!session) return reply.status(404).send({ error: 'Session not found' });

      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room) return reply.status(404).send({ error: 'Room not found' });

      const activeRuns = await prisma.run.findMany({
        where: {
          agentSessionId: sessionId,
          status: { in: ['queued', 'preparing', 'running', 'waitingApproval', 'waitingUserInput', 'summarizing'] },
        },
      });
      if (activeRuns.length > 0) {
        return reply.status(409).send({
          error: `Cannot delete: ${activeRuns.length} run(s) still active in this session. Wait for them to finish or cancel first.`,
        });
      }

      ptyManager.kill(sessionId);

      let worktreeToDelete: { id: string; path: string } | null = null;
      if (session.worktreeId) {
        const boundSessions = await prisma.agentSession.count({
          where: { worktreeId: session.worktreeId },
        });
        if (boundSessions <= 1) {
          const worktree = await prisma.worktree.findUnique({ where: { id: session.worktreeId } });
          if (worktree) {
            worktreeToDelete = { id: worktree.id, path: worktree.path };
          }
        }
      }

      await prisma.handoffBundleMessageLink.deleteMany({
        where: { message: { sessionId } },
      });
      await prisma.chatMessage.deleteMany({ where: { sessionId } });
      await prisma.runtimeEvent.deleteMany({ where: { sessionId } });
      await prisma.artifact.deleteMany({ where: { sessionId } });
      await prisma.approval.deleteMany({ where: { run: { agentSessionId: sessionId } } });
      await prisma.run.deleteMany({ where: { agentSessionId: sessionId } });
      await prisma.agentSession.delete({ where: { id: sessionId } });

      if (worktreeToDelete) {
        try {
          removeWorktree(room.repoPath, worktreeToDelete.path);
        } catch {
          // Best-effort cleanup — don't block session deletion
        }
        await prisma.worktree.delete({ where: { id: worktreeToDelete.id } }).catch(() => undefined);
      }

      roomChannel.broadcast(roomId, {
        type: 'session.deleted',
        data: { roomId, sessionId },
      });

      return { ok: true };
    },
  );
}
