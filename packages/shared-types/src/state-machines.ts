import type { RunStatus, SessionStatus } from './agent.js';

export const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  queued: ['preparing'],
  preparing: ['running', 'failed'],
  running: ['waitingApproval', 'waitingUserInput', 'summarizing', 'failed', 'cancelled'],
  waitingApproval: ['running', 'failed'],
  waitingUserInput: ['running', 'failed'],
  summarizing: ['completed', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
};

export const SESSION_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  idle: ['running', 'archived'],
  running: ['idle', 'waitingApproval', 'failed'],
  waitingApproval: ['running', 'idle', 'failed'],
  failed: ['idle', 'archived'],
  archived: [],
};

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function canTransitionSession(from: SessionStatus, to: SessionStatus): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}
