import { describe, expect, it } from 'vitest';
import { extractAgentBlocks } from '../src/ws/screen-extractor.js';

describe('extractAgentBlocks', () => {
  it('drops transient status headers and keeps only the assistant answer', () => {
    const lines = [
      '· Zigzagging…',
      '测试收到！有什么可以帮你的？',
      '❯ ',
    ];

    expect(extractAgentBlocks(lines)).toBe('测试收到！有什么可以帮你的？');
  });

  it('deduplicates repeated answer blocks caused by TUI redraw', () => {
    const lines = [
      '· Zigzagging…',
      '测试收到！有什么可以帮你的？',
      '· Slithering…',
      '测试收到！有什么可以帮你的？',
      '❯ ',
    ];

    expect(extractAgentBlocks(lines)).toBe('测试收到！有什么可以帮你的？');
  });
});
