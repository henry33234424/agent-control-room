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

interface PendingCompletion {
  kind: 'run' | 'review';
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const CODEX_APPROVAL_POLICY = 'on-failure';
const CODEX_SANDBOX = 'workspace-write';
const CODEX_COMPLETION_TIMEOUT_MS = 180_000;

export class CodexAdapter implements AgentDriver {
  agent = 'codex' as const;
  private codexProcess = new CodexProcess();
  private activeRuns = new Map<string, RunContext>(); // threadId → context
  private pendingCompletions = new Map<string, PendingCompletion>(); // threadId → pending completion
  private streamingBuffers = new Map<string, string>(); // threadId → accumulated delta text

  constructor() {
    this.codexProcess.on('stderr', (text: string) => {
      console.error('[codex stderr]', text);
    });

    this.codexProcess.on('error', (err: Error) => {
      this.failAllPendingCompletions(`Codex process error: ${err.message}`);
    });

    this.codexProcess.on('rpc-closed', () => {
      this.failAllPendingCompletions('Codex RPC connection closed');
    });

    this.codexProcess.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      const reason = signal
        ? `Codex app-server exited with signal ${signal}`
        : `Codex app-server exited with code ${code}`;
      console.warn(`[codex] ${reason}`);
      this.failAllPendingCompletions(reason);
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

      if (method === 'item/agentMessage/delta') {
        this.appendStreamingDelta(threadId, extractStreamingDelta(params));
      }

      const pending = this.pendingCompletions.get(threadId);
      if (!pending) return;

      if (pending.kind === 'run' && method === 'turn/completed') {
        this.resolvePendingCompletion(
          threadId,
          extractTurnText(params) || this.getStreamingBuffer(threadId),
        );
        return;
      }

      if (pending.kind === 'review' && method === 'review/completed') {
        this.resolvePendingCompletion(threadId, extractReviewText(params));
        return;
      }

      if (method === 'error' && params.willRetry !== true) {
        this.rejectPendingCompletion(threadId, new Error(extractCodexError(params)));
      }
    });
  }

  async run(input: RunInput): Promise<void> {
    const { roomId, sessionId, runId, vendorSessionId, prompt, workingDirectory, worktreeId } = input;
    let threadId = vendorSessionId;

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
      const startTurn = (currentThreadId: string) =>
        rpc.call(
          'turn/start',
          {
            threadId: currentThreadId,
            input: [{ type: 'text', text: prompt }],
            cwd: workingDirectory,
            approvalPolicy: CODEX_APPROVAL_POLICY,
          },
          120000,
        ) as Promise<Record<string, unknown>>;

      // Helper to create a fresh thread
      const createThread = async (): Promise<string> => {
        const threadResult = (await rpc.call('thread/start', {
          cwd: workingDirectory,
          approvalPolicy: CODEX_APPROVAL_POLICY,
          sandbox: CODEX_SANDBOX,
        })) as { thread?: { id?: string } };
        const id = threadResult?.thread?.id;
        if (!id) throw new Error('thread/start did not return a thread ID');
        await sessionService.setVendorSessionId(sessionId, id);
        return id;
      };

      if (!threadId) {
        threadId = await createThread();
      }

      // Register this run's context so the global handler can route events
      this.activeRuns.set(threadId, { roomId, sessionId, runId, worktreeId });
      let completionPromise = this.waitForCompletion(threadId, 'run');

      try {
        let turnResult: Record<string, unknown>;
        try {
          turnResult = await startTurn(threadId);
        } catch (turnErr) {
          // If thread not found (stale vendorSessionId), create a new one and retry
          if (isMissingThreadError(turnErr)) {
            this.activeRuns.delete(threadId);
            this.clearPendingCompletion(threadId);
            threadId = await createThread();
            this.activeRuns.set(threadId, { roomId, sessionId, runId, worktreeId });
            completionPromise = this.waitForCompletion(threadId, 'run');
            turnResult = await startTurn(threadId);
          } else {
            throw turnErr;
          }
        }

        const immediateStatus = getNestedString(turnResult, ['turn', 'status']);
        const resultText =
          immediateStatus === 'completed'
            ? extractTurnText(turnResult) || this.getStreamingBuffer(threadId)
            : await completionPromise;

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
        this.clearPendingCompletion(threadId);
        this.clearStreamingBuffer(threadId);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (threadId) {
        this.rejectPendingCompletion(threadId, err instanceof Error ? err : new Error(errMsg));
      }
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
    let threadId = vendorSessionId;

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

      if (!threadId) {
        const threadResult = (await rpc.call('thread/start', {
          cwd: workingDirectory,
          approvalPolicy: CODEX_APPROVAL_POLICY,
          sandbox: CODEX_SANDBOX,
        })) as { thread?: { id?: string } };
        threadId = threadResult?.thread?.id as string;
        if (!threadId) {
          throw new Error('thread/start did not return a thread ID for review');
        }
      }

      // Register for notifications
      if (threadId) {
        this.activeRuns.set(threadId, ctx);
      }
      const completionPromise = threadId
        ? this.waitForCompletion(threadId, 'review')
        : Promise.resolve('');

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

        const reviewText = extractReviewText(result) || (await completionPromise);

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
          this.clearPendingCompletion(threadId);
          this.clearStreamingBuffer(threadId);
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (threadId) {
        this.rejectPendingCompletion(threadId, err instanceof Error ? err : new Error(errMsg));
      }
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

  private waitForCompletion(threadId: string, kind: 'run' | 'review'): Promise<string> {
    this.clearPendingCompletion(threadId);

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCompletions.delete(threadId);
        reject(new Error(`Codex ${kind} did not complete within ${CODEX_COMPLETION_TIMEOUT_MS}ms`));
      }, CODEX_COMPLETION_TIMEOUT_MS);

      this.pendingCompletions.set(threadId, { kind, resolve, reject, timer });
    });
  }

  private resolvePendingCompletion(threadId: string, text: string): void {
    const pending = this.pendingCompletions.get(threadId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingCompletions.delete(threadId);
    pending.resolve(text);
  }

  private rejectPendingCompletion(threadId: string, error: Error): void {
    const pending = this.pendingCompletions.get(threadId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingCompletions.delete(threadId);
    pending.reject(error);
  }

  private clearPendingCompletion(threadId: string): void {
    const pending = this.pendingCompletions.get(threadId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingCompletions.delete(threadId);
  }

  private appendStreamingDelta(threadId: string, delta: string): void {
    if (!delta) return;
    this.streamingBuffers.set(threadId, `${this.streamingBuffers.get(threadId) ?? ''}${delta}`);
  }

  private getStreamingBuffer(threadId: string): string {
    return this.streamingBuffers.get(threadId) ?? '';
  }

  private clearStreamingBuffer(threadId: string): void {
    this.streamingBuffers.delete(threadId);
  }

  private failAllPendingCompletions(reason: string): void {
    for (const [threadId, pending] of this.pendingCompletions) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingCompletions.delete(threadId);
      this.streamingBuffers.delete(threadId);
    }
  }
}

function extractTurnText(params: Record<string, unknown>): string {
  return (
    extractAgentMessageText(
      (params.lastAgentMessage as Record<string, unknown> | undefined) ??
        (params.last_agent_message as Record<string, unknown> | undefined),
    ) ||
    getNestedString(params, ['turn', 'summary']) ||
    getNestedString(params, ['turn', 'content']) ||
    (params.summary as string | undefined) ||
    (params.content as string | undefined) ||
    ''
  );
}

function extractReviewText(params: Record<string, unknown>): string {
  return (
    getNestedString(params, ['reviewOutput', 'overallExplanation']) ||
    getNestedString(params, ['review_output', 'overall_explanation']) ||
    getNestedString(params, ['turn', 'summary']) ||
    (params.summary as string | undefined) ||
    (params.content as string | undefined) ||
    ''
  );
}

function extractAgentMessageText(message: Record<string, unknown> | undefined): string {
  if (!message) return '';

  const directText = message.content;
  if (typeof directText === 'string') return directText;

  if (Array.isArray(directText)) {
    return directText
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        const text = (part as Record<string, unknown>).text;
        return typeof text === 'string' ? text : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return '';
}

function extractStreamingDelta(params: Record<string, unknown>): string {
  return (
    (params.delta as string | undefined) ||
    (params.content as string | undefined) ||
    getNestedString(params, ['item', 'delta']) ||
    getNestedString(params, ['item', 'text']) ||
    ''
  );
}

function extractCodexError(params: Record<string, unknown>): string {
  const error = params.error;
  if (!error || typeof error !== 'object') {
    return 'Codex reported an unknown error';
  }

  const record = error as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message : 'Codex reported an error';
  const details =
    typeof record.additionalDetails === 'string'
      ? record.additionalDetails
      : typeof record.additional_details === 'string'
        ? record.additional_details
        : '';

  return details ? `${message}: ${details}` : message;
}

function isMissingThreadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('thread not found') || message.includes('not found');
}

function getNestedString(
  value: Record<string, unknown>,
  path: string[],
): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' ? current : undefined;
}
