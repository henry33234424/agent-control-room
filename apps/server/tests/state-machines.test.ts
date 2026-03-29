import { describe, it, expect } from 'vitest';
import { canTransitionSession } from '@control-room/shared-types';

describe('Session state machine', () => {
  it('allows idle → running → idle', () => {
    expect(canTransitionSession('idle', 'running')).toBe(true);
    expect(canTransitionSession('running', 'idle')).toBe(true);
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
