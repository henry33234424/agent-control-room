import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import type { SendMessageRequest } from '@control-room/shared-types';
import { roomChannel } from '../ws/room-channel.js';
import { orchestrator } from '../orchestrator/room-orchestrator.js';
import { toMessageDto } from '../lib/dto.js';

export async function messageRoutes(app: FastifyInstance) {
  app.post<{ Params: { roomId: string }; Body: SendMessageRequest }>(
    '/api/rooms/:roomId/messages',
    async (req, reply) => {
      const { roomId } = req.params;
      const { content, mentionTarget, sessionId } = req.body;

      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room) return reply.status(404).send({ error: 'Room not found' });

      const message = await prisma.chatMessage.create({
        data: {
          roomId,
          sessionId: sessionId ?? null,
          role: 'user',
          mentionTarget,
          content,
          contentFormat: 'markdown',
          selectable: true,
          pinned: false,
        },
      });

      const chatMsg = toMessageDto(message);

      roomChannel.broadcast(roomId, { type: 'message.created', data: chatMsg });

      // Dispatch to orchestrator (runs in background, events stream via WS)
      orchestrator.handleUserMessage(roomId, content, mentionTarget, sessionId).catch((err) => {
        app.log.error({ err, roomId }, 'Orchestrator error');
      });

      return chatMsg;
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
