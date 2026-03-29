import type { ChatMessage } from './chat-message.js';
import type { AgentSession, RoomSnapshot } from './room.js';
import type { PinnedBriefItem } from './pinned-brief.js';
import type { AgentKind, SessionStatus } from './agent.js';

// ── Client → Server ──

export interface WsSubscribe {
  type: 'room.subscribe';
  roomId: string;
}

export interface WsUnsubscribe {
  type: 'room.unsubscribe';
  roomId: string;
}

export interface WsPong {
  type: 'ws.pong';
}

export interface WsPtyStart {
  type: 'pty.start';
  sessionId: string;
  roomId: string;
  agent: AgentKind;
  cols?: number;
  rows?: number;
}

export interface WsPtyAttach {
  type: 'pty.attach';
  sessionId: string;
}

export interface WsPtyInput {
  type: 'pty.input';
  sessionId: string;
  data: string;
}

export interface WsPtyResize {
  type: 'pty.resize';
  sessionId: string;
  cols: number;
  rows: number;
}

export interface WsPtyKill {
  type: 'pty.kill';
  sessionId: string;
}

export type ClientWsEvent =
  | WsSubscribe
  | WsUnsubscribe
  | WsPong
  | WsPtyStart
  | WsPtyAttach
  | WsPtyInput
  | WsPtyResize
  | WsPtyKill;

// ── Server → Client ──

export interface WsRoomSnapshot {
  type: 'room.snapshot';
  data: RoomSnapshot;
}

export interface WsPing {
  type: 'ws.ping';
}

export interface WsMessageCreated {
  type: 'message.created';
  data: ChatMessage;
}

export interface WsMessageUpdated {
  type: 'message.updated';
  data: ChatMessage;
}

export interface WsSessionStatus {
  type: 'session.status';
  data: { sessionId: string; status: SessionStatus };
}

export interface WsSessionUpdated {
  type: 'session.updated';
  data: AgentSession;
}

export interface WsSessionDeleted {
  type: 'session.deleted';
  data: { roomId: string; sessionId: string };
}

export interface WsPinUpdated {
  type: 'pin.updated';
  data: { roomId: string; items: PinnedBriefItem[] };
}

export interface WsPtyStarted {
  type: 'pty.started';
  sessionId: string;
  restored: boolean;
}

export interface WsPtyRestore {
  type: 'pty.restore';
  sessionId: string;
  screen: string;
  cols: number;
  rows: number;
  viewportY: number;
}

export interface WsPtyOutput {
  type: 'pty.output';
  sessionId: string;
  data: string;
}

export interface WsPtyExit {
  type: 'pty.exit';
  sessionId: string;
  exitCode: number;
  error?: string;
}

export type ServerWsEvent =
  | WsPing
  | WsRoomSnapshot
  | WsMessageCreated
  | WsMessageUpdated
  | WsSessionStatus
  | WsSessionUpdated
  | WsSessionDeleted
  | WsPinUpdated
  | WsPtyStarted
  | WsPtyRestore
  | WsPtyOutput
  | WsPtyExit;
