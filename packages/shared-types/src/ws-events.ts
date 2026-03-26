import type { ChatMessage } from './chat-message.js';
import type { RuntimeEvent } from './runtime-event.js';
import type { Approval } from './approval.js';
import type { AgentSession, RoomSnapshot } from './room.js';
import type { PinnedBriefItem } from './pinned-brief.js';
import type { HandoffBundle } from './handoff.js';
import type { RunStatus, SessionStatus } from './agent.js';

// ── Client → Server ──

export interface WsSubscribe {
  type: 'room.subscribe';
  roomId: string;
}

export interface WsUnsubscribe {
  type: 'room.unsubscribe';
  roomId: string;
}

export interface WsRunInterrupt {
  type: 'run.interrupt';
  runId: string;
}

export interface WsApprovalDecide {
  type: 'approval.decide';
  approvalId: string;
  decision: 'approved' | 'denied';
}

export type ClientWsEvent =
  | WsSubscribe
  | WsUnsubscribe
  | WsRunInterrupt
  | WsApprovalDecide;

// ── Server → Client ──

export interface WsRoomSnapshot {
  type: 'room.snapshot';
  data: RoomSnapshot;
}

export interface WsMessageCreated {
  type: 'message.created';
  data: ChatMessage;
}

export interface WsMessageUpdated {
  type: 'message.updated';
  data: ChatMessage;
}

export interface WsRuntimeEvent {
  type: 'runtime.event';
  data: RuntimeEvent;
}

export interface WsRunStatus {
  type: 'run.status';
  data: { runId: string; sessionId: string; status: RunStatus };
}

export interface WsSessionStatus {
  type: 'session.status';
  data: { sessionId: string; status: SessionStatus };
}

export interface WsSessionUpdated {
  type: 'session.updated';
  data: AgentSession;
}

export interface WsApprovalRequested {
  type: 'approval.requested';
  data: Approval;
}

export interface WsApprovalResolved {
  type: 'approval.resolved';
  data: Approval;
}

export interface WsPinUpdated {
  type: 'pin.updated';
  data: { roomId: string; items: PinnedBriefItem[] };
}

export interface WsHandoffCreated {
  type: 'handoff.created';
  data: HandoffBundle;
}

export type ServerWsEvent =
  | WsRoomSnapshot
  | WsMessageCreated
  | WsMessageUpdated
  | WsRuntimeEvent
  | WsRunStatus
  | WsSessionStatus
  | WsSessionUpdated
  | WsApprovalRequested
  | WsApprovalResolved
  | WsPinUpdated
  | WsHandoffCreated;
