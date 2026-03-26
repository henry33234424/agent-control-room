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
  messageId?: string;
  text: string;
  lastFlushedText: string;
  pendingEcho: string;
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
      void this.finalizeReplyTracking(session);
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

  writeForSocket(ws: WebSocket, sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.ws === ws) {
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

  dispatchPrompt(input: {
    roomId: string;
    sessionId: string;
    agent: AgentKind;
    prompt: string;
    replyToMessageId?: string;
  }): void {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new Error(`PTY session ${input.sessionId} is not running`);
    }

    void this.finalizeReplyTracking(session);

    session.replyTracking = {
      roomId: input.roomId,
      sessionId: input.sessionId,
      agent: input.agent,
      replyToMessageId: input.replyToMessageId,
      text: '',
      lastFlushedText: '',
      pendingEcho: input.prompt,
      flushTimer: null,
      flushing: false,
      needsFlush: false,
    };

    session.ptyProcess.write(`${input.prompt}\r`);
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

    tracking.text += suppressed.text;
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

  private async finalizeReplyTracking(session: PtySession): Promise<void> {
    const tracking = session.replyTracking;
    if (!tracking) return;

    if (tracking.flushTimer) {
      clearTimeout(tracking.flushTimer);
      tracking.flushTimer = null;
    }

    await this.flushReplyTracking(session);
    session.replyTracking = null;
  }
}

function sanitizeTerminalText(data: string): string {
  return data
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/\u0007/g, '')
    .replace(/\r/g, '')
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

function renderTranscriptMessage(text: string): string {
  const safe = text.replace(/```/g, '``` ');
  return `\`\`\`text\n${safe}\n\`\`\``;
}

export const ptyManager = new PtyManager();
