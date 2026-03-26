import type { AgentDriver, RunInput } from '../agent-driver.js';
import { normalizeClaudeMessage } from '@control-room/runtime-events';
import { eventService } from '../../services/event-service.js';
import { messageService } from '../../services/message-service.js';
import { sessionService } from '../../services/session-service.js';
import { runManager } from '../../orchestrator/run-manager.js';
import { approvalService } from '../../services/approval-service.js';
import { randomUUID } from 'node:crypto';

// Tools that are safe to auto-approve (read-only)
const AUTO_APPROVE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'WebSearch', 'WebFetch']);

export class ClaudeAdapter implements AgentDriver {
  agent = 'claude' as const;

  async run(input: RunInput): Promise<void> {
    const { roomId, sessionId, runId, vendorSessionId, prompt, workingDirectory, worktreeId } = input;
    const ctx = { roomId, sessionId, runId, worktreeId };

    await eventService.emitAndBroadcast({
      id: randomUUID(),
      roomId,
      agent: 'claude',
      sessionId,
      runId,
      kind: 'run.started',
      title: 'Claude run started',
      level: 'info',
      ts: new Date().toISOString(),
    });

    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');

      const queryOptions: Record<string, unknown> = {
        workingDirectory,
        permissionMode: 'default',
        allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Write', 'Edit'],
        canUseTool: async (toolName: string, toolInput: unknown) => {
          // Auto-approve read-only tools
          if (AUTO_APPROVE_TOOLS.has(toolName)) {
            return { behavior: 'allow', updatedInput: toolInput };
          }

          // Everything else goes through the approval service
          const approval = await approvalService.createApproval({
            roomId,
            runId,
            sessionId,
            agent: 'claude',
            approvalType: 'tool',
            title: `Claude wants to use ${toolName}`,
            payload: { toolName, input: summarizeInput(toolInput) },
          });

          // Update run status to waitingApproval
          await runManager.transitionRun(runId, 'waitingApproval');
          await sessionService.updateStatus(sessionId, 'waitingApproval');

          try {
            const decision = await approvalService.waitForDecision(approval.id);

            // Back to running
            await runManager.transitionRun(runId, 'running');
            await sessionService.updateStatus(sessionId, 'running');

            if (decision === 'approved') {
              return { behavior: 'allow', updatedInput: toolInput };
            } else {
              return { behavior: 'deny', message: 'User denied this tool use.' };
            }
          } catch {
            // Timeout
            return { behavior: 'deny', message: 'Approval timed out.' };
          }
        },
      };

      if (vendorSessionId) {
        queryOptions.resume = vendorSessionId;
      }

      const iterator = query({
        prompt,
        options: queryOptions as any,
      });

      let resultText = '';
      let resultSessionId: string | undefined;
      let totalCost: number | undefined;

      for await (const message of iterator) {
        const msg = message as Record<string, unknown>;
        const events = normalizeClaudeMessage(msg, ctx);

        for (const event of events) {
          await eventService.emitAndBroadcast(event);
        }

        if (msg.type === 'result') {
          resultText = (msg.result as string) ?? '';
          resultSessionId = msg.session_id as string;
          totalCost = msg.total_cost_usd as number;
        }
      }

      if (resultSessionId) {
        await sessionService.setVendorSessionId(sessionId, resultSessionId);
      }

      await runManager.transitionRun(runId, 'summarizing');
      await runManager.setResult(runId, resultText, totalCost);
      await runManager.transitionRun(runId, 'completed');
      await sessionService.updateStatus(sessionId, 'idle');

      if (resultText) {
        await messageService.create({
          roomId,
          sessionId,
          agent: 'claude',
          role: 'agent',
          content: resultText,
        });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await eventService.emitAndBroadcast({
        id: randomUUID(),
        roomId,
        agent: 'claude',
        sessionId,
        runId,
        kind: 'run.failed',
        title: 'Claude run failed',
        text: errMsg,
        level: 'error',
        ts: new Date().toISOString(),
      });

      try {
        await runManager.transitionRun(runId, 'failed');
      } catch { /* already transitioned */ }
      try {
        await sessionService.updateStatus(sessionId, 'failed');
      } catch { /* already transitioned */ }

      await messageService.create({
        roomId,
        sessionId,
        agent: 'claude',
        role: 'system',
        content: `Claude run failed: ${errMsg}`,
        selectable: false,
      });
    }
  }
}

function summarizeInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {};
  const obj = input as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  if (obj.command) summary.command = String(obj.command).slice(0, 200);
  if (obj.file_path) summary.file_path = obj.file_path;
  if (obj.pattern) summary.pattern = obj.pattern;
  return summary;
}
