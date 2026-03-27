import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionWatcher } from '../src/ws/session-watcher.js';

describe('SessionWatcher file discovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers the exact Claude session file when vendorSessionId is known', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cr-claude-watch-'));
    try {
      writeFileSync(join(dir, 'older.jsonl'), '');
      writeFileSync(join(dir, 'target-session.jsonl'), '');

      const watcher = new SessionWatcher({
        roomId: 'room-1',
        sessionId: 'session-1',
        agent: 'claude',
      }) as any;

      watcher.vendorSessionId = 'target-session';

      const match = watcher.findRecentJsonl(dir);
      expect(match).toEqual({
        path: join(dir, 'target-session.jsonl'),
        readFromStart: false,
        vendorSessionId: 'target-session',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats a newly touched Claude file as a fresh session and reads from start', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cr-claude-watch-'));
    try {
      const stalePath = join(dir, 'stale-session.jsonl');
      const freshPath = join(dir, 'fresh-session.jsonl');

      writeFileSync(stalePath, '');
      writeFileSync(freshPath, '');

      const now = Date.now();
      utimesSync(stalePath, new Date(now - 60_000), new Date(now - 60_000));
      utimesSync(freshPath, new Date(now), new Date(now));

      const watcher = new SessionWatcher({
        roomId: 'room-1',
        sessionId: 'session-1',
        agent: 'claude',
      }) as any;

      watcher.startedAtMs = now - 1_000;

      const match = watcher.findRecentJsonl(dir);
      expect(match).toEqual({
        path: freshPath,
        readFromStart: true,
        vendorSessionId: 'fresh-session',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('extracts the Codex vendor session ID from session_meta', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cr-codex-watch-'));
    try {
      const filePath = join(dir, 'rollout.jsonl');
      writeFileSync(
        filePath,
        `${JSON.stringify({
          type: 'session_meta',
          payload: { cwd: '/repo/project', sessionId: 'thread-123' },
        })}\n`,
      );

      const watcher = new SessionWatcher({
        roomId: 'room-2',
        sessionId: 'session-2',
        agent: 'codex',
      }) as any;

      expect(watcher.codexSessionMatchesCwd(filePath, '/repo/project')).toEqual({
        vendorSessionId: 'thread-123',
      });
      expect(watcher.codexSessionMatchesCwd(filePath, '/repo/other')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
