import { execFileSync, spawnSync } from 'node:child_process';

type TmuxSessionState = 'created' | 'existing' | 'unavailable';

class TmuxSessionManager {
  private available: boolean | null = null;

  isAvailable(): boolean {
    // tmux disabled — mouse wheel scrolling doesn't work through the tmux PTY chain.
    // All attempts (mouse on/off, WheelUpPane bindings, terminal-overrides) failed.
    // Without tmux, xterm.js scrollback works natively.
    return false;
  }

  ensureSession(input: {
    sessionId: string;
    cwd: string;
    command: string;
    args: string[];
    cols: number;
    rows: number;
  }): TmuxSessionState {
    if (!this.isAvailable()) {
      return 'unavailable';
    }

    const name = this.sessionName(input.sessionId);

    if (this.hasSession(input.sessionId)) {
      this.configureSession(name);
      return 'existing';
    }

    execFileSync('tmux', [
      'new-session',
      '-d',
      '-s',
      name,
      '-x',
      String(input.cols),
      '-y',
      String(input.rows),
      '-c',
      input.cwd,
      input.command,
      ...input.args,
    ], { stdio: 'ignore' });

    this.configureSession(name);
    return 'created';
  }

  private configureSession(name: string): void {
    // Enable mouse support, but keep tmux history scrolling available when the
    // pane program is not actively requesting mouse events.
    try {
      execFileSync('tmux', ['set-option', '-t', name, 'mouse', 'on'], { stdio: 'ignore' });
      execFileSync('tmux', ['set-option', '-t', name, 'status', 'off'], { stdio: 'ignore' });

      // Standard passthrough pattern:
      // - if the pane app has enabled mouse tracking, forward the wheel event
      // - otherwise, WheelUp enters tmux copy-mode with auto-exit at bottom
      execFileSync('tmux', [
        'bind-key',
        '-T',
        'root',
        'WheelUpPane',
        'if-shell',
        '-Ft=',
        '#{mouse_any_flag}',
        'select-pane -t= \\; send-keys -M',
        'copy-mode -et=',
      ], { stdio: 'ignore' });
      execFileSync('tmux', [
        'bind-key',
        '-T',
        'root',
        'WheelDownPane',
        'select-pane',
        '-t=',
        '\\;',
        'send-keys',
        '-M',
      ], { stdio: 'ignore' });
    } catch {
      // Best-effort
    }
  }

  hasSession(sessionId: string): boolean {
    if (!this.isAvailable()) {
      return false;
    }

    const result = spawnSync('tmux', ['has-session', '-t', this.sessionName(sessionId)], {
      stdio: 'ignore',
    });
    return result.status === 0;
  }

  resizeSession(sessionId: string, cols: number, rows: number): void {
    if (!this.hasSession(sessionId)) {
      return;
    }

    try {
      execFileSync('tmux', [
        'resize-window',
        '-t',
        `${this.sessionName(sessionId)}:0`,
        '-x',
        String(cols),
        '-y',
        String(rows),
      ], { stdio: 'ignore' });
    } catch {
      // Best-effort only
    }
  }

  killSession(sessionId: string): void {
    if (!this.hasSession(sessionId)) {
      return;
    }

    try {
      execFileSync('tmux', ['kill-session', '-t', this.sessionName(sessionId)], { stdio: 'ignore' });
    } catch {
      // Best-effort only
    }
  }

  attachCommand(sessionId: string): { command: string; args: string[] } {
    return {
      command: 'tmux',
      args: ['attach-session', '-t', this.sessionName(sessionId)],
    };
  }

  private sessionName(sessionId: string): string {
    return `control-room-${sessionId}`;
  }
}

export const tmuxSessionManager = new TmuxSessionManager();
