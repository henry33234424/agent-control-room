import { describe, expect, it } from 'vitest';
import { HeadlessTerminalState } from '../src/ws/headless-terminal-state.js';

describe('HeadlessTerminalState', () => {
  it('serializes the current terminal screen with dimensions', async () => {
    const state = new HeadlessTerminalState(20, 4);

    await state.write('hello world');
    const snapshot = await state.snapshot();

    expect(snapshot.cols).toBe(20);
    expect(snapshot.rows).toBe(4);
    expect(snapshot.screen).toContain('hello world');

    state.dispose();
  });

  it('includes alternate-screen content in restore snapshots', async () => {
    const state = new HeadlessTerminalState(20, 4);

    await state.write('\u001b[?1049hALT BUFFER');
    const snapshot = await state.snapshot();

    expect(snapshot.screen).toContain('\u001b[?1049h');
    expect(snapshot.screen).toContain('ALT BUFFER');

    state.dispose();
  });

  it('captures viewport position after scrollback grows', async () => {
    const state = new HeadlessTerminalState(10, 3);

    await state.write('1\r\n2\r\n3\r\n4\r\n5\r\n');
    const snapshot = await state.snapshot();

    expect(snapshot.viewportY).toBeGreaterThan(0);

    state.dispose();
  });
});
