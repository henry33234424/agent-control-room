import { describe, it, expect } from 'vitest';
import { canTransitionRun, canTransitionSession } from '@control-room/shared-types';

describe('Run state machine', () => {
  it('allows queued → preparing', () => {
    expect(canTransitionRun('queued', 'preparing')).toBe(true);
  });

  it('allows running → waitingApproval → running', () => {
    expect(canTransitionRun('running', 'waitingApproval')).toBe(true);
    expect(canTransitionRun('waitingApproval', 'running')).toBe(true);
  });

  it('allows running → summarizing → completed', () => {
    expect(canTransitionRun('running', 'summarizing')).toBe(true);
    expect(canTransitionRun('summarizing', 'completed')).toBe(true);
  });

  it('allows running → failed', () => {
    expect(canTransitionRun('running', 'failed')).toBe(true);
  });

  it('disallows completed → running', () => {
    expect(canTransitionRun('completed', 'running')).toBe(false);
  });

  it('disallows queued → running (must go through preparing)', () => {
    expect(canTransitionRun('queued', 'running')).toBe(false);
  });

  it('disallows failed → completed', () => {
    expect(canTransitionRun('failed', 'completed')).toBe(false);
  });
});

describe('Session state machine', () => {
  it('allows idle → running → idle', () => {
    expect(canTransitionSession('idle', 'running')).toBe(true);
    expect(canTransitionSession('running', 'idle')).toBe(true);
  });

  it('allows running → waitingApproval → running', () => {
    expect(canTransitionSession('running', 'waitingApproval')).toBe(true);
    expect(canTransitionSession('waitingApproval', 'running')).toBe(true);
  });

  it('allows failed → idle (recovery)', () => {
    expect(canTransitionSession('failed', 'idle')).toBe(true);
  });

  it('disallows archived → running', () => {
    expect(canTransitionSession('archived', 'running')).toBe(false);
  });

  it('disallows running → running (same status)', () => {
    expect(canTransitionSession('running', 'running')).toBe(false);
  });
});
