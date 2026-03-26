import type { RuntimeEvent } from '@control-room/shared-types';
import { sanitizeText, sanitizePayload } from '@control-room/runtime-events';
import { prisma } from '../db.js';
import { roomChannel } from '../ws/room-channel.js';

/**
 * Persist runtime events to DB and broadcast via WebSocket.
 */
export class EventService {
  async emitAndBroadcast(event: RuntimeEvent): Promise<void> {
    try {
      const sanitizedText = event.text != null ? sanitizeText(event.text) : undefined;
      const sanitizedPayload = event.payload ? sanitizePayload(event.payload) : undefined;

      await prisma.runtimeEvent.create({
        data: {
          id: event.id,
          roomId: event.roomId,
          agent: event.agent,
          sessionId: event.sessionId,
          runId: event.runId,
          worktreeId: event.worktreeId,
          kind: event.kind,
          title: event.title,
          text: sanitizedText,
          payloadJson: sanitizedPayload ? JSON.stringify(sanitizedPayload) : undefined,
          level: event.level ?? 'info',
          ts: new Date(event.ts),
        },
      });

      const broadcastEvent: RuntimeEvent = {
        ...event,
        text: sanitizedText,
        payload: sanitizedPayload,
      };
      roomChannel.broadcast(event.roomId, { type: 'runtime.event', data: broadcastEvent });
    } catch (err) {
      // Never let event persistence crash the server
      console.error('[event-service] Failed to emit event:', event.kind, err);
    }
  }

  async emitBatch(events: RuntimeEvent[]): Promise<void> {
    for (const event of events) {
      await this.emitAndBroadcast(event);
    }
  }
}

export const eventService = new EventService();
