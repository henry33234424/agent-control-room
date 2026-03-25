import { describe, it, expect } from 'vitest';
import { normalizeClaudeMessage } from '@control-room/runtime-events';
import { normalizeCodexNotification } from '@control-room/runtime-events';

const ctx = { roomId: 'r1', sessionId: 's1', runId: 'run1' };

describe('normalizeClaudeMessage', () => {
  it('maps assistant message to message.delta', () => {
    const events = normalizeClaudeMessage({ type: 'assistant', content: 'Hello' }, ctx);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('message.delta');
    expect(events[0].text).toBe('Hello');
  });

  it('maps tool_use to tool.started', () => {
    const events = normalizeClaudeMessage(
      { type: 'tool_use', name: 'Bash', id: 'tu1', input: { command: 'ls -la' } },
      ctx,
    );
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('tool.started');
    expect(events[0].title).toBe('Bash');
    expect(events[0].text).toContain('$ ls -la');
  });

  it('maps Bash tool_result to command.stdout + tool.completed', () => {
    const events = normalizeClaudeMessage(
      { type: 'tool_result', tool_name: 'Bash', content: 'file1.ts\nfile2.ts', is_error: false },
      ctx,
    );
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('command.stdout');
    expect(kinds).toContain('tool.completed');
  });

  it('maps Bash error to command.stderr + tool.failed', () => {
    const events = normalizeClaudeMessage(
      { type: 'tool_result', tool_name: 'Bash', content: 'command not found', is_error: true },
      ctx,
    );
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('command.stderr');
    expect(kinds).toContain('tool.failed');
  });

  it('maps Write tool_result to diff.ready + tool.completed', () => {
    const events = normalizeClaudeMessage(
      { type: 'tool_result', tool_name: 'Write', content: 'ok', is_error: false, tool_input: { file_path: '/a.ts' } },
      ctx,
    );
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('diff.ready');
    expect(kinds).toContain('tool.completed');
  });

  it('maps success result to run.completed', () => {
    const events = normalizeClaudeMessage(
      { type: 'result', subtype: 'success', result: 'Done', session_id: 'sid', total_cost_usd: 0.01 },
      ctx,
    );
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('run.completed');
    expect(events[0].payload?.totalCostUsd).toBe(0.01);
  });

  it('silences user and rate_limit_event types', () => {
    expect(normalizeClaudeMessage({ type: 'user' }, ctx)).toHaveLength(0);
    expect(normalizeClaudeMessage({ type: 'rate_limit_event' }, ctx)).toHaveLength(0);
  });
});

describe('normalizeCodexNotification', () => {
  it('maps item/agentMessage/delta to message.delta', () => {
    const events = normalizeCodexNotification('item/agentMessage/delta', { delta: 'hi', threadId: 't1' }, ctx);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('message.delta');
    expect(events[0].text).toBe('hi');
  });

  it('maps turn/completed to message.final + run.completed', () => {
    const events = normalizeCodexNotification('turn/completed', { summary: 'Done', threadId: 't1' }, ctx);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('message.final');
    expect(kinds).toContain('run.completed');
  });

  it('maps item/completed with stdout to command.stdout', () => {
    const events = normalizeCodexNotification(
      'item/completed',
      { type: 'command', stdout: 'output here', threadId: 't1' },
      ctx,
    );
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('command.stdout');
    expect(kinds).toContain('tool.completed');
  });

  it('maps review/completed to review.completed', () => {
    const events = normalizeCodexNotification('review/completed', { summary: 'LGTM', threadId: 't1' }, ctx);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('review.completed');
  });
});
