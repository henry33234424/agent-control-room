import type { ClientWsEvent, ServerWsEvent } from '@control-room/shared-types';

export type WsEventHandler = (event: ServerWsEvent) => void;

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3002/ws';

export class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<WsEventHandler>();
  private roomId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private pendingEvents: ClientWsEvent[] = [];

  subscribe(roomId: string): void {
    this.roomId = roomId;
    this.connect();
  }

  unsubscribe(): void {
    if (this.ws && this.roomId) {
      this.send({ type: 'room.unsubscribe', roomId: this.roomId });
    }
    this.roomId = null;
    this.pendingEvents = [];
    this.disconnect();
  }

  onEvent(handler: WsEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(event: ClientWsEvent): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
      return;
    }

    this.pendingEvents.push(event);
  }

  private connect(): void {
    if (this.ws) this.disconnect();

    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      if (this.roomId) {
        this.ws?.send(JSON.stringify({ type: 'room.subscribe', roomId: this.roomId }));
      }
      const queuedEvents = this.pendingEvents;
      this.pendingEvents = [];
      for (const event of queuedEvents) {
        if (event.type === 'room.subscribe' || event.type === 'room.unsubscribe') continue;
        this.ws?.send(JSON.stringify(event));
      }
    };

    this.ws.onmessage = (e) => {
      try {
        const event: ServerWsEvent = JSON.parse(e.data);
        for (const handler of this.handlers) {
          handler(event);
        }
      } catch {
        // ignore parse errors
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      if (this.roomId) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay);
  }
}

export const wsClient = new WsClient();
