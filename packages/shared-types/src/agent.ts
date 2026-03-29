export type AgentKind = 'claude' | 'codex';

export type SessionStatus =
  | 'idle'
  | 'running'
  | 'waitingApproval'
  | 'failed'
  | 'archived';
