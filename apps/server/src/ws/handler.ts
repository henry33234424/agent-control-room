import type { FastifyInstance } from 'fastify';
import type { ClientWsEvent } from '@control-room/shared-types';
import { roomChannel } from './room-channel.js';
import { prisma } from '../db.js';
import { toRoomDto, toSessionDto, toMessageDto, toPinDto } from '../lib/dto.js';
import { approvalService } from '../services/approval-service.js';
import { ptyManager } from './pty-manager.js';
import { config } from '../config.js';

export async function registerWebSocket(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket, req) => {
    const ws = socket;
    let subscribedRoomId: string | null = null;

    ws.on('message', async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());

        // Handle PTY messages (not part of ClientWsEvent type)
        if (msg.type === 'pty.start') {
          const { sessionId, roomId, agent, cols, rows } = msg;

          // Validate room exists and get its repo path
          const room = await prisma.room.findUnique({ where: { id: roomId } });
          if (!room) {
            ws.send(JSON.stringify({ type: 'pty.exit', sessionId, exitCode: 1, error: 'Room not found' }));
            return;
          }

          // Use room's repo path as cwd (never trust client-supplied cwd)
          const safeCwd = room.repoPath;

          // Determine command and args
          let command: string;
          let args: string[];

          if (agent === 'claude') {
            command = 'claude';
            args = [];
            if (config.claudeModel) args.push('--model', config.claudeModel);
          } else if (agent === 'codex') {
            command = 'codex';
            args = [];
            if (config.codexModel) args.push('-m', config.codexModel);
          } else {
            ws.send(JSON.stringify({ type: 'pty.exit', sessionId, exitCode: 1, error: 'Unknown agent' }));
            return;
          }

          ptyManager.start({
            sessionId,
            roomId,
            agent,
            command,
            args,
            cwd: safeCwd,
            ws,
            cols,
            rows,
          });
          return;
        }

        if (msg.type === 'pty.input') {
          ptyManager.write(msg.sessionId, msg.data);
          return;
        }

        if (msg.type === 'pty.resize') {
          ptyManager.resize(msg.sessionId, msg.cols, msg.rows);
          return;
        }

        if (msg.type === 'pty.kill') {
          ptyManager.kill(msg.sessionId);
          return;
        }

        // Handle standard Control Room events
        const event = msg as ClientWsEvent;

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
      ptyManager.killBySocket(ws);
    });
  });
}
