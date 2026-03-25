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
      const itemType = (params.type as string) ?? 'task';
      // Detect command execution
      if (itemType === 'command' || itemType === 'shell') {
        return [
          {
            ...base,
            id: randomUUID(),
            kind: 'tool.started',
            title: 'Command',
            text: `$ ${(params.command as string) ?? (params.summary as string) ?? ''}`,
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
          text: (params.summary as string) ?? JSON.stringify(params),
          payload: params,
          level: 'info',
        },
      ];
    }

    case 'item/completed': {
      const itemType = (params.type as string) ?? 'task';
      const events: RuntimeEvent[] = [];

      // Emit command output if available
      if (params.stdout) {
        events.push({
          ...base,
          id: randomUUID(),
          kind: 'command.stdout',
          text: truncate(String(params.stdout), 4000),
          level: 'info',
        });
      }
      if (params.stderr) {
        events.push({
          ...base,
          id: randomUUID(),
          kind: 'command.stderr',
          text: truncate(String(params.stderr), 4000),
          level: 'error',
        });
      }

      // Emit diff.ready if file changes detected
      if (params.changedFiles || params.filePath) {
        events.push({
          ...base,
          id: randomUUID(),
          kind: 'diff.ready',
          title: 'Files changed',
          text: String(params.changedFiles ?? params.filePath ?? ''),
          payload: params,
          level: 'info',
        });
      }

      events.push({
        ...base,
        id: randomUUID(),
        kind: params.error ? 'tool.failed' : 'tool.completed',
        title: itemType,
        text: (params.summary as string) ?? '',
        payload: params,
        level: params.error ? 'error' : 'info',
      });

      return events;
    }

    case 'item/agentMessage/delta':
      return [
        {
          ...base,
          id: randomUUID(),
          kind: 'message.delta',
          text: (params.delta as string) ?? (params.content as string) ?? '',
          level: 'info',
        },
      ];

    case 'turn/completed': {
      const events: RuntimeEvent[] = [];

      // Emit message.final with the turn summary
      if (params.summary || params.content) {
        events.push({
          ...base,
          id: randomUUID(),
          kind: 'message.final',
          text: (params.summary as string) ?? (params.content as string) ?? '',
          level: 'info',
        });
      }

      events.push({
        ...base,
        id: randomUUID(),
        kind: 'run.completed',
        title: 'Turn completed',
        text: (params.summary as string) ?? '',
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
          text: (params.target as string) ?? '',
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
          text: (params.summary as string) ?? '',
          payload: params,
          level: 'info',
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
