import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import type { CreatePinRequest, UpdatePinRequest } from '@control-room/shared-types';
import { toPinDto } from '../lib/dto.js';
import { roomChannel } from '../ws/room-channel.js';

export async function pinRoutes(app: FastifyInstance) {
  app.get<{ Params: { roomId: string } }>(
    '/api/rooms/:roomId/pins',
    async (req) => {
      const items = await prisma.pinnedBriefItem.findMany({
        where: { roomId: req.params.roomId },
        orderBy: { sortOrder: 'asc' },
      });
      return items.map(toPinDto);
    },
  );

  app.post<{ Params: { roomId: string }; Body: CreatePinRequest }>(
    '/api/rooms/:roomId/pins',
    async (req, reply) => {
      const { roomId } = req.params;
      const { section, content } = req.body;

      const maxOrder = await prisma.pinnedBriefItem.aggregate({
        where: { roomId, section },
        _max: { sortOrder: true },
      });

      const item = await prisma.pinnedBriefItem.create({
        data: {
          roomId,
          section,
          content,
          sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
        },
      });

      await broadcastPins(roomId);
      return toPinDto(item);
    },
  );

  app.put<{ Params: { roomId: string; pinId: string }; Body: UpdatePinRequest }>(
    '/api/rooms/:roomId/pins/:pinId',
    async (req, reply) => {
      const { roomId, pinId } = req.params;
      const { content, sortOrder } = req.body;

      const item = await prisma.pinnedBriefItem.update({
        where: { id: pinId },
        data: {
          ...(content !== undefined ? { content } : {}),
          ...(sortOrder !== undefined ? { sortOrder } : {}),
          version: { increment: 1 },
        },
      });

      await broadcastPins(roomId);
      return toPinDto(item);
    },
  );

  app.delete<{ Params: { roomId: string; pinId: string } }>(
    '/api/rooms/:roomId/pins/:pinId',
    async (req) => {
      const { roomId, pinId } = req.params;
      await prisma.pinnedBriefItem.delete({ where: { id: pinId } });
      await broadcastPins(roomId);
      return { ok: true };
    },
  );
}

async function broadcastPins(roomId: string): Promise<void> {
  const items = await prisma.pinnedBriefItem.findMany({
    where: { roomId },
    orderBy: { sortOrder: 'asc' },
  });
  roomChannel.broadcast(roomId, { type: 'pin.updated', data: items.map(toPinDto) });
}
