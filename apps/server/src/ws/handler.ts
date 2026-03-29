import type { FastifyInstance } from 'fastify';
import type { ClientWsEvent } from '@control-room/shared-types';
import { roomChannel } from './room-channel.js';
import { prisma } from '../db.js';
import { toRoomDto, toSessionDto, toMessageDto, toPinDto } from '../lib/dto.js';
import { approvalService } from '../services/approval-service.js';
import { buildInteractiveCommand } from '../services/interactive-command.js';
import { interactiveTerminalStateService } from '../services/interactive-terminal-state-service.js';
import { sessionService } from '../services/session-service.js';
import { ptyManager } from './pty-manager.js';

const RECENT_MESSAGE_LIMIT = 200;
const HEARTBEAT_INTERVAL_MS = 15000;
const HEARTBEAT_TIMEOUT_MS = 45000;

export async function registerWebSocket(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket, req) => {
    const ws = socket;
    let subscribedRoomId: string | null = null;
    let lastClientActivityAt = Date.now();

    const heartbeatTimer = setInterval(() => {
      if (ws.readyState !== 1) {
        return;
      }

      if (Date.now() - lastClientActivityAt > HEARTBEAT_TIMEOUT_MS) {
        ws.close(4000, 'Heartbeat timeout');
        return;
      }

      ws.send(JSON.stringify({ type: 'ws.ping' }));
    }, HEARTBEAT_INTERVAL_MS);

    ws.on('message', async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        lastClientActivityAt = Date.now();

        if (msg.type === 'ws.pong') {
          return;
        }

        // Handle PTY messages (not part of ClientWsEvent type)
        if (msg.type === 'pty.start') {
          const { sessionId, roomId, agent, cols, rows } = msg;

          try {
            const ctx = await sessionService.resolveInteractiveContext(sessionId);
            if (ctx.roomId !== roomId) {
              ws.send(JSON.stringify({ type: 'pty.exit', sessionId, exitCode: 1, error: 'Session does not belong to room' }));
              return;
            }
            if (ctx.agent !== agent) {
              ws.send(JSON.stringify({ type: 'pty.exit', sessionId, exitCode: 1, error: 'Session agent mismatch' }));
              return;
            }

            const { command, args } = buildInteractiveCommand({
              agent: ctx.agent,
              cwd: ctx.cwd,
              vendorSessionId: ctx.vendorSessionId,
            });

            ptyManager.start({
              sessionId,
              roomId: ctx.roomId,
              agent: ctx.agent,
              command,
              args,
              cwd: ctx.cwd,
              vendorSessionId: ctx.vendorSessionId,
              ws,
              cols,
              rows,
            });
          } catch (err) {
            const error = err instanceof Error ? err.message : 'Failed to start terminal session';
            ws.send(JSON.stringify({ type: 'pty.exit', sessionId, exitCode: 1, error }));
            return;
          }
          return;
        }

        if (msg.type === 'pty.attach') {
          try {
            const ctx = await sessionService.resolveInteractiveContext(msg.sessionId);
            if (!subscribedRoomId || ctx.roomId !== subscribedRoomId) {
              ws.send(JSON.stringify({
                type: 'pty.exit',
                sessionId: msg.sessionId,
                exitCode: 1,
                error: 'Session does not belong to subscribed room',
              }));
              return;
            }

            if (!await ptyManager.attach(msg.sessionId, ws)) {
              const interactiveState = await interactiveTerminalStateService.get(msg.sessionId);
              const canResume = ptyManager.hasPersistentSession(msg.sessionId)
                || Boolean(interactiveState?.active && ctx.vendorSessionId);

              if (canResume) {
                const { command, args } = buildInteractiveCommand({
                  agent: ctx.agent,
                  cwd: ctx.cwd,
                  vendorSessionId: ctx.vendorSessionId,
                });

                ptyManager.start({
                  sessionId: msg.sessionId,
                  roomId: ctx.roomId,
                  agent: ctx.agent,
                  command,
                  args,
                  cwd: ctx.cwd,
                  vendorSessionId: ctx.vendorSessionId,
                  ws,
                  initialSnapshot: interactiveState?.snapshot,
                });
                return;
              }

              if (interactiveState?.snapshot) {
                ws.send(JSON.stringify({
                  type: 'pty.restore',
                  sessionId: msg.sessionId,
                  screen: interactiveState.snapshot.screen,
                  cols: interactiveState.snapshot.cols,
                  rows: interactiveState.snapshot.rows,
                  viewportY: interactiveState.snapshot.viewportY,
                }));
              }

              ws.send(JSON.stringify({
                type: 'pty.exit',
                sessionId: msg.sessionId,
                exitCode: 1,
                error: interactiveState?.active
                  ? 'Session could not be resumed automatically. Restart it to continue.'
                  : 'PTY session is not running',
              }));
            }
          } catch (err) {
            const error = err instanceof Error ? err.message : 'Failed to attach terminal session';
            ws.send(JSON.stringify({ type: 'pty.exit', sessionId: msg.sessionId, exitCode: 1, error }));
          }
          return;
        }

        if (msg.type === 'pty.input') {
          await ptyManager.writeForSocket(ws, msg.sessionId, msg.data);
          return;
        }

        if (msg.type === 'pty.resize') {
          ptyManager.resizeForSocket(ws, msg.sessionId, msg.cols, msg.rows);
          return;
        }

        if (msg.type === 'pty.kill') {
          ptyManager.killForSocket(ws, msg.sessionId);
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
                chatMessages: { orderBy: { createdAt: 'desc' }, take: RECENT_MESSAGE_LIMIT },
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
        }
      } catch (err) {
        app.log.error({ err }, 'Invalid WS message');
      }
    });

    ws.on('close', () => {
      clearInterval(heartbeatTimer);
      roomChannel.unsubscribeAll(ws);
      ptyManager.detachBySocket(ws);
    });
  });
}
