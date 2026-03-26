import { createRequire } from 'node:module';
import type { WebSocket } from '@fastify/websocket';
import type { IPty } from 'node-pty';

// node-pty is a native module that must be loaded via require()
const require_ = createRequire(import.meta.url);
const pty: { spawn: typeof import('node-pty').spawn } = require_('node-pty');

interface PtySession {
  ptyProcess: IPty;
  ws: WebSocket | null;
  agent: 'claude' | 'codex';
  sessionId: string;
  roomId: string;
  buffer: string;
  detachTimer: NodeJS.Timeout | null;
}

/**
 * Manages PTY sessions — one per agent session.
 * Bridges PTY I/O with WebSocket for real-time terminal in browser.
 */
class PtyManager {
  private sessions = new Map<string, PtySession>();
  private maxBufferChars = 200_000;
  private detachTtlMs = 10 * 60 * 1000;

  /**
   * Spawn a CLI in a real PTY and wire it to the WebSocket.
   */
  start(input: {
    sessionId: string;
    roomId: string;
    agent: 'claude' | 'codex';
    command: string;
    args: string[];
    cwd: string;
    ws: WebSocket;
    cols?: number;
    rows?: number;
  }): void {
    this.detachBySocket(input.ws);

    const existing = this.sessions.get(input.sessionId);
    if (existing) {
      if (existing.detachTimer) {
        clearTimeout(existing.detachTimer);
        existing.detachTimer = null;
      }
      existing.ws = input.ws;
      existing.ptyProcess.resize(input.cols ?? 120, input.rows ?? 40);
      if (existing.buffer && input.ws.readyState === 1) {
        input.ws.send(JSON.stringify({ type: 'pty.output', sessionId: input.sessionId, data: existing.buffer }));
      }
      return;
    }

    const ptyProcess = pty.spawn(input.command, input.args, {
      name: 'xterm-256color',
      cols: input.cols ?? 120,
      rows: input.rows ?? 40,
      cwd: input.cwd,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    });

    const session: PtySession = {
      ptyProcess,
      ws: input.ws,
      agent: input.agent,
      sessionId: input.sessionId,
      roomId: input.roomId,
      buffer: '',
      detachTimer: null,
    };

    this.sessions.set(input.sessionId, session);

    // PTY → WebSocket (terminal output to browser)
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
      this.sessions.delete(input.sessionId);
    });
  }

  /**
   * Forward keyboard input from browser to PTY.
   */
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

  /**
   * Resize the PTY terminal.
   */
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

  /**
   * Kill a PTY session.
   */
  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.detachTimer) {
        clearTimeout(session.detachTimer);
      }
      session.ptyProcess.kill();
      this.sessions.delete(sessionId);
    }
  }

  killForSocket(ws: WebSocket, sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.ws === ws) {
      if (session.detachTimer) {
        clearTimeout(session.detachTimer);
      }
      session.ptyProcess.kill();
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Kill all PTY sessions.
   */
  killAll(): void {
    for (const [id] of this.sessions) {
      this.kill(id);
    }
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  detachBySocket(ws: WebSocket): void {
    for (const session of this.sessions.values()) {
      if (session.ws === ws) {
        session.ws = null;
        this.scheduleDetachCleanup(session);
      }
    }
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
      current.ptyProcess.kill();
      this.sessions.delete(session.sessionId);
    }, this.detachTtlMs);
  }
}

export const ptyManager = new PtyManager();
