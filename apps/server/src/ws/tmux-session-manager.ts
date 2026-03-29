import { execFileSync, spawnSync } from 'node:child_process';

type TmuxSessionState = 'created' | 'existing' | 'unavailable';

class TmuxSessionManager {
  private available: boolean | null = null;

  isAvailable(): boolean {
    if (this.available !== null) {
      return this.available;
    }

    try {
      execFileSync('tmux', ['-V'], { stdio: 'ignore' });
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
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

    if (this.hasSession(input.sessionId)) {
      return 'existing';
    }

    execFileSync('tmux', [
      'new-session',
      '-d',
      '-s',
      this.sessionName(input.sessionId),
      '-x',
      String(input.cols),
      '-y',
      String(input.rows),
      '-c',
      input.cwd,
      input.command,
      ...input.args,
    ], { stdio: 'ignore' });

    return 'created';
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
