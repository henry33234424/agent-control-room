import type { AgentKind } from './agent.js';

export type RuntimeEventKind =
  | 'run.status'
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'command.stdout'
  | 'command.stderr'
  | 'message.delta'
  | 'message.final'
  | 'approval.requested'
  | 'approval.resolved'
  | 'review.started'
  | 'review.completed'
  | 'diff.ready'
  | 'artifact.created'
  | 'system.log';

export type EventLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RuntimeEvent {
  id: string;
  roomId: string;
  agent: AgentKind;
  sessionId: string;
  runId: string;
  worktreeId?: string;
  kind: RuntimeEventKind;
  title?: string;
  text?: string;
  payload?: Record<string, unknown>;
  level?: EventLevel;
  ts: string;
}
