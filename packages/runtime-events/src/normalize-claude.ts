import { randomUUID } from 'node:crypto';
import type { RuntimeEvent, RuntimeEventKind } from '@control-room/shared-types';

export interface ClaudeEventContext {
  roomId: string;
  sessionId: string;
  runId: string;
  worktreeId?: string;
}

/**
 * Map a Claude Agent SDK message to one or more RuntimeEvents.
 */
export function normalizeClaudeMessage(
  message: Record<string, unknown>,
  ctx: ClaudeEventContext,
): RuntimeEvent[] {
  const base = {
    roomId: ctx.roomId,
    agent: 'claude' as const,
    sessionId: ctx.sessionId,
    runId: ctx.runId,
    worktreeId: ctx.worktreeId,
    ts: new Date().toISOString(),
  };

  const type = message.type as string;

  switch (type) {
    case 'system':
      return [
        {
          ...base,
          id: randomUUID(),
          kind: 'system.log',
          title: 'Session initialized',
          text: typeof message.data === 'object' ? JSON.stringify(message.data) : String(message.data ?? ''),
          level: 'info',
        },
      ];

    case 'assistant': {
      const content = (message.content ?? message.text ?? '') as string;
      return [
        {
          ...base,
          id: randomUUID(),
          kind: 'message.delta',
          text: content,
          level: 'info',
        },
      ];
    }

    case 'tool_use': {
      const toolName = (message.name as string) ?? 'unknown';
      const input = message.input as Record<string, unknown> | undefined;

      return [
        {
          ...base,
          id: randomUUID(),
          kind: 'tool.started',
          title: toolName,
          text: summarizeToolInput(toolName, input),
          payload: { toolName, toolUseId: message.id, input },
          level: 'info',
        },
      ];
    }

    case 'tool_result': {
      const isError = message.is_error === true;
      const toolName = (message.tool_name as string) ?? 'unknown';
      const content = String(message.content ?? message.output ?? '');
      const events: RuntimeEvent[] = [];

      // Emit command.stdout / command.stderr for Bash tool results
      if (toolName === 'Bash' || toolName === 'bash') {
        if (isError) {
          events.push({
            ...base,
            id: randomUUID(),
            kind: 'command.stderr',
            title: 'stderr',
            text: truncate(content, 4000),
            level: 'error',
          });
        } else {
          events.push({
            ...base,
            id: randomUUID(),
            kind: 'command.stdout',
            text: truncate(content, 4000),
            level: 'info',
          });
        }
      }

      // Emit diff.ready for Write/Edit tools
      if ((toolName === 'Write' || toolName === 'Edit') && !isError) {
        const filePath = (message.tool_input as Record<string, unknown>)?.file_path as string | undefined;
        events.push({
          ...base,
          id: randomUUID(),
          kind: 'diff.ready',
          title: 'File changed',
          text: filePath ?? 'unknown file',
          payload: { toolName, filePath },
          level: 'info',
        });
      }

      // Always emit tool.completed / tool.failed
      events.push({
        ...base,
        id: randomUUID(),
        kind: isError ? 'tool.failed' : 'tool.completed',
        title: toolName,
        text: truncate(content, 2000),
        payload: { toolUseId: message.tool_use_id },
        level: isError ? 'error' : 'info',
      });

      return events;
    }

    case 'result': {
      const subtype = message.subtype as string;
      const isSuccess = subtype === 'success';
      return [
        {
          ...base,
          id: randomUUID(),
          kind: isSuccess ? 'run.completed' : 'run.failed',
          title: isSuccess ? 'Run completed' : `Run ended: ${subtype}`,
          text: (message.result as string) ?? undefined,
          payload: {
            subtype,
            sessionId: message.session_id,
            totalCostUsd: message.total_cost_usd,
          },
          level: isSuccess ? 'info' : 'error',
        },
      ];
    }

    // SDK internal events — safe to ignore or log at debug level
    case 'user':
    case 'rate_limit_event':
      return []; // No user-facing event needed

    default:
      return [
        {
          ...base,
          id: randomUUID(),
          kind: 'system.log',
          title: `SDK: ${type}`,
          text: JSON.stringify(message).slice(0, 200),
          level: 'debug',
        },
      ];
  }
}

function summarizeToolInput(toolName: string, input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  if (toolName === 'Bash' || toolName === 'bash') {
    return input.command ? `$ ${truncate(String(input.command), 200)}` : '';
  }
  if (input.file_path) return String(input.file_path);
  if (input.pattern) return `pattern: ${String(input.pattern)}`;
  return truncate(JSON.stringify(input), 200);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
