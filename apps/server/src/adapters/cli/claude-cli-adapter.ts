import type { AgentDriver, RunInput } from '../agent-driver.js';
import { CLIRunner } from './cli-runner.js';
import { parseClaudeStreamLine, type ClaudeCLIContext } from './parse-claude-stream.js';
import { eventService } from '../../services/event-service.js';
import { messageService } from '../../services/message-service.js';
import { sessionService } from '../../services/session-service.js';
import { runManager } from '../../orchestrator/run-manager.js';
import { randomUUID } from 'node:crypto';
import { config } from '../../config.js';

export class ClaudeCLIAdapter implements AgentDriver {
  agent = 'claude' as const;

  async run(input: RunInput): Promise<void> {
    const { roomId, sessionId, runId, vendorSessionId, prompt, workingDirectory, worktreeId } = input;

    await eventService.emitAndBroadcast({
      id: randomUUID(),
      roomId,
      agent: 'claude',
      sessionId,
      runId,
      kind: 'run.started',
      title: 'Claude run started (CLI)',
      level: 'info',
      ts: new Date().toISOString(),
    });

    const ctx: ClaudeCLIContext = { roomId, sessionId, runId, worktreeId };

    // Build CLI args
    const args: string[] = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'bypassPermissions',
      '--append-system-prompt', 'You are working inside Control Room. Your output should be clear and structured for both the user and another agent that may take over.',
    ];

    if (config.claudeModel) {
      args.push('--model', config.claudeModel);
    }

    // Resume existing session if available
    if (vendorSessionId) {
      args.push('-r', vendorSessionId);
    }

    // Prompt as the final argument
    args.push(prompt);

    return new Promise<void>((resolve) => {
      let resultText = '';
      let streamedText = '';
      let extractedSessionId: string | undefined;
      let costUsd: number | undefined;

      const runner = new CLIRunner();

      runner.spawn({
        command: 'claude',
        args,
        cwd: workingDirectory,
        onStdoutLine: async (line) => {
          const parsed = parseClaudeStreamLine(line, ctx);

          // Emit events
          for (const event of parsed.events) {
            await eventService.emitAndBroadcast(event);
            if (event.kind === 'message.delta' && event.text) {
              streamedText += event.text;
            }
          }

          // Capture result metadata
          if (parsed.sessionId) extractedSessionId = parsed.sessionId;
          if (parsed.resultText !== undefined) {
            resultText = parsed.resultText;
          }
          if (parsed.costUsd !== undefined) costUsd = parsed.costUsd;
        },

        onStderrLine: async (line) => {
          await eventService.emitAndBroadcast({
            id: randomUUID(),
            roomId,
            agent: 'claude',
            sessionId,
            runId,
            worktreeId,
            kind: 'command.stderr',
            text: line,
            level: 'warn',
            ts: new Date().toISOString(),
          });
        },

        onExit: async (code) => {
          try {
            const finalText = resultText || streamedText;

            // Save vendor session ID for future resume
            if (extractedSessionId) {
              await sessionService.setVendorSessionId(sessionId, extractedSessionId);
            }

            if (code === 0) {
              await runManager.transitionRun(runId, 'summarizing');
              await runManager.setResult(runId, finalText, costUsd);
              await runManager.transitionRun(runId, 'completed');
              await sessionService.updateStatus(sessionId, 'idle');

              if (finalText) {
                await messageService.create({
                  roomId,
                  sessionId,
                  agent: 'claude',
                  role: 'agent',
                  content: finalText,
                });
              }
            } else {
              await eventService.emitAndBroadcast({
                id: randomUUID(),
                roomId,
                agent: 'claude',
                sessionId,
                runId,
                kind: 'run.failed',
                title: `Claude CLI exited with code ${code}`,
                level: 'error',
                ts: new Date().toISOString(),
              });

              await runManager.transitionRun(runId, 'failed');
              await sessionService.updateStatus(sessionId, 'failed');

              await messageService.create({
                roomId,
                sessionId,
                agent: 'claude',
                role: 'system',
                content: `Claude CLI exited with code ${code}`,
                selectable: false,
              });
            }
          } catch (err) {
            console.error('[claude-cli] Error in exit handler:', err);
          }

          resolve();
        },
      });
    });
  }
}
