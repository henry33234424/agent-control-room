import { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { createInterface } from 'node:readline';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  id: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * JSON-RPC 2.0 client over stdio (newline-delimited JSON).
 */
export class CodexRpcClient extends EventEmitter {
  private stdin: Writable;
  private pending = new Map<string, PendingRequest>();
  private nextId = 1;
  private alive = true;

  constructor(stdin: Writable, stdout: Readable) {
    super();
    this.stdin = stdin;

    // Parse newline-delimited JSON from stdout
    const rl = createInterface({ input: stdout });
    rl.on('line', (line: string) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line);
        if (msg.id && (msg.result !== undefined || msg.error)) {
          // It's a response
          this.handleResponse(msg as JsonRpcResponse);
        } else if (msg.method && !msg.id) {
          // It's a notification
          this.emit('notification', msg.method, msg.params ?? {});
        }
      } catch {
        // Ignore non-JSON lines (e.g., stderr leaking into stdout)
      }
    });

    rl.on('close', () => {
      this.alive = false;
      this.emit('close');
    });
  }

  get isAlive(): boolean {
    return this.alive;
  }

  /**
   * Send a JSON-RPC request and wait for response.
   */
  async call(method: string, params?: Record<string, unknown>, timeoutMs = 30000): Promise<unknown> {
    const id = String(this.nextId++);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method} (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      const request: JsonRpcRequest = { jsonrpc: '2.0', method, id, params };
      this.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  notify(method: string, params?: Record<string, unknown>): void {
    const notification: JsonRpcNotification = { jsonrpc: '2.0', method, params };
    this.stdin.write(JSON.stringify(notification) + '\n');
  }

  /**
   * Perform the initialize/initialized handshake.
   */
  async initialize(): Promise<unknown> {
    const result = await this.call('initialize', {
      clientInfo: { name: 'control-room', title: 'Control Room', version: '0.1.0' },
      capabilities: { experimentalApi: true, optOutNotificationMethods: [] },
    });
    this.notify('initialized', {});
    return result;
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;

    this.pending.delete(response.id);
    clearTimeout(pending.timer);

    if (response.error) {
      pending.reject(new Error(`RPC error ${response.error.code}: ${response.error.message}`));
    } else {
      pending.resolve(response.result);
    }
  }

  destroy(): void {
    this.alive = false;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('RPC client destroyed'));
    }
    this.pending.clear();
  }
}
