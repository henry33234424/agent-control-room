import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import type { CreateSessionRequest, UpdateSessionRequest } from '@control-room/shared-types';
import { toSessionDto } from '../lib/dto.js';
import { roomChannel } from '../ws/room-channel.js';
import { ptyManager } from '../ws/pty-manager.js';

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
      const { agent } = req.body;
      const name = req.body.name.trim();

      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room) return reply.status(404).send({ error: 'Room not found' });
      if (!name) return reply.status(400).send({ error: 'Session name is required' });
      if (await hasSessionNameConflict(roomId, name)) {
        return reply.status(409).send({ error: 'Session name already exists in this project' });
      }

      const session = await prisma.agentSession.create({
        data: { roomId, agent, name },
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

      ptyManager.kill(sessionId);

      await prisma.chatMessage.deleteMany({ where: { sessionId } });
      await prisma.agentSession.delete({ where: { id: sessionId } });

      roomChannel.broadcast(roomId, {
        type: 'session.deleted',
        data: { roomId, sessionId },
      });

      return { ok: true };
    },
  );
}
