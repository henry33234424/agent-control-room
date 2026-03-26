import { randomUUID } from 'node:crypto';
import type { RuntimeEvent } from '@control-room/shared-types';

export interface CodexEventContext {
  roomId: string;
  sessionId: string;
  runId: string;
  worktreeId?: string;
}

/**
 * Map a Codex app-server JSON-RPC notification to RuntimeEvents.
 */
export function normalizeCodexNotification(
  method: string,
  params: Record<string, unknown>,
  ctx: CodexEventContext,
): RuntimeEvent[] {
  const base = {
    roomId: ctx.roomId,
    agent: 'codex' as const,
    sessionId: ctx.sessionId,
    runId: ctx.runId,
    worktreeId: ctx.worktreeId,
    ts: new Date().toISOString(),
  };

  switch (method) {
    case 'item/started': {
      const item = getRecord(params.item) ?? params;
      const itemType = (item.type as string) ?? 'task';

      if (isNoiseItemType(itemType)) return [];

      // Detect command execution
      if (itemType === 'command' || itemType === 'shell') {
        return [
          {
            ...base,
            id: randomUUID(),
            kind: 'tool.started',
            title: 'Command',
            text: `$ ${(item.command as string) ?? (item.summary as string) ?? ''}`,
            payload: params,
            level: 'info',
          },
        ];
      }
      return [
        {
          ...base,
          id: randomUUID(),
          kind: 'tool.started',
          title: itemType,
          text: (item.summary as string) ?? JSON.stringify(item),
          payload: params,
          level: 'info',
        },
      ];
    }

    case 'item/completed': {
      const item = getRecord(params.item) ?? params;
      const itemType = (item.type as string) ?? 'task';

      if (isNoiseItemType(itemType)) return [];

      const events: RuntimeEvent[] = [];

      // Emit command output if available
      if (item.stdout) {
        events.push({
          ...base,
          id: randomUUID(),
          kind: 'command.stdout',
          text: truncate(String(item.stdout), 4000),
          level: 'info',
        });
      }
      if (item.stderr) {
        events.push({
          ...base,
          id: randomUUID(),
          kind: 'command.stderr',
          text: truncate(String(item.stderr), 4000),
          level: 'error',
        });
      }

      // Emit diff.ready if file changes detected
      if (item.changedFiles || item.filePath) {
        events.push({
          ...base,
          id: randomUUID(),
          kind: 'diff.ready',
          title: 'Files changed',
          text: String(item.changedFiles ?? item.filePath ?? ''),
          payload: params,
          level: 'info',
        });
      }

      events.push({
        ...base,
        id: randomUUID(),
        kind: item.error ? 'tool.failed' : 'tool.completed',
        title: itemType,
        text: (item.summary as string) ?? '',
        payload: params,
        level: item.error ? 'error' : 'info',
      });

      return events;
    }

    case 'item/agentMessage/delta':
      return [
        {
          ...base,
          id: randomUUID(),
          kind: 'message.delta',
          text:
            (params.delta as string) ??
            (params.content as string) ??
            (getRecord(params.item)?.delta as string | undefined) ??
            (getRecord(params.item)?.text as string | undefined) ??
            '',
          level: 'info',
        },
      ];

    case 'turn/completed': {
      const events: RuntimeEvent[] = [];
      const text = extractTurnText(params);

      // Emit message.final with the turn summary
      if (text) {
        events.push({
          ...base,
          id: randomUUID(),
          kind: 'message.final',
          text,
          level: 'info',
        });
      }

      events.push({
        ...base,
        id: randomUUID(),
        kind: 'run.completed',
        title: 'Turn completed',
        text,
        payload: params,
        level: 'info',
      });

      return events;
    }

    // Review events
    case 'review/started':
      return [
        {
          ...base,
          id: randomUUID(),
          kind: 'review.started',
          title: 'Review started',
          text:
            (params.target as string) ??
            (getRecord(params.reviewOutput)?.overallExplanation as string | undefined) ??
            '',
          payload: params,
          level: 'info',
        },
      ];

    case 'review/completed':
      return [
        {
          ...base,
          id: randomUUID(),
          kind: 'review.completed',
          title: 'Review completed',
          text: extractReviewText(params),
          payload: params,
          level: 'info',
        },
      ];

    case 'error':
      return [
        {
          ...base,
          id: randomUUID(),
          kind: 'system.log',
          title: 'Codex error',
          text: extractErrorText(params),
          payload: params,
          level: params.willRetry === true ? 'warn' : 'error',
        },
      ];

    default:
      return [
        {
          ...base,
          id: randomUUID(),
          kind: 'system.log',
          title: `codex: ${method}`,
          text: JSON.stringify(params),
          level: 'debug',
        },
      ];
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function isNoiseItemType(itemType: string): boolean {
  return itemType === 'userMessage' || itemType === 'agentMessage' || itemType === 'reasoning';
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function extractTurnText(params: Record<string, unknown>): string {
  return (
    extractAgentMessageText(
      getRecord(params.lastAgentMessage) ?? getRecord(params.last_agent_message),
    ) ||
    (getRecord(params.turn)?.summary as string | undefined) ||
    (getRecord(params.turn)?.content as string | undefined) ||
    (params.summary as string | undefined) ||
    (params.content as string | undefined) ||
    ''
  );
}

function extractReviewText(params: Record<string, unknown>): string {
  return (
    (getRecord(params.reviewOutput)?.overallExplanation as string | undefined) ||
    (getRecord(params.review_output)?.overall_explanation as string | undefined) ||
    (getRecord(params.turn)?.summary as string | undefined) ||
    (params.summary as string | undefined) ||
    (params.content as string | undefined) ||
    ''
  );
}

function extractAgentMessageText(message: Record<string, unknown> | undefined): string {
  if (!message) return '';
  const content = message.content;
  if (!Array.isArray(content)) return typeof content === 'string' ? content : '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      const record = getRecord(part);
      return typeof record?.text === 'string' ? record.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractErrorText(params: Record<string, unknown>): string {
  const error = getRecord(params.error);
  if (!error) return JSON.stringify(params);

  const message = typeof error.message === 'string' ? error.message : 'Codex error';
  const details =
    typeof error.additionalDetails === 'string'
      ? error.additionalDetails
      : typeof error.additional_details === 'string'
        ? error.additional_details
        : '';

  return details ? `${message}: ${details}` : message;
}
