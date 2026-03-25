import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import type { CreateRoomRequest } from '@control-room/shared-types';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { toRoomDto, toSessionDto, toMessageDto, toPinDto } from '../lib/dto.js';

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
        chatMessages: { orderBy: { createdAt: 'desc' }, take: 50 },
        pinnedBriefItems: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!room) return reply.status(404).send({ error: 'Room not found' });

    return {
      room: toRoomDto(room),
      sessions: room.sessions.map(toSessionDto),
      recentMessages: room.chatMessages.reverse().map(toMessageDto),
      pinnedBrief: room.pinnedBriefItems.map(toPinDto),
    };
  });

  // List rooms
  app.get('/api/rooms', async () => {
    const rooms = await prisma.room.findMany({ orderBy: { updatedAt: 'desc' } });
    return rooms.map(toRoomDto);
  });
}
