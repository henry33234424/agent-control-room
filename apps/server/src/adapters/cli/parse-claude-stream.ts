import { randomUUID } from 'node:crypto';
import type { RuntimeEvent } from '@control-room/shared-types';

/**
 * Parse a single line from `claude -p --output-format stream-json`.
 * The format is very similar to the SDK messages — reuse the same mapping logic.
 */

export interface ClaudeCLIContext {
  roomId: string;
  sessionId: string;
  runId: string;
  worktreeId?: string;
}

export interface ClaudeCLIParseResult {
  events: RuntimeEvent[];
  sessionId?: string;   // Extracted vendor session ID
  resultText?: string;  // Final result text
  costUsd?: number;     // Total cost
}

export function parseClaudeStreamLine(
  line: string,
  ctx: ClaudeCLIContext,
): ClaudeCLIParseResult {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(line);
  } catch {
    // Non-JSON line — treat as plain stdout
    return {
      events: [
        {
          id: randomUUID(),
          roomId: ctx.roomId,
          agent: 'claude',
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
    agent: 'claude' as const,
    sessionId: ctx.sessionId,
    runId: ctx.runId,
    worktreeId: ctx.worktreeId,
    ts: new Date().toISOString(),
  };

  const type = msg.type as string;
  const result: ClaudeCLIParseResult = { events: [] };

  switch (type) {
    case 'system':
      // May contain session_id
      if (msg.session_id) {
        result.sessionId = msg.session_id as string;
      }
      if ((msg as any).data?.session_id) {
        result.sessionId = (msg as any).data.session_id as string;
      }
      break;

    case 'assistant': {
      // CLI format: msg.message.content is an array of {type:"text",text:"..."}
      let text = '';
      const message = msg.message as Record<string, unknown> | undefined;
      if (message?.content && Array.isArray(message.content)) {
        text = (message.content as Array<{ type: string; text?: string }>)
          .filter((p) => p.type === 'text' && p.text)
          .map((p) => p.text!)
          .join('');
      } else if (typeof msg.content === 'string') {
        text = msg.content;
      } else if (typeof msg.text === 'string') {
        text = msg.text;
      }

      if (text) {
        result.events.push({
          ...base,
          id: randomUUID(),
          kind: 'message.delta',
          text,
          level: 'info',
        });
      }

      // assistant messages also carry session_id
      if (msg.session_id) result.sessionId = msg.session_id as string;
      break;
    }

    case 'tool_use':
      result.events.push({
        ...base,
        id: randomUUID(),
        kind: 'tool.started',
        title: (msg.name as string) ?? 'unknown',
        text: summarizeToolInput(msg.name as string, msg.input as Record<string, unknown>),
        payload: { toolName: msg.name, input: msg.input },
        level: 'info',
      });
      break;

    case 'tool_result': {
      const isError = msg.is_error === true;
      const toolName = (msg.tool_name as string) ?? '';
      const content = String(msg.content ?? msg.output ?? '');

      // Bash → command.stdout/stderr
      if (toolName === 'Bash' || toolName === 'bash') {
        result.events.push({
          ...base,
          id: randomUUID(),
          kind: isError ? 'command.stderr' : 'command.stdout',
          text: content.slice(0, 4000),
          level: isError ? 'error' : 'info',
        });
      }

      // Write/Edit → diff.ready
      if ((toolName === 'Write' || toolName === 'Edit') && !isError) {
        const filePath = (msg.input as any)?.file_path ?? (msg.tool_input as any)?.file_path;
        result.events.push({
          ...base,
          id: randomUUID(),
          kind: 'diff.ready',
          title: 'File changed',
          text: filePath ?? 'unknown file',
          level: 'info',
        });
      }

      result.events.push({
        ...base,
        id: randomUUID(),
        kind: isError ? 'tool.failed' : 'tool.completed',
        title: toolName,
        text: content.slice(0, 2000),
        level: isError ? 'error' : 'info',
      });
      break;
    }

    case 'result': {
      const subtype = msg.subtype as string;
      const isSuccess = subtype === 'success';
      result.resultText = (msg.result as string) ?? '';
      result.sessionId = (msg.session_id as string) ?? result.sessionId;
      result.costUsd = msg.cost_usd as number ?? msg.total_cost_usd as number;

      result.events.push({
        ...base,
        id: randomUUID(),
        kind: isSuccess ? 'run.completed' : 'run.failed',
        title: isSuccess ? 'Run completed' : `Run ended: ${subtype}`,
        text: result.resultText,
        payload: { subtype, costUsd: result.costUsd },
        level: isSuccess ? 'info' : 'error',
      });
      break;
    }

    // Silently ignore internal SDK event types
    case 'user':
    case 'rate_limit_event':
      break;

    default:
      result.events.push({
        ...base,
        id: randomUUID(),
        kind: 'system.log',
        title: `cli: ${type}`,
        text: JSON.stringify(msg).slice(0, 200),
        level: 'debug',
      });
  }

  return result;
}

function summarizeToolInput(toolName: string, input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  if (toolName === 'Bash' || toolName === 'bash') {
    return input.command ? `$ ${String(input.command).slice(0, 200)}` : '';
  }
  if (input.file_path) return String(input.file_path);
  if (input.pattern) return `pattern: ${String(input.pattern)}`;
  return JSON.stringify(input).slice(0, 200);
}
