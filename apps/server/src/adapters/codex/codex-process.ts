import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { CodexRpcClient } from './codex-rpc.js';

/**
 * Manages the codex app-server child process lifecycle.
 */
export class CodexProcess extends EventEmitter {
  private process: ChildProcess | null = null;
  private rpc: CodexRpcClient | null = null;
  private restartCount = 0;
  private maxRestarts = 3;

  get client(): CodexRpcClient | null {
    return this.rpc;
  }

  get isAlive(): boolean {
    return this.process !== null && this.process.exitCode === null && (this.rpc?.isAlive ?? false);
  }

  async start(): Promise<CodexRpcClient> {
    if (this.isAlive && this.rpc) return this.rpc;

    // Spawn codex app-server
    const proc = spawn('codex', ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    this.process = proc;

    proc.stderr?.on('data', (chunk: Buffer) => {
      this.emit('stderr', chunk.toString());
    });

    proc.on('exit', (code, signal) => {
      this.emit('exit', code, signal);
      this.rpc?.destroy();
      this.rpc = null;
      this.process = null;
    });

    proc.on('error', (err) => {
      this.emit('error', err);
    });

    // Create RPC client
    this.rpc = new CodexRpcClient(proc.stdin!, proc.stdout!);

    // Forward notifications
    this.rpc.on('notification', (method: string, params: Record<string, unknown>) => {
      this.emit('notification', method, params);
    });

    this.rpc.on('close', () => {
      this.emit('rpc-closed');
    });

    // Perform handshake
    await this.rpc.initialize();
    this.restartCount = 0;

    return this.rpc;
  }

  async ensureAlive(): Promise<CodexRpcClient> {
    if (this.isAlive && this.rpc) return this.rpc;

    if (this.restartCount >= this.maxRestarts) {
      throw new Error(`Codex app-server failed to restart after ${this.maxRestarts} attempts`);
    }

    this.restartCount++;
    this.kill();
    return this.start();
  }

  kill(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.rpc?.destroy();
    this.rpc = null;
  }
}
