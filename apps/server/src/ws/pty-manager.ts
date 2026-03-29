import { createRequire } from 'node:module';
import type { WebSocket } from '@fastify/websocket';
import type { AgentKind, WsPtyRestore } from '@control-room/shared-types';
import type { IPty } from 'node-pty';
import { interactiveTerminalStateService } from '../services/interactive-terminal-state-service.js';
import { sessionService } from '../services/session-service.js';
import { SessionWatcher } from './session-watcher.js';
import { HeadlessTerminalState, type TerminalRestoreSnapshot } from './headless-terminal-state.js';
import { tmuxSessionManager } from './tmux-session-manager.js';
const require_ = createRequire(import.meta.url);
const pty: { spawn: typeof import('node-pty').spawn } = require_('node-pty');

interface PtySession {
  ptyProcess: IPty;
  ws: WebSocket | null;
  agent: AgentKind;
  sessionId: string;
  roomId: string;
  buffer: string;
  screen: HeadlessTerminalState;
  restoreSequence: number;
  restoreBacklog: string;
  restoring: boolean;
  watcher: SessionWatcher;
  snapshotTimer: ReturnType<typeof setTimeout> | null;
  backend: 'direct' | 'tmux';
}

/**
 * Manages PTY sessions.
 * PTY handles terminal I/O only.
 * SessionWatcher (separate) handles chat message sync by reading JSONL files.
 */
class PtyManager {
  private sessions = new Map<string, PtySession>();
  private maxBufferChars = 200_000;
  private snapshotPersistDelayMs = 1000;
  private shuttingDown = false;

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
    initialSnapshot?: TerminalRestoreSnapshot;
  }): void {
    if (input.ws) {
      this.detachBySocket(input.ws);
    }

    // Reattach to existing session
    const existing = this.sessions.get(input.sessionId);
    if (existing) {
      if (input.ws) {
        existing.ws = input.ws;
        void this.restoreSocket(existing, input.ws);
      }
      return;
    }

    const cols = input.initialSnapshot?.cols ?? input.cols ?? 120;
    const rows = input.initialSnapshot?.rows ?? input.rows ?? 40;
    const tmuxState = tmuxSessionManager.ensureSession({
      sessionId: input.sessionId,
      cwd: input.cwd,
      command: input.command,
      args: input.args,
      cols,
      rows,
    });
    const usingTmux = tmuxState !== 'unavailable';
    const processCommand = usingTmux
      ? tmuxSessionManager.attachCommand(input.sessionId)
      : { command: input.command, args: input.args };
    const ptyProcess = pty.spawn(processCommand.command, processCommand.args, {
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
      screen: new HeadlessTerminalState(cols, rows),
      restoreSequence: 0,
      restoreBacklog: '',
      restoring: false,
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
      snapshotTimer: null,
      backend: usingTmux ? 'tmux' : 'direct',
    };

    const shouldSeedSnapshot = !usingTmux && Boolean(input.initialSnapshot?.screen);

    if (shouldSeedSnapshot && input.initialSnapshot?.screen) {
      void session.screen.write(input.initialSnapshot.screen);
      if (input.initialSnapshot.cols !== cols || input.initialSnapshot.rows !== rows) {
        void session.screen.resize(cols, rows);
      }
    }

    this.sessions.set(input.sessionId, session);
    session.watcher.start(input.cwd, input.vendorSessionId);
    void interactiveTerminalStateService.update(input.sessionId, {
      active: true,
      snapshot: input.initialSnapshot,
    }).catch((err) => {
      console.error('[pty-manager] Failed to persist interactive session state:', err);
    });
    if (session.ws?.readyState === 1) {
      if (shouldSeedSnapshot && input.initialSnapshot) {
        session.ws.send(JSON.stringify(this.toRestoreEvent(input.sessionId, input.initialSnapshot)));
      }
      session.ws.send(JSON.stringify({
        type: 'pty.started',
        sessionId: input.sessionId,
        restored: Boolean(shouldSeedSnapshot),
      }));
    }

    // PTY output → WebSocket (for terminal display)
    ptyProcess.onData((data: string) => {
      session.buffer = this.appendBuffer(session.buffer, data);
      void session.screen.write(data);
      this.scheduleSnapshotPersist(session);
      if (session.ws?.readyState === 1) {
        if (session.restoring) {
          session.restoreBacklog = this.appendBuffer(session.restoreBacklog, data);
        } else {
          session.ws.send(JSON.stringify({ type: 'pty.output', sessionId: input.sessionId, data }));
        }
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (session.snapshotTimer) {
        clearTimeout(session.snapshotTimer);
        session.snapshotTimer = null;
      }
      const persistentSessionStillExists = session.backend === 'tmux' && tmuxSessionManager.hasSession(input.sessionId);

      if (this.shuttingDown && persistentSessionStillExists) {
        this.sessions.delete(input.sessionId);
        return;
      }

      if (session.ws?.readyState === 1) {
        session.ws.send(JSON.stringify({
          type: 'pty.exit',
          sessionId: input.sessionId,
          exitCode,
        }));
      }
      session.watcher.stop();
      this.sessions.delete(input.sessionId);
      void this.persistSnapshot(session, {
        active: persistentSessionStillExists,
        immediate: true,
      }).finally(() => {
        session.screen.dispose();
      });
    });
  }

  async attach(sessionId: string, ws: WebSocket): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    // Detach this WS from any other session first
    this.detachBySocket(ws);

    session.ws = ws;
    await this.restoreSocket(session, ws);
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
      void session.screen.resize(cols, rows);
      session.ptyProcess.resize(cols, rows);
      if (session.backend === 'tmux') {
        tmuxSessionManager.resizeSession(sessionId, cols, rows);
      }
      this.scheduleSnapshotPersist(session);
    }
  }

  resizeForSocket(ws: WebSocket, sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session && session.ws === ws) {
      void session.screen.resize(cols, rows);
      session.ptyProcess.resize(cols, rows);
      if (session.backend === 'tmux') {
        tmuxSessionManager.resizeSession(sessionId, cols, rows);
      }
      this.scheduleSnapshotPersist(session);
    }
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.snapshotTimer) {
        clearTimeout(session.snapshotTimer);
        session.snapshotTimer = null;
      }
      void interactiveTerminalStateService.update(sessionId, { active: false }).catch((err) => {
        console.error('[pty-manager] Failed to mark interactive session inactive:', err);
      });
      if (session.backend === 'tmux') {
        tmuxSessionManager.killSession(sessionId);
      }
      session.ptyProcess.kill();
      return;
    }

    tmuxSessionManager.killSession(sessionId);
    void interactiveTerminalStateService.update(sessionId, { active: false }).catch((err) => {
      console.error('[pty-manager] Failed to mark interactive session inactive:', err);
    });
  }

  hasPersistentSession(sessionId: string): boolean {
    return tmuxSessionManager.hasSession(sessionId);
  }

  async prepareForShutdown(): Promise<void> {
    this.shuttingDown = true;
    await Promise.all(
      Array.from(this.sessions.values()).map((session) => this.persistSnapshot(session, { active: true, immediate: true })),
    );
  }

  isTmuxEnabled(): boolean {
    return tmuxSessionManager.isAvailable();
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
        void this.persistSnapshot(session, { active: true, immediate: true });
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

  private scheduleSnapshotPersist(session: PtySession): void {
    if (session.snapshotTimer) {
      return;
    }

    session.snapshotTimer = setTimeout(() => {
      session.snapshotTimer = null;
      void this.persistSnapshot(session, { active: true });
    }, this.snapshotPersistDelayMs);
  }

  private async persistSnapshot(
    session: PtySession,
    input: { active: boolean; immediate?: boolean },
  ): Promise<void> {
    try {
      const snapshot = await session.screen.snapshot();
      await interactiveTerminalStateService.update(session.sessionId, {
        active: input.active,
        snapshot,
      });
    } catch (err) {
      if (input.immediate) {
        console.error('[pty-manager] Failed to persist terminal snapshot:', err);
      }
    }
  }

  private async restoreSocket(session: PtySession, ws: WebSocket): Promise<void> {
    const restoreSequence = session.restoreSequence + 1;
    session.restoreSequence = restoreSequence;
    session.restoring = true;
    session.restoreBacklog = '';

    const snapshot = await session.screen.snapshot();
    if (session.ws !== ws || restoreSequence !== session.restoreSequence) {
      return;
    }

    if (ws.readyState === 1) {
      ws.send(JSON.stringify(this.toRestoreEvent(session.sessionId, snapshot)));
      ws.send(JSON.stringify({
        type: 'pty.started',
        sessionId: session.sessionId,
        restored: true,
      }));
      if (session.restoreBacklog) {
        ws.send(JSON.stringify({
          type: 'pty.output',
          sessionId: session.sessionId,
          data: session.restoreBacklog,
        }));
      }
    }

    if (restoreSequence === session.restoreSequence) {
      session.restoring = false;
      session.restoreBacklog = '';
    }

    this.scheduleSnapshotPersist(session);
  }

  private toRestoreEvent(
    sessionId: string,
    snapshot: Awaited<ReturnType<HeadlessTerminalState['snapshot']>>,
  ): WsPtyRestore {
    return {
      type: 'pty.restore',
      sessionId,
      screen: snapshot.screen,
      cols: snapshot.cols,
      rows: snapshot.rows,
      viewportY: snapshot.viewportY,
    };
  }
}

export const ptyManager = new PtyManager();
