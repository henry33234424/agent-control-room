import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { messageService } from '../services/message-service.js';

export async function excerptRoutes(app: FastifyInstance) {
  /**
   * Create an excerpt — a manually captured piece of terminal output.
   * This goes directly to the context panel without triggering any agent dispatch.
   */
  app.post<{
    Params: { roomId: string };
    Body: { content: string; sourceAgent?: string; sourceSessionId?: string };
  }>(
    '/api/rooms/:roomId/excerpts',
    async (req, reply) => {
      const { roomId } = req.params;
      const { content, sourceAgent, sourceSessionId } = req.body;

      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room) return reply.status(404).send({ error: 'Room not found' });

      if (!content?.trim()) {
        return reply.status(400).send({ error: 'Content is required' });
      }

      const msg = await messageService.create({
        roomId,
        sessionId: sourceSessionId,
        agent: sourceAgent as any,
        role: 'excerpt',
        content: content.trim(),
        selectable: true,
      });

      return msg;
    },
  );
}
