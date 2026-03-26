import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
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
    async (req) => {
      const { roomId } = req.params;
      const { section, content } = req.body;

      const maxOrder = await prisma.pinnedBriefItem.aggregate({
        where: { roomId, section },
        _max: { sortOrder: true },
      });

      const item = await prisma.$transaction(async (tx) => {
        const created = await tx.pinnedBriefItem.create({
          data: {
            roomId,
            section,
            content,
            sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
          },
        });
        await createHistorySnapshot(tx, created, 'created');
        return created;
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

      const current = await prisma.pinnedBriefItem.findUniqueOrThrow({ where: { id: pinId } });
      if (current.roomId !== roomId) {
        return reply.status(404).send({ error: 'Pin not found in room' });
      }

      const nextContent = content ?? current.content;
      const nextSortOrder = sortOrder ?? current.sortOrder;
      if (nextContent === current.content && nextSortOrder === current.sortOrder) {
        return toPinDto(current);
      }

      const changeType =
        sortOrder !== undefined && content === undefined ? 'reordered' : 'updated';

      const item = await prisma.$transaction(async (tx) => {
        await createHistorySnapshot(tx, current, changeType);
        return tx.pinnedBriefItem.update({
          where: { id: pinId },
          data: {
            ...(content !== undefined ? { content } : {}),
            ...(sortOrder !== undefined ? { sortOrder } : {}),
            version: { increment: 1 },
          },
        });
      });

      await broadcastPins(roomId);
      return toPinDto(item);
    },
  );

  app.delete<{ Params: { roomId: string; pinId: string } }>(
    '/api/rooms/:roomId/pins/:pinId',
    async (req, reply) => {
      const { roomId, pinId } = req.params;
      const current = await prisma.pinnedBriefItem.findUniqueOrThrow({ where: { id: pinId } });
      if (current.roomId !== roomId) {
        return reply.status(404).send({ error: 'Pin not found in room' });
      }

      await prisma.$transaction(async (tx) => {
        await createHistorySnapshot(tx, current, 'deleted');
        await tx.pinnedBriefItem.delete({ where: { id: pinId } });
      });

      await broadcastPins(roomId);
      return { ok: true };
    },
  );
}

async function createHistorySnapshot(
  tx: Prisma.TransactionClient,
  item: {
    id: string;
    roomId: string;
    section: string;
    content: string;
    sortOrder: number;
    version: number;
  },
  changeType: 'created' | 'updated' | 'reordered' | 'deleted',
): Promise<void> {
  await tx.pinnedBriefHistory.create({
    data: {
      roomId: item.roomId,
      itemId: item.id,
      section: item.section,
      content: item.content,
      sortOrder: item.sortOrder,
      version: item.version,
      changeType,
    },
  });
}

async function broadcastPins(roomId: string): Promise<void> {
  const items = await prisma.pinnedBriefItem.findMany({
    where: { roomId },
    orderBy: { sortOrder: 'asc' },
  });
  roomChannel.broadcast(roomId, { type: 'pin.updated', data: { roomId, items: items.map(toPinDto) } });
}
