import type { FastifyInstance } from 'fastify';
import type { CreateReviewRequest } from '@control-room/shared-types';
import { prisma } from '../db.js';
import { orchestrator } from '../orchestrator/room-orchestrator.js';
import { messageService } from '../services/message-service.js';

export async function reviewRoutes(app: FastifyInstance) {
  app.post<{ Params: { roomId: string }; Body: CreateReviewRequest }>(
    '/api/rooms/:roomId/reviews',
    async (req, reply) => {
      const { roomId } = req.params;
      const { agent, sessionId, target, customRef, parentRunId } = req.body;

      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room) return reply.status(404).send({ error: 'Room not found' });

      const session = await prisma.agentSession.findUnique({ where: { id: sessionId } });
      if (!session) return reply.status(404).send({ error: 'Session not found' });
      if (session.roomId !== roomId) {
        return reply.status(400).send({ error: 'Session does not belong to room' });
      }
      if (session.agent !== agent) {
        return reply.status(400).send({ error: 'Session agent does not match review agent' });
      }

      if (parentRunId) {
        const parentRun = await prisma.run.findUnique({ where: { id: parentRunId } });
        if (!parentRun || parentRun.roomId !== roomId || parentRun.agentSessionId !== sessionId) {
          return reply.status(400).send({ error: 'Parent run does not belong to this session' });
        }
      }

      try {
        // Single entry point — orchestrator handles run creation + driver dispatch
        const runId = await orchestrator.dispatchReview({
          roomId,
          agent: agent as any,
          sessionId,
          target,
          customRef,
          parentRunId,
        });

        await messageService.create({
          roomId,
          sessionId,
          agent: agent as any,
          role: 'system',
          content: parentRunId
            ? `Review started (${target}) by ${agent} for run ${parentRunId}`
            : `Review started (${target}) by ${agent}`,
          selectable: false,
        });

        return { runId, status: 'started' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: msg });
      }
    },
  );
}
