import { describe, it, expect } from 'vitest';
import { parseMention, getTargetAgents } from '../src/orchestrator/message-router.js';

describe('parseMention', () => {
  it('parses @Claude at start', () => {
    const r = parseMention('@Claude fix the bug');
    expect(r.target).toBe('claude');
    expect(r.cleanContent).toBe('fix the bug');
  });

  it('parses @Codex at start', () => {
    const r = parseMention('@Codex implement the feature');
    expect(r.target).toBe('codex');
    expect(r.cleanContent).toBe('implement the feature');
  });

  it('parses @both', () => {
    const r = parseMention('@both review this code');
    expect(r.target).toBe('both');
  });

  it('defaults to claude when no mention', () => {
    const r = parseMention('just a plain message');
    expect(r.target).toBe('claude');
    expect(r.cleanContent).toBe('just a plain message');
  });

  it('uses explicit target over parsed mention', () => {
    const r = parseMention('@Claude something', 'codex');
    expect(r.target).toBe('codex');
  });
});

describe('getTargetAgents', () => {
  it('returns both agents for "both"', () => {
    expect(getTargetAgents('both')).toEqual(['claude', 'codex']);
  });

  it('returns single agent for specific target', () => {
    expect(getTargetAgents('claude')).toEqual(['claude']);
    expect(getTargetAgents('codex')).toEqual(['codex']);
  });
});
