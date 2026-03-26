import { randomUUID } from 'node:crypto';
import type { RuntimeEvent } from '@control-room/shared-types';

export interface CodexCLIContext {
  roomId: string;
  sessionId: string;
  runId: string;
  worktreeId?: string;
}

export interface CodexCLIParseResult {
  events: RuntimeEvent[];
  resultText?: string;
}

/**
 * Parse a single JSONL line from `codex exec --json`.
 * The exact format varies by Codex CLI version — we handle multiple shapes.
 */
export function parseCodexJsonlLine(
  line: string,
  ctx: CodexCLIContext,
): CodexCLIParseResult {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(line);
  } catch {
    return {
      events: [
        {
          id: randomUUID(),
          roomId: ctx.roomId,
          agent: 'codex',
          sessionId: ctx.sessionId,
          runId: ctx.runId,
          worktreeId: ctx.worktreeId,
          kind: 'command.stdout',
          text: line,
          level: 'info',
          ts: new Date().toISOString(),
        },
      ],
    };
  }

  const base = {
    roomId: ctx.roomId,
    agent: 'codex' as const,
    sessionId: ctx.sessionId,
    runId: ctx.runId,
    worktreeId: ctx.worktreeId,
    ts: new Date().toISOString(),
  };

  const result: CodexCLIParseResult = { events: [] };

  // Codex JSONL events may use "type" or "event" field
  const eventType = (msg.type as string) ?? (msg.event as string) ?? '';

  // Also handle nested "item" structure from Codex
  const item = (msg.item as Record<string, unknown>) ?? msg;
  const itemType = (item.type as string) ?? eventType;

  switch (eventType) {
    // Thread lifecycle (Codex CLI uses dot-separated names)
    case 'thread.started':
    case 'turn.started':
      // No user-facing event needed, just log
      result.events.push({
        ...base,
        id: randomUUID(),
        kind: 'system.log',
        title: eventType,
        text: JSON.stringify(msg).slice(0, 200),
        level: 'debug',
      });
      break;

    // Item completed — this is where Codex puts its actual response
    case 'item.completed': {
      const itemData = (msg.item as Record<string, unknown>) ?? msg;
      const itemKind = (itemData.type as string) ?? '';
      const text = (itemData.text as string) ?? extractText(itemData);

      if (itemKind === 'agent_message' && text) {
        result.events.push({
          ...base,
          id: randomUUID(),
          kind: 'message.delta',
          text,
          level: 'info',
        });
        result.resultText = text;
      } else if (text) {
        result.events.push({
          ...base,
          id: randomUUID(),
          kind: 'tool.completed',
          title: itemKind,
          text: text.slice(0, 2000),
          level: 'info',
        });
      }
      break;
    }

    // Turn completed — final result
    case 'turn.completed': {
      if (!result.resultText) {
        // Try to extract from turn data
        const text = extractText(msg);
        if (text) result.resultText = text;
      }
      result.events.push({
        ...base,
        id: randomUUID(),
        kind: 'run.completed',
        title: 'Codex turn completed',
        text: result.resultText ?? '',
        level: 'info',
      });
      break;
    }

    case 'agent_message':
    case 'message':
    case 'agentMessage': {
      const text = extractText(msg);
      if (text) {
        result.events.push({
          ...base,
          id: randomUUID(),
          kind: 'message.delta',
          text,
          level: 'info',
        });
      }
      break;
    }

    case 'tool_call':
    case 'function_call':
    case 'action': {
      const name = (msg.name as string) ?? (msg.tool as string) ?? 'tool';
      const cmd = (msg.command as string) ?? (msg.input as string) ?? '';
      result.events.push({
        ...base,
        id: randomUUID(),
        kind: 'tool.started',
        title: name,
        text: cmd ? `$ ${cmd.slice(0, 200)}` : '',
        payload: msg,
        level: 'info',
      });
      break;
    }

    case 'tool_result':
    case 'action_result':
    case 'function_result': {
      const output = (msg.output as string) ?? (msg.stdout as string) ?? '';
      const stderr = (msg.stderr as string) ?? '';
      const isError = msg.error === true || !!stderr;

      if (output) {
        result.events.push({
          ...base,
          id: randomUUID(),
          kind: 'command.stdout',
          text: output.slice(0, 4000),
          level: 'info',
        });
      }
      if (stderr) {
        result.events.push({
          ...base,
          id: randomUUID(),
          kind: 'command.stderr',
          text: stderr.slice(0, 4000),
          level: 'error',
        });
      }

      result.events.push({
        ...base,
        id: randomUUID(),
        kind: isError ? 'tool.failed' : 'tool.completed',
        title: (msg.name as string) ?? 'tool',
        text: (output || stderr).slice(0, 2000),
        level: isError ? 'error' : 'info',
      });
      break;
    }

    case 'completed':
    case 'done':
    case 'turn_completed': {
      const text = extractText(msg);
      result.resultText = text;
      result.events.push({
        ...base,
        id: randomUUID(),
        kind: 'run.completed',
        title: 'Codex run completed',
        text,
        level: 'info',
      });
      break;
    }

    case 'error': {
      const errText = (msg.message as string) ?? (msg.error as string) ?? JSON.stringify(msg);
      result.events.push({
        ...base,
        id: randomUUID(),
        kind: 'system.log',
        title: 'Codex error',
        text: String(errText).slice(0, 1000),
        level: 'error',
      });
      break;
    }

    // Catch-all for unrecognized Codex event types
    default: {
      // Try to extract any useful text
      const text = extractText(msg);
      if (text) {
        result.events.push({
          ...base,
          id: randomUUID(),
          kind: 'message.delta',
          text,
          level: 'info',
        });
      } else {
        result.events.push({
          ...base,
          id: randomUUID(),
          kind: 'system.log',
          title: `codex-cli: ${eventType || 'unknown'}`,
          text: JSON.stringify(msg).slice(0, 200),
          level: 'debug',
        });
      }
    }
  }

  return result;
}

function extractText(msg: Record<string, unknown>): string {
  if (typeof msg.content === 'string') return msg.content;
  if (typeof msg.text === 'string') return msg.text;
  if (typeof msg.summary === 'string') return msg.summary;
  if (typeof msg.message === 'string' && msg.type !== 'error') return msg.message;
  // Handle content array (OpenAI format)
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((part: unknown) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) return (part as any).text;
        return '';
      })
      .filter(Boolean)
      .join('');
  }
  return '';
}
