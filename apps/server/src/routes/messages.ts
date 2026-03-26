import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import type { SendMessageRequest } from '@control-room/shared-types';
import { toMessageDto } from '../lib/dto.js';
import { messageService } from '../services/message-service.js';
import { interactiveDispatchService } from '../services/interactive-dispatch-service.js';

export async function messageRoutes(app: FastifyInstance) {
  app.post<{ Params: { roomId: string }; Body: SendMessageRequest }>(
    '/api/rooms/:roomId/messages',
    async (req, reply) => {
      const { roomId } = req.params;
      const { content, mentionTarget, sessionId, selectedMessageIds } = req.body;

      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room) return reply.status(404).send({ error: 'Room not found' });

      try {
        const prepared = await interactiveDispatchService.prepare({
          roomId,
          content,
          mentionTarget,
          preferredSessionId: sessionId,
          selectedMessageIds,
        });

        const primarySessionId = prepared.targets.length === 1 ? prepared.targets[0].sessionId : undefined;
        const chatMsg = await messageService.create({
          roomId,
          sessionId: primarySessionId,
          role: 'user',
          mentionTarget,
          content,
          selectable: true,
          pinned: false,
        });

        if (prepared.selectedCount > 0) {
          const label = prepared.targets.map((target) => target.agent).join(', ');
          await messageService.create({
            roomId,
            sessionId: primarySessionId,
            role: 'handoff-summary',
            content: `Sent ${prepared.selectedCount} selected message${prepared.selectedCount > 1 ? 's' : ''} to ${label}.`,
            selectable: false,
          });
        }

        try {
          await interactiveDispatchService.dispatchPrepared(roomId, prepared, chatMsg.id);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          app.log.error({ err, roomId }, 'Interactive terminal delivery failed');
          await messageService.create({
            roomId,
            sessionId: primarySessionId,
            role: 'system',
            content: `Failed to deliver message to interactive session: ${error}`,
            selectable: false,
          });
        }
        return chatMsg;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        app.log.error({ err, roomId }, 'Interactive dispatch error');
        return reply.status(400).send({ error });
      }
    },
  );

  app.get<{ Params: { roomId: string }; Querystring: { limit?: string; cursor?: string } }>(
    '/api/rooms/:roomId/messages',
    async (req) => {
      const { roomId } = req.params;
      const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 100);
      const cursor = req.query.cursor;

      const messages = await prisma.chatMessage.findMany({
        where: { roomId },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const hasMore = messages.length > limit;
      const items = (hasMore ? messages.slice(0, limit) : messages).reverse();
      const nextCursor = hasMore ? messages[limit - 1].id : undefined;

      return {
        items: items.map(toMessageDto),
        nextCursor,
        hasMore,
      };
    },
  );
}
