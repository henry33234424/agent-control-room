import type { SessionStatus } from './agent.js';

export const SESSION_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  idle: ['running', 'archived'],
  running: ['idle', 'waitingApproval', 'failed'],
  waitingApproval: ['running', 'idle', 'failed'],
  failed: ['idle', 'archived'],
  archived: [],
};

export function canTransitionSession(from: SessionStatus, to: SessionStatus): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}
