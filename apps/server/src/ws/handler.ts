import type { FastifyInstance } from 'fastify';
import type { ClientWsEvent } from '@control-room/shared-types';
import { roomChannel } from './room-channel.js';
import { prisma } from '../db.js';
import { toRoomDto, toSessionDto, toMessageDto, toPinDto } from '../lib/dto.js';
import { approvalService } from '../services/approval-service.js';

export async function registerWebSocket(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket, req) => {
    const ws = socket;
    let subscribedRoomId: string | null = null;

    ws.on('message', async (raw: Buffer) => {
      try {
        const event: ClientWsEvent = JSON.parse(raw.toString());

        switch (event.type) {
          case 'room.subscribe': {
            if (subscribedRoomId) {
              roomChannel.unsubscribe(subscribedRoomId, ws);
            }
            subscribedRoomId = event.roomId;
            roomChannel.subscribe(event.roomId, ws);

            const room = await prisma.room.findUnique({
              where: { id: event.roomId },
              include: {
                sessions: { orderBy: { updatedAt: 'desc' } },
                chatMessages: { orderBy: { createdAt: 'desc' }, take: 50 },
                pinnedBriefItems: { orderBy: { sortOrder: 'asc' } },
              },
            });
            if (room) {
              const pendingApprovals = await approvalService.listPendingByRoom(event.roomId);
              ws.send(
                JSON.stringify({
                  type: 'room.snapshot',
                  data: {
                    room: toRoomDto(room),
                    sessions: room.sessions.map(toSessionDto),
                    recentMessages: room.chatMessages.reverse().map(toMessageDto),
                    pinnedBrief: room.pinnedBriefItems.map(toPinDto),
                    pendingApprovals,
                  },
                }),
              );
            }
            break;
          }

          case 'room.unsubscribe': {
            if (subscribedRoomId) {
              roomChannel.unsubscribe(subscribedRoomId, ws);
              subscribedRoomId = null;
            }
            break;
          }

          case 'approval.decide': {
            // Forward to approval service so the adapter gets unblocked
            await approvalService.decide(event.approvalId, event.decision);
            break;
          }

          case 'run.interrupt': {
            app.log.info({ runId: event.runId }, 'Run interrupt via WS');
            break;
          }
        }
      } catch (err) {
        app.log.error({ err }, 'Invalid WS message');
      }
    });

    ws.on('close', () => {
      roomChannel.unsubscribeAll(ws);
    });
  });
}
