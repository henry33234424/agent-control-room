import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { toEventDto } from '../lib/dto.js';

export async function runRoutes(app: FastifyInstance) {
  app.get<{
    Params: { roomId: string; runId: string };
    Querystring: { limit?: string; cursor?: string };
  }>('/api/rooms/:roomId/runs/:runId/events', async (req) => {
    const { runId } = req.params;
    const limit = Math.min(parseInt(req.query.limit ?? '200', 10), 500);
    const cursor = req.query.cursor;

    const events = await prisma.runtimeEvent.findMany({
      where: { runId },
      orderBy: { ts: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = events.length > limit;
    const items = hasMore ? events.slice(0, limit) : events;
    const nextCursor = hasMore ? items[items.length - 1].id : undefined;

    return {
      items: items.map(toEventDto),
      nextCursor,
      hasMore,
    };
  });

  app.get<{ Params: { roomId: string }; Querystring: { sessionId?: string } }>(
    '/api/rooms/:roomId/runs',
    async (req) => {
      const { roomId } = req.params;
      const { sessionId } = req.query;

      const runs = await prisma.run.findMany({
        where: { roomId, ...(sessionId ? { agentSessionId: sessionId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      return runs.map((r) => ({
        id: r.id,
        roomId: r.roomId,
        agentSessionId: r.agentSessionId,
        triggerType: r.triggerType,
        parentRunId: r.parentRunId ?? undefined,
        status: r.status,
        resultSummary: r.resultSummary ?? undefined,
        totalCostUsd: r.totalCostUsd ?? undefined,
        startedAt: r.startedAt?.toISOString(),
        endedAt: r.endedAt?.toISOString(),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));
    },
  );
}
