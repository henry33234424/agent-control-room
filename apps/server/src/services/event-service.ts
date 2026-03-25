import type { RuntimeEvent } from '@control-room/shared-types';
import { sanitizeText, sanitizePayload } from '@control-room/runtime-events';
import { prisma } from '../db.js';
import { roomChannel } from '../ws/room-channel.js';

/**
 * Persist runtime events to DB and broadcast via WebSocket.
 */
export class EventService {
  async emitAndBroadcast(event: RuntimeEvent): Promise<void> {
    // Sanitize before persisting
    const sanitizedText = event.text ? sanitizeText(event.text) : undefined;
    const sanitizedPayload = event.payload ? sanitizePayload(event.payload) : undefined;

    // Persist
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

    // Broadcast
    const broadcastEvent: RuntimeEvent = {
      ...event,
      text: sanitizedText,
      payload: sanitizedPayload,
    };
    roomChannel.broadcast(event.roomId, { type: 'runtime.event', data: broadcastEvent });
  }

  async emitBatch(events: RuntimeEvent[]): Promise<void> {
    for (const event of events) {
      await this.emitAndBroadcast(event);
    }
  }
}

export const eventService = new EventService();
