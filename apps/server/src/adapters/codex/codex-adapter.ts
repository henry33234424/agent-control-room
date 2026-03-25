import type { AgentDriver, RunInput, ReviewInput } from '../agent-driver.js';
import { CodexProcess } from './codex-process.js';
import { normalizeCodexNotification } from '@control-room/runtime-events';
import { eventService } from '../../services/event-service.js';
import { messageService } from '../../services/message-service.js';
import { sessionService } from '../../services/session-service.js';
import { runManager } from '../../orchestrator/run-manager.js';
import { randomUUID } from 'node:crypto';

/**
 * Maps threadId → { roomId, sessionId, runId } so we can route
 * notifications from the shared Codex process to the correct run.
 */
interface RunContext {
  roomId: string;
  sessionId: string;
  runId: string;
  worktreeId?: string;
}

export class CodexAdapter implements AgentDriver {
  agent = 'codex' as const;
  private codexProcess = new CodexProcess();
  private activeRuns = new Map<string, RunContext>(); // threadId → context

  constructor() {
    this.codexProcess.on('stderr', (text: string) => {
      console.error('[codex stderr]', text);
    });

    this.codexProcess.on('exit', (code: number | null) => {
      console.warn(`[codex] app-server exited with code ${code}`);
    });

    // Single global notification handler that routes by threadId
    this.codexProcess.on('notification', async (method: string, params: Record<string, unknown>) => {
      const threadId = params.threadId as string | undefined;
      if (!threadId) return;

      const ctx = this.activeRuns.get(threadId);
      if (!ctx) return; // Unknown thread, ignore

      const events = normalizeCodexNotification(method, params, ctx);
      for (const event of events) {
        await eventService.emitAndBroadcast(event);
      }
    });
  }

  async run(input: RunInput): Promise<void> {
    const { roomId, sessionId, runId, vendorSessionId, prompt, workingDirectory, worktreeId } = input;

    await eventService.emitAndBroadcast({
      id: randomUUID(),
      roomId,
      agent: 'codex',
      sessionId,
      runId,
      kind: 'run.started',
      title: 'Codex run started',
      level: 'info',
      ts: new Date().toISOString(),
    });

    try {
      const rpc = await this.codexProcess.ensureAlive();

      let threadId = vendorSessionId;

      if (!threadId) {
        const threadResult = (await rpc.call('thread/start', {
          instructions: prompt,
          workDir: workingDirectory,
        })) as Record<string, unknown>;
        threadId = threadResult.threadId as string;
        await sessionService.setVendorSessionId(sessionId, threadId);
      }

      // Register this run's context so the global handler can route events
      this.activeRuns.set(threadId, { roomId, sessionId, runId, worktreeId });

      try {
        const turnResult = (await rpc.call(
          'turn/start',
          { threadId, message: prompt },
          120000,
        )) as Record<string, unknown>;

        const resultText = (turnResult?.summary as string) ?? (turnResult?.content as string) ?? '';

        await runManager.transitionRun(runId, 'summarizing');
        await runManager.setResult(runId, resultText);
        await runManager.transitionRun(runId, 'completed');
        await sessionService.updateStatus(sessionId, 'idle');

        if (resultText) {
          await messageService.create({
            roomId,
            sessionId,
            agent: 'codex',
            role: 'agent',
            content: resultText,
          });
        }
      } finally {
        // Unregister when run ends (success or failure)
        this.activeRuns.delete(threadId);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await eventService.emitAndBroadcast({
        id: randomUUID(),
        roomId,
        agent: 'codex',
        sessionId,
        runId,
        kind: 'run.failed',
        title: 'Codex run failed',
        text: errMsg,
        level: 'error',
        ts: new Date().toISOString(),
      });

      await runManager.transitionRun(runId, 'failed');
      await sessionService.updateStatus(sessionId, 'failed');

      await messageService.create({
        roomId,
        sessionId,
        agent: 'codex',
        role: 'system',
        content: `Codex run failed: ${errMsg}`,
        selectable: false,
      });
    }
  }

  async review(input: ReviewInput): Promise<void> {
    const { roomId, sessionId, runId, vendorSessionId, target, customRef, workingDirectory, worktreeId } = input;
    const ctx = { roomId, sessionId, runId, worktreeId };

    await eventService.emitAndBroadcast({
      id: randomUUID(),
      roomId,
      agent: 'codex',
      sessionId,
      runId,
      kind: 'review.started',
      title: `Codex review: ${target}`,
      level: 'info',
      ts: new Date().toISOString(),
    });

    try {
      const rpc = await this.codexProcess.ensureAlive();

      let threadId = vendorSessionId;

      if (!threadId) {
        const threadResult = (await rpc.call('thread/start', {
          instructions: 'Detached review thread for Control Room.',
          workDir: workingDirectory,
        })) as Record<string, unknown>;
        threadId = threadResult.threadId as string;
      }

      // Register for notifications
      if (threadId) {
        this.activeRuns.set(threadId, ctx);
      }

      try {
        const result = (await rpc.call(
          'review/start',
          {
            threadId,
            target,
            customRef,
            workDir: workingDirectory,
          },
          120000,
        )) as Record<string, unknown>;

        const reviewText = (result?.summary as string) ?? (result?.content as string) ?? '';

        await eventService.emitAndBroadcast({
          id: randomUUID(),
          roomId,
          agent: 'codex',
          sessionId,
          runId,
          kind: 'review.completed',
          title: 'Review completed',
          text: reviewText,
          level: 'info',
          ts: new Date().toISOString(),
        });

        await runManager.transitionRun(runId, 'summarizing');
        await runManager.setResult(runId, reviewText);
        await runManager.transitionRun(runId, 'completed');
        await sessionService.updateStatus(sessionId, 'idle');

        if (reviewText) {
          await messageService.create({
            roomId,
            sessionId,
            agent: 'codex',
            role: 'review',
            content: reviewText,
          });
        }
      } finally {
        if (threadId) {
          this.activeRuns.delete(threadId);
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await eventService.emitAndBroadcast({
        id: randomUUID(),
        roomId,
        agent: 'codex',
        sessionId,
        runId,
        kind: 'run.failed',
        title: 'Codex review failed',
        text: errMsg,
        level: 'error',
        ts: new Date().toISOString(),
      });

      await runManager.transitionRun(runId, 'failed');
      await sessionService.updateStatus(sessionId, 'failed');

      await messageService.create({
        roomId,
        sessionId,
        agent: 'codex',
        role: 'system',
        content: `Codex review failed: ${errMsg}`,
        selectable: false,
      });
    }
  }
}
