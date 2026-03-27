import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionWatcher } from '../src/ws/session-watcher.js';
import { messageService } from '../src/services/message-service.js';

describe('SessionWatcher message sync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips one matching Claude user message for each markSent call', () => {
    const createSpy = vi.spyOn(messageService, 'create').mockResolvedValue({} as any);
    const watcher = new SessionWatcher({
      roomId: 'room-1',
      sessionId: 'session-1',
      agent: 'claude',
    }) as any;

    watcher.markSent('hello');
    watcher.processClaudeLine({ type: 'user', content: 'hello' });
    watcher.processClaudeLine({ type: 'user', content: 'hello' });

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room-1',
      sessionId: 'session-1',
      role: 'user',
      content: 'hello',
    }));
  });

  it('creates Claude agent messages from structured content blocks', () => {
    const createSpy = vi.spyOn(messageService, 'create').mockResolvedValue({} as any);
    const watcher = new SessionWatcher({
      roomId: 'room-1',
      sessionId: 'session-1',
      agent: 'claude',
    }) as any;

    watcher.processClaudeLine({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'First line' },
          { type: 'text', text: 'Second line' },
          { type: 'tool_use', name: 'Edit' },
        ],
      },
    });

    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      role: 'agent',
      content: 'First line\nSecond line',
      agent: 'claude',
    }));
  });

  it('consumes one pending skip for each matching Codex user message', () => {
    const createSpy = vi.spyOn(messageService, 'create').mockResolvedValue({} as any);
    const watcher = new SessionWatcher({
      roomId: 'room-2',
      sessionId: 'session-2',
      agent: 'codex',
    }) as any;

    watcher.markSent('run tests');
    watcher.processCodexLine({
      type: 'event_msg',
      payload: { type: 'user_message', message: 'run tests' },
    });
    watcher.processCodexLine({
      type: 'event_msg',
      payload: { type: 'user_message', message: 'run tests' },
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      role: 'user',
      content: 'run tests',
      agent: 'codex',
    }));
  });

  it('creates Codex agent messages from event_msg payloads', () => {
    const createSpy = vi.spyOn(messageService, 'create').mockResolvedValue({} as any);
    const watcher = new SessionWatcher({
      roomId: 'room-2',
      sessionId: 'session-2',
      agent: 'codex',
    }) as any;

    watcher.processCodexLine({
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'Here is the answer' },
    });

    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      role: 'agent',
      content: 'Here is the answer',
      agent: 'codex',
    }));
  });
});
