import { createRequire } from 'node:module';
import type { WebSocket } from '@fastify/websocket';
import type { IPty } from 'node-pty';

// node-pty is a native module that must be loaded via require()
const require_ = createRequire(import.meta.url);
const pty: { spawn: typeof import('node-pty').spawn } = require_('node-pty');

interface PtySession {
  ptyProcess: IPty;
  ws: WebSocket;
  agent: 'claude' | 'codex';
  sessionId: string;
  roomId: string;
}

/**
 * Manages PTY sessions — one per agent session.
 * Bridges PTY I/O with WebSocket for real-time terminal in browser.
 */
class PtyManager {
  private sessions = new Map<string, PtySession>();

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
    // Kill existing PTY for this session if any
    this.kill(input.sessionId);

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
    };

    this.sessions.set(input.sessionId, session);

    // PTY → WebSocket (terminal output to browser)
    ptyProcess.onData((data: string) => {
      if (input.ws.readyState === 1) {
        input.ws.send(JSON.stringify({ type: 'pty.output', sessionId: input.sessionId, data }));
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (input.ws.readyState === 1) {
        input.ws.send(JSON.stringify({
          type: 'pty.exit',
          sessionId: input.sessionId,
          exitCode,
        }));
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

  /**
   * Resize the PTY terminal.
   */
  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.ptyProcess.resize(cols, rows);
    }
  }

  /**
   * Kill a PTY session.
   */
  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
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

  /**
   * Kill all PTY sessions bound to a specific WebSocket (on disconnect).
   */
  killBySocket(ws: WebSocket): void {
    for (const [id, session] of this.sessions) {
      if (session.ws === ws) {
        session.ptyProcess.kill();
        this.sessions.delete(id);
      }
    }
  }
}

export const ptyManager = new PtyManager();
