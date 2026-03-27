import { createRequire } from 'node:module';
import type { WebSocket } from '@fastify/websocket';
import type { AgentKind } from '@control-room/shared-types';
import type { IPty } from 'node-pty';
import { sessionService } from '../services/session-service.js';
import { SessionWatcher } from './session-watcher.js';
const require_ = createRequire(import.meta.url);
const pty: { spawn: typeof import('node-pty').spawn } = require_('node-pty');

interface PtySession {
  ptyProcess: IPty;
  ws: WebSocket | null;
  agent: AgentKind;
  sessionId: string;
  roomId: string;
  buffer: string;
  detachTimer: NodeJS.Timeout | null;
  watcher: SessionWatcher;
}

/**
 * Manages PTY sessions.
 * PTY handles terminal I/O only.
 * SessionWatcher (separate) handles chat message sync by reading JSONL files.
 */
class PtyManager {
  private sessions = new Map<string, PtySession>();
  private maxBufferChars = 200_000;
  private detachTtlMs = 10 * 60 * 1000;

  start(input: {
    sessionId: string;
    roomId: string;
    agent: AgentKind;
    command: string;
    args: string[];
    cwd: string;
    vendorSessionId?: string;
    ws?: WebSocket | null;
    cols?: number;
    rows?: number;
  }): void {
    if (input.ws) {
      this.detachBySocket(input.ws);
    }

    // Reattach to existing session
    const existing = this.sessions.get(input.sessionId);
    if (existing) {
      if (existing.detachTimer) {
        clearTimeout(existing.detachTimer);
        existing.detachTimer = null;
      }
      if (input.ws) {
        existing.ws = input.ws;
        // Replay buffer first, then let frontend's debounced ResizeObserver handle resize later.
        // Don't resize here — it causes TUI to redraw and clear the replayed content.
        if (existing.buffer && input.ws.readyState === 1) {
          input.ws.send(JSON.stringify({ type: 'pty.output', sessionId: input.sessionId, data: existing.buffer }));
        }
      }
      return;
    }

    const cols = input.cols ?? 120;
    const rows = input.rows ?? 40;

    const ptyProcess = pty.spawn(input.command, input.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: input.cwd,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    });

    const session: PtySession = {
      ptyProcess,
      ws: input.ws ?? null,
      agent: input.agent,
      sessionId: input.sessionId,
      roomId: input.roomId,
      buffer: '',
      detachTimer: null,
      watcher: new SessionWatcher({
        roomId: input.roomId,
        sessionId: input.sessionId,
        agent: input.agent,
        onVendorSessionId: (vendorSessionId) => {
          void sessionService.setVendorSessionId(input.sessionId, vendorSessionId).catch((err) => {
            console.error('[pty-manager] Failed to persist vendor session ID:', err);
          });
        },
      }),
    };

    this.sessions.set(input.sessionId, session);
    session.watcher.start(input.cwd, input.vendorSessionId);

    // PTY output → WebSocket (for terminal display)
    ptyProcess.onData((data: string) => {
      session.buffer = this.appendBuffer(session.buffer, data);
      if (session.ws?.readyState === 1) {
        session.ws.send(JSON.stringify({ type: 'pty.output', sessionId: input.sessionId, data }));
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (session.ws?.readyState === 1) {
        session.ws.send(JSON.stringify({
          type: 'pty.exit',
          sessionId: input.sessionId,
          exitCode,
        }));
      }
      if (session.detachTimer) {
        clearTimeout(session.detachTimer);
      }
      session.watcher.stop();
      this.sessions.delete(input.sessionId);
    });
  }

  /**
   * Attach a WebSocket to an existing PTY session without replaying the buffer.
   * Used when switching back to a session whose Terminal already has the content.
   */
  attach(sessionId: string, ws: WebSocket): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.detachTimer) {
      clearTimeout(session.detachTimer);
      session.detachTimer = null;
    }

    // Detach this WS from any other session first
    this.detachBySocket(ws);

    session.ws = ws;
    return true;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  markSent(sessionId: string, content: string): void {
    const session = this.sessions.get(sessionId);
    session?.watcher.markSent(content);
  }

  /**
   * Wait until the PTY buffer contains a prompt indicator.
   */
  waitUntilReady(sessionId: string, timeoutMs = 15000): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return Promise.reject(new Error('PTY session not found'));

    return new Promise<void>((resolve) => {
      const checkReady = () => {
        return session.buffer.includes('❯') || session.buffer.includes('> ');
      };

      if (checkReady()) { resolve(); return; }

      const startTime = Date.now();
      const interval = setInterval(() => {
        if (checkReady() || Date.now() - startTime > timeoutMs) {
          clearInterval(interval);
          resolve();
        }
      }, 200);
    });
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.ptyProcess.write(data);
    }
  }

  writeForSocket(ws: WebSocket, sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.ws === ws) {
      session.ptyProcess.write(data);
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.ptyProcess.resize(cols, rows);
    }
  }

  resizeForSocket(ws: WebSocket, sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session && session.ws === ws) {
      session.ptyProcess.resize(cols, rows);
    }
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.detachTimer) {
        clearTimeout(session.detachTimer);
      }
      session.watcher.stop();
      session.ptyProcess.kill();
      this.sessions.delete(sessionId);
    }
  }

  killForSocket(ws: WebSocket, sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.ws === ws) {
      this.kill(sessionId);
    }
  }

  killAll(): void {
    for (const [id] of this.sessions) {
      this.kill(id);
    }
  }

  detachBySocket(ws: WebSocket): void {
    for (const session of this.sessions.values()) {
      if (session.ws === ws) {
        session.ws = null;
        this.scheduleDetachCleanup(session);
      }
    }
  }

  /**
   * Write a prompt to the PTY stdin (for chat-to-terminal dispatch).
   */
  dispatchPrompt(input: {
    sessionId: string;
    prompt: string;
  }): void {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new Error(`PTY session ${input.sessionId} is not running`);
    }
    // Write prompt text, then send Enter after a small delay.
    // Some TUIs (Codex) need the Enter sent separately.
    session.ptyProcess.write(input.prompt);
    setTimeout(() => {
      if (this.sessions.has(input.sessionId)) {
        session.ptyProcess.write('\r');
      }
    }, 100);
  }

  private appendBuffer(buffer: string, data: string): string {
    const next = buffer + data;
    if (next.length <= this.maxBufferChars) {
      return next;
    }
    return next.slice(next.length - this.maxBufferChars);
  }

  private scheduleDetachCleanup(session: PtySession): void {
    if (session.detachTimer) {
      clearTimeout(session.detachTimer);
    }
    session.detachTimer = setTimeout(() => {
      const current = this.sessions.get(session.sessionId);
      if (!current || current.ws) {
        return;
      }
      current.watcher.stop();
      current.ptyProcess.kill();
      this.sessions.delete(session.sessionId);
    }, this.detachTtlMs);
  }
}

export const ptyManager = new PtyManager();
