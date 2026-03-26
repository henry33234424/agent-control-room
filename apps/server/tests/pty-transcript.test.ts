import { describe, expect, it } from 'vitest';
import { consumeTerminalInput } from '../src/ws/pty-manager.js';

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
