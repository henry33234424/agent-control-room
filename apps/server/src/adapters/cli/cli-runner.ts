import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface CLIRunnerOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  onStdoutLine: (line: string) => void | Promise<void>;
  onStderrLine: (line: string) => void | Promise<void>;
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void | Promise<void>;
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
    let pendingHandlers = 0;
    let stdoutClosed = !proc.stdout;
    let stderrClosed = !proc.stderr;
    let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    let finalized = false;

    const maybeFinalize = () => {
      if (finalized || !exitInfo || pendingHandlers > 0 || !stdoutClosed || !stderrClosed) {
        return;
      }
      finalized = true;
      this.proc = null;
      void Promise.resolve(options.onExit(exitInfo.code, exitInfo.signal)).catch((err) => {
        console.error(`[cli-runner] Exit handler failed (${options.command}):`, err);
      });
    };

    const runLineHandler = (
      handler: (line: string) => void | Promise<void>,
      line: string,
      stream: 'stdout' | 'stderr',
    ) => {
      pendingHandlers += 1;
      void Promise.resolve(handler(line))
        .catch((err) => {
          console.error(`[cli-runner] ${stream} handler failed (${options.command}):`, err);
        })
        .finally(() => {
          pendingHandlers -= 1;
          maybeFinalize();
        });
    };

    // Read stdout line by line
    if (proc.stdout) {
      const rl = createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        if (line.trim()) runLineHandler(options.onStdoutLine, line, 'stdout');
      });
      rl.on('close', () => {
        stdoutClosed = true;
        maybeFinalize();
      });
    }

    // Read stderr line by line
    if (proc.stderr) {
      const rl = createInterface({ input: proc.stderr });
      rl.on('line', (line) => {
        if (line.trim()) runLineHandler(options.onStderrLine, line, 'stderr');
      });
      rl.on('close', () => {
        stderrClosed = true;
        maybeFinalize();
      });
    }

    proc.on('exit', (code, signal) => {
      if (!exitInfo) {
        exitInfo = { code, signal };
      }
      maybeFinalize();
    });

    proc.on('error', (err) => {
      console.error(`[cli-runner] Process error (${options.command}):`, err.message);
      if (!exitInfo) {
        exitInfo = { code: 1, signal: null };
      }
      stdoutClosed = true;
      stderrClosed = true;
      proc.stdout?.destroy();
      proc.stderr?.destroy();
      maybeFinalize();
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
