import type { WebSocket } from '@fastify/websocket';
import type { ServerWsEvent } from '@control-room/shared-types';

/**
 * In-memory pub/sub for per-room WebSocket broadcasting.
 */
class RoomChannel {
  private channels = new Map<string, Set<WebSocket>>();

  subscribe(roomId: string, ws: WebSocket): void {
    let subs = this.channels.get(roomId);
    if (!subs) {
      subs = new Set();
      this.channels.set(roomId, subs);
    }
    subs.add(ws);
  }

  unsubscribe(roomId: string, ws: WebSocket): void {
    const subs = this.channels.get(roomId);
    if (subs) {
      subs.delete(ws);
      if (subs.size === 0) this.channels.delete(roomId);
    }
  }

  unsubscribeAll(ws: WebSocket): void {
    for (const [roomId, subs] of this.channels) {
      subs.delete(ws);
      if (subs.size === 0) this.channels.delete(roomId);
    }
  }

  broadcast(roomId: string, event: ServerWsEvent): void {
    const subs = this.channels.get(roomId);
    if (!subs) return;
    const data = JSON.stringify(event);
    for (const ws of subs) {
      if (ws.readyState === 1) {
        ws.send(data);
      }
    }
  }

  getSubscriberCount(roomId: string): number {
    return this.channels.get(roomId)?.size ?? 0;
  }
}

export const roomChannel = new RoomChannel();
