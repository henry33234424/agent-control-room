import type { AgentDriver, RunInput, ReviewInput } from '../agent-driver.js';
import { CLIRunner } from './cli-runner.js';
import { parseCodexJsonlLine, type CodexCLIContext } from './parse-codex-jsonl.js';
import { eventService } from '../../services/event-service.js';
import { messageService } from '../../services/message-service.js';
import { sessionService } from '../../services/session-service.js';
import { runManager } from '../../orchestrator/run-manager.js';
import { randomUUID } from 'node:crypto';
import { config } from '../../config.js';

export class CodexCLIAdapter implements AgentDriver {
  agent = 'codex' as const;

  async run(input: RunInput): Promise<void> {
    const { roomId, sessionId, runId, vendorSessionId, prompt, workingDirectory, worktreeId } = input;

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

    const args = buildRunArgs(workingDirectory, prompt, vendorSessionId);

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

    const args = buildReviewArgs(workingDirectory, input.target, input.customRef);

    await this.runCLI(args, ctx, input);
  }

  private async runCLI(
    args: string[],
    ctx: CodexCLIContext,
    input: { roomId: string; sessionId: string; runId: string; workingDirectory: string },
  ): Promise<void> {
    const { roomId, sessionId, runId } = input;

    return new Promise<void>((resolve) => {
      let streamedText = '';
      let finalResultText = '';
      let extractedSessionId: string | undefined;

      const runner = new CLIRunner();

      runner.spawn({
        command: 'codex',
        args,
        cwd: input.workingDirectory || process.cwd(),
        onStdoutLine: async (line) => {
          const parsed = parseCodexJsonlLine(line, ctx);

          for (const event of parsed.events) {
            await eventService.emitAndBroadcast(event);
            if (event.kind === 'message.delta' && event.text) {
              streamedText += event.text;
            }
          }

          if (parsed.sessionId) extractedSessionId = parsed.sessionId;
          if (parsed.resultText) finalResultText = parsed.resultText;
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
            if (extractedSessionId) {
              await sessionService.setVendorSessionId(sessionId, extractedSessionId);
            }

            if (code === 0) {
              const resultText = finalResultText || streamedText;
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

function buildRunArgs(
  workingDirectory: string,
  prompt: string,
  vendorSessionId?: string,
): string[] {
  const args = ['exec', '-C', workingDirectory];

  if (vendorSessionId) {
    args.push('resume', '--json', '--full-auto');
    if (config.codexModel) {
      args.push('-m', config.codexModel);
    }
    args.push(vendorSessionId, prompt);
    return args;
  }

  args.push('--json', '--full-auto');
  if (config.codexModel) {
    args.push('-m', config.codexModel);
  }
  args.push(prompt);
  return args;
}

function buildReviewArgs(
  workingDirectory: string,
  target: ReviewInput['target'],
  customRef?: string,
): string[] {
  const args = ['exec', '-C', workingDirectory, 'review', '--json', '--full-auto'];

  if (config.codexModel) {
    args.push('-m', config.codexModel);
  }

  switch (target) {
    case 'uncommittedChanges':
      args.push('--uncommitted');
      break;
    case 'baseBranch':
      if (customRef) {
        args.push('--base', customRef);
      }
      break;
    case 'commit':
      if (!customRef) {
        throw new Error('Review target "commit" requires customRef');
      }
      args.push('--commit', customRef);
      break;
    case 'custom':
      if (!customRef) {
        throw new Error('Review target "custom" requires customRef');
      }
      if (/^[0-9a-f]{7,40}$/i.test(customRef)) {
        args.push('--commit', customRef);
      } else {
        args.push('--base', customRef);
      }
      break;
  }

  return args;
}
