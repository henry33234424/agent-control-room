import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import type { CreateRoomRequest, UpdateRoomRequest } from '@control-room/shared-types';
import { existsSync, statSync } from 'node:fs';
import { toRoomDto, toSessionDto, toMessageDto, toPinDto } from '../lib/dto.js';
import { ptyManager } from '../ws/pty-manager.js';

const RECENT_MESSAGE_LIMIT = 200;

export async function roomRoutes(app: FastifyInstance) {
  // Create room
  app.post<{ Body: CreateRoomRequest }>('/api/rooms', async (req, reply) => {
    const { name, repoPath } = req.body;

    if (!existsSync(repoPath)) {
      return reply.status(400).send({ error: `Path does not exist: ${repoPath}` });
    }

    if (!statSync(repoPath).isDirectory()) {
      return reply.status(400).send({ error: `Path is not a directory: ${repoPath}` });
    }

    const room = await prisma.room.create({
      data: { name, repoPath },
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

  app.patch<{ Params: { roomId: string }; Body: UpdateRoomRequest }>(
    '/api/rooms/:roomId',
    async (req, reply) => {
      const { roomId } = req.params;
      const name = req.body.name.trim();
      if (!name) return reply.status(400).send({ error: 'Room name is required' });

      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room) return reply.status(404).send({ error: 'Room not found' });

      const updated = await prisma.room.update({
        where: { id: roomId },
        data: { name },
      });

      return toRoomDto(updated);
    },
  );

  // Delete room and all associated data
  app.delete<{ Params: { roomId: string } }>('/api/rooms/:roomId', async (req, reply) => {
    const { roomId } = req.params;
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        sessions: {
          select: { id: true },
        },
      },
    });
    if (!room) return reply.status(404).send({ error: 'Room not found' });

    for (const session of room.sessions) {
      ptyManager.kill(session.id);
    }

    await prisma.pinnedBriefHistory.deleteMany({ where: { roomId } });
    await prisma.pinnedBriefItem.deleteMany({ where: { roomId } });
    await prisma.chatMessage.deleteMany({ where: { roomId } });
    await prisma.agentSession.deleteMany({ where: { roomId } });
    await prisma.room.delete({ where: { id: roomId } });

    return { ok: true };
  });
}
