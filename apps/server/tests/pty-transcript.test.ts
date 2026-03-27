import { describe, expect, it } from 'vitest';
import {
  composeTranscriptDraft,
  consumeTerminalInput,
  extractTranscriptDelta,
  sanitizeTerminalText,
} from '../src/ws/pty-manager.js';

describe('consumeTerminalInput', () => {
  it('collects plain text until enter and submits one line', () => {
    expect(consumeTerminalInput('', 'hello\r')).toEqual({
      nextBuffer: '',
      submittedLines: ['hello'],
    });
  });

  it('preserves unfinished input across chunks', () => {
    const first = consumeTerminalInput('', 'hel');
    expect(first).toEqual({ nextBuffer: 'hel', submittedLines: [] });

    expect(consumeTerminalInput(first.nextBuffer, 'lo\r')).toEqual({
      nextBuffer: '',
      submittedLines: ['hello'],
    });
  });

  it('applies backspace before submission', () => {
    expect(consumeTerminalInput('', 'hellp\u007fo\r')).toEqual({
      nextBuffer: '',
      submittedLines: ['hello'],
    });
  });

  it('ignores escape sequences such as arrow keys', () => {
    expect(consumeTerminalInput('', 'hel\u001b[Dlo\r')).toEqual({
      nextBuffer: '',
      submittedLines: ['hello'],
    });
  });

  it('drops blank submissions but keeps buffered text', () => {
    expect(consumeTerminalInput('', '\r')).toEqual({
      nextBuffer: '',
      submittedLines: [],
    });
  });
});

describe('extractTranscriptDelta', () => {
  it('keeps only meaningful assistant text from Claude TUI redraw output', () => {
    const noisy = [
      '\x1b]0;⠂ Claude Code\x07',
      '❯ 嗨！有什么我可以帮你的吗？    ✽ Photosynthesizing…\r\n',
      '────────────────────────────────────\r\n',
      'esc to interrupt ◐ medium · /effort\r\n',
      '[38;2;153;153;153m\r\n',
      'tosizi\r\n',
      'zg\r\n',
    ].join('');

    expect(extractTranscriptDelta('', sanitizeTerminalText(noisy))).toEqual({
      text: '嗨！有什么我可以帮你的吗？\n',
      pendingLine: '',
    });
  });

  it('applies carriage-return overwrite semantics before transcript output', () => {
    expect(extractTranscriptDelta('', 'loading\rfinal answer\r\n')).toEqual({
      text: 'final answer\n',
      pendingLine: '',
    });
  });

  it('holds partial lines until the line is completed', () => {
    expect(extractTranscriptDelta('', 'partial')).toEqual({
      text: '',
      pendingLine: 'partial',
    });
  });

  it('can preview the current pending line before a trailing newline arrives', () => {
    expect(composeTranscriptDraft('', '嗨！有什么我可以帮你的吗？')).toBe(
      '嗨！有什么我可以帮你的吗？\n',
    );
  });
});
