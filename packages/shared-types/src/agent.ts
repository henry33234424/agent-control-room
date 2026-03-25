export type AgentKind = 'claude' | 'codex';

export type SessionMode = 'readOnly' | 'readWrite';

export type SessionStatus =
  | 'idle'
  | 'running'
  | 'waitingApproval'
  | 'failed'
  | 'archived';

export type RunStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'waitingApproval'
  | 'waitingUserInput'
  | 'summarizing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TriggerType = 'user' | 'handoff' | 'automation' | 'review';
