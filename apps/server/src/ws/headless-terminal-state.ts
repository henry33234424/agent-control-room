import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal } from '@xterm/headless';

export interface TerminalRestoreSnapshot {
  cols: number;
  rows: number;
  screen: string;
  viewportY: number;
}

export class HeadlessTerminalState {
  private terminal: Terminal;
  private serializeAddon: SerializeAddon;
  private queue = Promise.resolve();

  constructor(cols: number, rows: number, scrollback = 10_000) {
    this.terminal = new Terminal({
      cols,
      rows,
      scrollback,
      allowProposedApi: true,
    });
    this.serializeAddon = new SerializeAddon();
    this.terminal.loadAddon(this.serializeAddon as any);
  }

  write(data: string): Promise<void> {
    return this.enqueue(
      () =>
        new Promise<void>((resolve) => {
          this.terminal.write(data, resolve);
        }),
    );
  }

  resize(cols: number, rows: number): Promise<void> {
    return this.enqueue(() => {
      if (cols === this.terminal.cols && rows === this.terminal.rows) {
        return;
      }
      this.terminal.resize(cols, rows);
    });
  }

  snapshot(): Promise<TerminalRestoreSnapshot> {
    return this.enqueue(() => ({
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      screen: this.serializeAddon.serialize(),
      viewportY: this.terminal.buffer.active.viewportY,
    }));
  }

  dispose(): void {
    this.terminal.dispose();
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
