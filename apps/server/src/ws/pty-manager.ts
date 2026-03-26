import { createRequire } from 'node:module';
import type { WebSocket } from '@fastify/websocket';
import type { AgentKind } from '@control-room/shared-types';
import type { IPty } from 'node-pty';
import { messageService } from '../services/message-service.js';

// node-pty is a native module that must be loaded via require()
const require_ = createRequire(import.meta.url);
const pty: { spawn: typeof import('node-pty').spawn } = require_('node-pty');

interface ReplyTracking {
  roomId: string;
  sessionId: string;
  agent: AgentKind;
  replyToMessageId?: string;
  replyToReady: Promise<void> | null;
  messageId?: string;
  text: string;
  lastFlushedText: string;
  pendingEcho: string;
  pendingLine: string;
  flushTimer: NodeJS.Timeout | null;
  flushing: boolean;
  needsFlush: boolean;
}

interface PtySession {
  ptyProcess: IPty;
  ws: WebSocket | null;
  agent: AgentKind;
  sessionId: string;
  roomId: string;
  buffer: string;
  detachTimer: NodeJS.Timeout | null;
  replyTracking: ReplyTracking | null;
  inputBuffer: string;
}

class PtyManager {
  private sessions = new Map<string, PtySession>();
  private maxBufferChars = 200_000;
  private detachTtlMs = 10 * 60 * 1000;
  private flushDebounceMs = 300;

  start(input: {
    sessionId: string;
    roomId: string;
    agent: AgentKind;
    command: string;
    args: string[];
    cwd: string;
    ws?: WebSocket | null;
    cols?: number;
    rows?: number;
  }): void {
    if (input.ws) {
      this.detachBySocket(input.ws);
    }

    const existing = this.sessions.get(input.sessionId);
    if (existing) {
      if (existing.detachTimer) {
        clearTimeout(existing.detachTimer);
        existing.detachTimer = null;
      }
      if (input.ws) {
        existing.ws = input.ws;
        existing.ptyProcess.resize(input.cols ?? 120, input.rows ?? 40);
        if (existing.buffer && input.ws.readyState === 1) {
          input.ws.send(JSON.stringify({ type: 'pty.output', sessionId: input.sessionId, data: existing.buffer }));
        }
      }
      return;
    }

    const ptyProcess = pty.spawn(input.command, input.args, {
      name: 'xterm-256color',
      cols: input.cols ?? 120,
      rows: input.rows ?? 40,
      cwd: input.cwd,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    });

    const session: PtySession = {
      ptyProcess,
      ws: input.ws ?? null,
      agent: input.agent,
      sessionId: input.sessionId,
      roomId: input.roomId,
      buffer: '',
      detachTimer: null,
      replyTracking: null,
      inputBuffer: '',
    };

    this.sessions.set(input.sessionId, session);

    ptyProcess.onData((data: string) => {
      session.buffer = this.appendBuffer(session.buffer, data);
      if (session.ws?.readyState === 1) {
        session.ws.send(JSON.stringify({ type: 'pty.output', sessionId: input.sessionId, data }));
      }
      this.handleTranscriptChunk(session, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      void this.finalizeReplyTracking(session, session.replyTracking);
      if (session.ws?.readyState === 1) {
        session.ws.send(JSON.stringify({
          type: 'pty.exit',
          sessionId: input.sessionId,
          exitCode,
        }));
      }
      if (session.detachTimer) {
        clearTimeout(session.detachTimer);
      }
      this.sessions.delete(input.sessionId);
    });
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.ptyProcess.write(data);
    }
  }

  async writeForSocket(ws: WebSocket, sessionId: string, data: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session && session.ws === ws) {
      await this.captureManualInput(session, data);
      session.ptyProcess.write(data);
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.ptyProcess.resize(cols, rows);
    }
  }

  resizeForSocket(ws: WebSocket, sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session && session.ws === ws) {
      session.ptyProcess.resize(cols, rows);
    }
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.detachTimer) {
        clearTimeout(session.detachTimer);
      }
      if (session.replyTracking?.flushTimer) {
        clearTimeout(session.replyTracking.flushTimer);
      }
      session.ptyProcess.kill();
      this.sessions.delete(sessionId);
    }
  }

  killForSocket(ws: WebSocket, sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.ws === ws) {
      this.kill(sessionId);
    }
  }

  killAll(): void {
    for (const [id] of this.sessions) {
      this.kill(id);
    }
  }

  detachBySocket(ws: WebSocket): void {
    for (const session of this.sessions.values()) {
      if (session.ws === ws) {
        session.ws = null;
        this.scheduleDetachCleanup(session);
      }
    }
  }

  async dispatchPrompt(input: {
    roomId: string;
    sessionId: string;
    agent: AgentKind;
    prompt: string;
    replyToMessageId?: string;
  }): Promise<void> {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new Error(`PTY session ${input.sessionId} is not running`);
    }

    await this.finalizeReplyTracking(session, session.replyTracking);

    session.replyTracking = this.createReplyTracking({
      roomId: input.roomId,
      sessionId: input.sessionId,
      agent: input.agent,
      replyToMessageId: input.replyToMessageId,
      pendingEcho: input.prompt,
    });

    session.ptyProcess.write(`${input.prompt}\r`);
  }

  private async captureManualInput(session: PtySession, data: string): Promise<void> {
    const consumed = consumeTerminalInput(session.inputBuffer, data);
    session.inputBuffer = consumed.nextBuffer;

    for (const line of consumed.submittedLines) {
      await this.beginManualTurn(session, line);
    }
  }

  private async beginManualTurn(session: PtySession, line: string): Promise<void> {
    await this.finalizeReplyTracking(session, session.replyTracking);

    const tracking = this.createReplyTracking({
      roomId: session.roomId,
      sessionId: session.sessionId,
      agent: session.agent,
      pendingEcho: line,
    });

    tracking.replyToReady = messageService
      .create({
        roomId: session.roomId,
        sessionId: session.sessionId,
        agent: session.agent,
        role: 'user',
        content: line,
        selectable: true,
      })
      .then((msg) => {
        tracking.replyToMessageId = msg.id;
      })
      .catch((err) => {
        console.error('Failed to persist terminal input transcript:', err);
      });

    session.replyTracking = tracking;
  }

  private appendBuffer(buffer: string, data: string): string {
    const next = buffer + data;
    if (next.length <= this.maxBufferChars) {
      return next;
    }
    return next.slice(next.length - this.maxBufferChars);
  }

  private scheduleDetachCleanup(session: PtySession): void {
    if (session.detachTimer) {
      clearTimeout(session.detachTimer);
    }
    session.detachTimer = setTimeout(() => {
      const current = this.sessions.get(session.sessionId);
      if (!current || current.ws) {
        return;
      }
      current.ptyProcess.kill();
      this.sessions.delete(session.sessionId);
    }, this.detachTtlMs);
  }

  private handleTranscriptChunk(session: PtySession, rawData: string): void {
    const tracking = session.replyTracking;
    if (!tracking) return;

    const sanitized = sanitizeTerminalText(rawData);
    if (!sanitized) return;

    const suppressed = suppressPromptEcho(sanitized, tracking.pendingEcho);
    tracking.pendingEcho = suppressed.pendingEcho;

    if (!suppressed.text) return;

    const extracted = extractTranscriptDelta(tracking.pendingLine, suppressed.text);
    tracking.pendingLine = extracted.pendingLine;

    if (!extracted.text) return;

    tracking.text += extracted.text;
    this.scheduleReplyFlush(session);
  }

  private scheduleReplyFlush(session: PtySession): void {
    const tracking = session.replyTracking;
    if (!tracking) return;

    if (tracking.flushTimer) {
      clearTimeout(tracking.flushTimer);
    }

    tracking.flushTimer = setTimeout(() => {
      tracking.flushTimer = null;
      void this.flushReplyTracking(session);
    }, this.flushDebounceMs);
  }

  private async flushReplyTracking(session: PtySession): Promise<void> {
    const tracking = session.replyTracking;
    if (!tracking) return;

    if (tracking.flushing) {
      tracking.needsFlush = true;
      return;
    }

    const normalizedText = tracking.text.trim();
    if (!normalizedText || normalizedText === tracking.lastFlushedText) {
      return;
    }

    tracking.flushing = true;
    try {
      const content = renderTranscriptMessage(tracking.text);
      if (!tracking.messageId && tracking.replyToReady) {
        await tracking.replyToReady;
      }
      if (!tracking.messageId) {
        const msg = await messageService.create({
          roomId: tracking.roomId,
          sessionId: tracking.sessionId,
          agent: tracking.agent,
          role: 'agent',
          content,
          replyToMessageId: tracking.replyToMessageId,
          selectable: true,
        });
        tracking.messageId = msg.id;
      } else {
        await messageService.update({ id: tracking.messageId, content });
      }

      tracking.lastFlushedText = normalizedText;
    } finally {
      tracking.flushing = false;
      if (tracking.needsFlush) {
        tracking.needsFlush = false;
        void this.flushReplyTracking(session);
      }
    }
  }

  private async finalizeReplyTracking(
    session: PtySession,
    tracking: ReplyTracking | null,
  ): Promise<void> {
    if (!tracking) return;

    if (tracking.flushTimer) {
      clearTimeout(tracking.flushTimer);
      tracking.flushTimer = null;
    }

    const tail = flushPendingTranscriptLine(tracking.pendingLine);
    if (tail) {
      tracking.text += tail;
    }
    tracking.pendingLine = '';

    if (session.replyTracking !== tracking) {
      return;
    }

    await this.flushReplyTracking(session);
    if (session.replyTracking === tracking) {
      session.replyTracking = null;
    }
  }

  private createReplyTracking(input: {
    roomId: string;
    sessionId: string;
    agent: AgentKind;
    replyToMessageId?: string;
    pendingEcho: string;
  }): ReplyTracking {
    return {
      roomId: input.roomId,
      sessionId: input.sessionId,
      agent: input.agent,
      replyToMessageId: input.replyToMessageId,
      replyToReady: null,
      text: '',
      lastFlushedText: '',
      pendingEcho: input.pendingEcho,
      pendingLine: '',
      flushTimer: null,
      flushing: false,
      needsFlush: false,
    };
  }
}

export function sanitizeTerminalText(data: string): string {
  return data
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1bP[\s\S]*?\x1b\\/g, '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/\[\d+(;\d+)*m/g, '')
    .replace(/\u0007/g, '')
    .replace(/\u001b>/g, '')
    .replace(/\u001b=/g, '');
}

function suppressPromptEcho(
  text: string,
  pendingEcho: string,
): { text: string; pendingEcho: string } {
  if (!pendingEcho || !text) {
    return { text, pendingEcho };
  }

  let textIndex = 0;
  let echoIndex = 0;

  while (textIndex < text.length && echoIndex < pendingEcho.length) {
    if (text[textIndex] === pendingEcho[echoIndex]) {
      textIndex += 1;
      echoIndex += 1;
      continue;
    }
    if (text[textIndex] === '\n' && pendingEcho[echoIndex] === '\r') {
      echoIndex += 1;
      continue;
    }
    break;
  }

  return {
    text: text.slice(textIndex),
    pendingEcho: pendingEcho.slice(echoIndex),
  };
}

export function consumeTerminalInput(
  buffer: string,
  data: string,
): { nextBuffer: string; submittedLines: string[] } {
  let nextBuffer = buffer;
  const submittedLines: string[] = [];

  for (let i = 0; i < data.length; i += 1) {
    const char = data[i];

    if (char === '\u001b') {
      i = skipEscapeSequence(data, i);
      continue;
    }

    if (char === '\r' || char === '\n') {
      const line = nextBuffer.trimEnd();
      if (line.trim()) {
        submittedLines.push(line);
      }
      nextBuffer = '';
      if (char === '\r' && data[i + 1] === '\n') {
        i += 1;
      }
      continue;
    }

    if (char === '\u007f' || char === '\b') {
      nextBuffer = nextBuffer.slice(0, -1);
      continue;
    }

    if (char === '\t') {
      nextBuffer += char;
      continue;
    }

    if (isPrintableTerminalChar(char)) {
      nextBuffer += char;
    }
  }

  return { nextBuffer, submittedLines };
}

export function extractTranscriptDelta(
  pendingLine: string,
  data: string,
): { text: string; pendingLine: string } {
  let currentLine = pendingLine;
  const accepted: string[] = [];

  for (let i = 0; i < data.length; i += 1) {
    const char = data[i];

    if (char === '\r') {
      if (data[i + 1] === '\n') {
        const line = filterTranscriptLine(currentLine);
        if (line !== null) accepted.push(line);
        currentLine = '';
        i += 1;
      } else {
        currentLine = '';
      }
      continue;
    }

    if (char === '\n') {
      const line = filterTranscriptLine(currentLine);
      if (line !== null) accepted.push(line);
      currentLine = '';
      continue;
    }

    currentLine += char;
  }

  return {
    text: joinTranscriptLines(accepted),
    pendingLine: currentLine,
  };
}

function flushPendingTranscriptLine(pendingLine: string): string {
  const line = filterTranscriptLine(pendingLine);
  return line === null ? '' : joinTranscriptLines([line]);
}

function joinTranscriptLines(lines: string[]): string {
  if (lines.length === 0) return '';

  const compacted: string[] = [];
  for (const line of lines) {
    if (line === '') {
      if (compacted.length === 0 || compacted[compacted.length - 1] === '') continue;
      compacted.push(line);
      continue;
    }
    compacted.push(line);
  }

  while (compacted.length > 0 && compacted[compacted.length - 1] === '') {
    compacted.pop();
  }

  return compacted.length > 0 ? `${compacted.join('\n')}\n` : '';
}

function filterTranscriptLine(line: string): string | null {
  const trimmedRight = line.replace(/[ \t]+$/g, '');
  const trimmed = trimmedRight.trim();

  if (!trimmed) {
    return '';
  }

  let normalized = trimmedRight
    .replace(/^❯\s*/u, '')
    .replace(/\s*[✻✽✶✳◐◑◒◓◴◵◶◷⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏].*$/u, '')
    .replace(/\s{2,}/g, ' ')
    .trimEnd();

  if (!normalized.trim()) {
    return null;
  }

  const candidate = normalized.trim();

  if (
    /Claude Code/i.test(candidate) ||
    /Photosynthesizing/i.test(candidate) ||
    /esc\s*to\s*interrupt/i.test(candidate) ||
    /\/effort/i.test(candidate) ||
    /^0;/.test(candidate) ||
    /^[\u2500-\u257f\s]+$/u.test(candidate) ||
    /^[✻✽✶✳◐◑◒◓◴◵◶◷⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\s]+$/u.test(candidate)
  ) {
    return null;
  }

  if (/^[a-z]{1,12}…?$/u.test(candidate)) {
    return null;
  }

  return normalized;
}

function skipEscapeSequence(data: string, index: number): number {
  const next = data[index + 1];
  if (!next) return index;

  if (next === '[') {
    let cursor = index + 2;
    while (cursor < data.length) {
      const code = data.charCodeAt(cursor);
      if (code >= 0x40 && code <= 0x7e) {
        return cursor;
      }
      cursor += 1;
    }
    return data.length - 1;
  }

  if (next === 'O') {
    return Math.min(index + 2, data.length - 1);
  }

  return Math.min(index + 1, data.length - 1);
}

function isPrintableTerminalChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 0x20 && code !== 0x7f;
}

function renderTranscriptMessage(text: string): string {
  const safe = text.replace(/```/g, '``` ');
  return `\`\`\`text\n${safe}\n\`\`\``;
}

export const ptyManager = new PtyManager();
