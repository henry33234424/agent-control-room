import type { ClientWsEvent, ServerWsEvent } from '@control-room/shared-types';

export type WsEventHandler = (event: ServerWsEvent) => void;
export type WsOpenHandler = () => void;

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3002/ws';

export class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<WsEventHandler>();
  private openHandlers = new Set<WsOpenHandler>();
  private roomId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private pendingEvents: ClientWsEvent[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatCheckIntervalMs = 5000;
  private heartbeatTimeoutMs = 45000;
  private lastServerActivityAt = 0;

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

  onOpen(handler: WsOpenHandler): () => void {
    this.openHandlers.add(handler);
    return () => this.openHandlers.delete(handler);
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
    this.lastServerActivityAt = Date.now();

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.lastServerActivityAt = Date.now();
      this.startHeartbeatMonitor();
      if (this.roomId) {
        this.ws?.send(JSON.stringify({ type: 'room.subscribe', roomId: this.roomId }));
      }
      const queuedEvents = this.pendingEvents;
      this.pendingEvents = [];
      for (const event of queuedEvents) {
        if (event.type === 'room.subscribe' || event.type === 'room.unsubscribe') continue;
        this.ws?.send(JSON.stringify(event));
      }
      for (const handler of this.openHandlers) {
        handler();
      }
    };

    this.ws.onmessage = (e) => {
      this.lastServerActivityAt = Date.now();
      try {
        const event: ServerWsEvent = JSON.parse(e.data);
        if (event.type === 'ws.ping') {
          this.send({ type: 'ws.pong' });
          return;
        }
        for (const handler of this.handlers) {
          handler(event);
        }
      } catch {
        // ignore parse errors
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeatMonitor();
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
    this.stopHeartbeatMonitor();
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay);
  }

  private startHeartbeatMonitor(): void {
    this.stopHeartbeatMonitor();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }

      if (Date.now() - this.lastServerActivityAt <= this.heartbeatTimeoutMs) {
        return;
      }

      this.ws.close();
    }, this.heartbeatCheckIntervalMs);
  }

  private stopHeartbeatMonitor(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

export const wsClient = new WsClient();
