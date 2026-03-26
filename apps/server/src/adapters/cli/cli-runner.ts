import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface CLIRunnerOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  onStdoutLine: (line: string) => void;
  onStderrLine: (line: string) => void;
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
}

/**
 * Spawn a CLI subprocess and stream stdout/stderr line by line.
 */
export class CLIRunner {
  private proc: ChildProcess | null = null;

  spawn(options: CLIRunnerOptions): void {
    const proc = spawn(options.command, options.args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...options.env },
    });

    this.proc = proc;

    // Read stdout line by line
    if (proc.stdout) {
      const rl = createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        if (line.trim()) options.onStdoutLine(line);
      });
    }

    // Read stderr line by line
    if (proc.stderr) {
      const rl = createInterface({ input: proc.stderr });
      rl.on('line', (line) => {
        if (line.trim()) options.onStderrLine(line);
      });
    }

    proc.on('exit', (code, signal) => {
      this.proc = null;
      options.onExit(code, signal);
    });

    proc.on('error', (err) => {
      console.error(`[cli-runner] Process error (${options.command}):`, err.message);
      this.proc = null;
      options.onExit(1, null);
    });
  }

  kill(): void {
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
  }

  get isRunning(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }
}
