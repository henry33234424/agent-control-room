import type { AgentKind } from './agent.js';

export type ApprovalType =
  | 'tool'
  | 'fileChange'
  | 'network'
  | 'askUserQuestion';

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'cancelled';

export interface Approval {
  id: string;
  roomId: string;
  runId: string;
  sessionId: string;
  agent: AgentKind;
  approvalType: ApprovalType;
  title: string;
  payload?: Record<string, unknown>;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
}
