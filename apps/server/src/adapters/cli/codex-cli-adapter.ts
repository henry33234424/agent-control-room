import type { AgentDriver, RunInput, ReviewInput } from '../agent-driver.js';
import { CLIRunner } from './cli-runner.js';
import { parseCodexJsonlLine, type CodexCLIContext } from './parse-codex-jsonl.js';
import { eventService } from '../../services/event-service.js';
import { messageService } from '../../services/message-service.js';
import { sessionService } from '../../services/session-service.js';
import { runManager } from '../../orchestrator/run-manager.js';
import { randomUUID } from 'node:crypto';

export class CodexCLIAdapter implements AgentDriver {
  agent = 'codex' as const;

  async run(input: RunInput): Promise<void> {
    const { roomId, sessionId, runId, prompt, workingDirectory, worktreeId } = input;

    await eventService.emitAndBroadcast({
      id: randomUUID(),
      roomId,
      agent: 'codex',
      sessionId,
      runId,
      kind: 'run.started',
      title: 'Codex run started (CLI)',
      level: 'info',
      ts: new Date().toISOString(),
    });

    const ctx: CodexCLIContext = { roomId, sessionId, runId, worktreeId };

    const args = [
      'exec',
      '--json',
      '--full-auto',
      '-C', workingDirectory,
      prompt,
    ];

    await this.runCLI(args, ctx, input);
  }

  async review(input: ReviewInput): Promise<void> {
    const { roomId, sessionId, runId, workingDirectory, worktreeId } = input;

    await eventService.emitAndBroadcast({
      id: randomUUID(),
      roomId,
      agent: 'codex',
      sessionId,
      runId,
      kind: 'review.started',
      title: `Codex review: ${input.target} (CLI)`,
      level: 'info',
      ts: new Date().toISOString(),
    });

    const ctx: CodexCLIContext = { roomId, sessionId, runId, worktreeId };

    const args = [
      'exec', 'review',
      '--json',
      '--full-auto',
      '-C', workingDirectory,
    ];

    await this.runCLI(args, ctx, input);
  }

  private async runCLI(
    args: string[],
    ctx: CodexCLIContext,
    input: { roomId: string; sessionId: string; runId: string },
  ): Promise<void> {
    const { roomId, sessionId, runId } = input;

    return new Promise<void>((resolve) => {
      let resultText = '';
      let hasCompleted = false;

      const runner = new CLIRunner();

      runner.spawn({
        command: 'codex',
        args,
        cwd: ctx.worktreeId ? args[args.indexOf('-C') + 1] : process.cwd(),
        onStdoutLine: async (line) => {
          const parsed = parseCodexJsonlLine(line, ctx);

          for (const event of parsed.events) {
            await eventService.emitAndBroadcast(event);
          }

          if (parsed.resultText) {
            resultText = parsed.resultText;
          }
          // Check if we got a run.completed event
          if (parsed.events.some((e) => e.kind === 'run.completed')) {
            hasCompleted = true;
          }
        },

        onStderrLine: async (line) => {
          await eventService.emitAndBroadcast({
            id: randomUUID(),
            roomId,
            agent: 'codex',
            sessionId: ctx.sessionId,
            runId,
            worktreeId: ctx.worktreeId,
            kind: 'command.stderr',
            text: line,
            level: 'warn',
            ts: new Date().toISOString(),
          });
        },

        onExit: async (code) => {
          try {
            if (code === 0 || hasCompleted) {
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
            } else {
              await eventService.emitAndBroadcast({
                id: randomUUID(),
                roomId,
                agent: 'codex',
                sessionId: ctx.sessionId,
                runId,
                kind: 'run.failed',
                title: `Codex CLI exited with code ${code}`,
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
                content: `Codex CLI exited with code ${code}`,
                selectable: false,
              });
            }
          } catch (err) {
            console.error('[codex-cli] Error in exit handler:', err);
          }

          resolve();
        },
      });
    });
  }
}
