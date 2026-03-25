import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import type { CreateSessionRequest } from '@control-room/shared-types';
import { toSessionDto } from '../lib/dto.js';

export async function sessionRoutes(app: FastifyInstance) {
  app.post<{ Params: { roomId: string }; Body: CreateSessionRequest }>(
    '/api/rooms/:roomId/sessions',
    async (req, reply) => {
      const { roomId } = req.params;
      const { agent, name, mode } = req.body;

      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room) return reply.status(404).send({ error: 'Room not found' });

      const session = await prisma.agentSession.create({
        data: { roomId, agent, name, mode: mode ?? 'readWrite' },
      });

      return toSessionDto(session);
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
}
