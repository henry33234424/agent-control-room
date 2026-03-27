import type { AgentKind, MentionTarget } from '@control-room/shared-types';
import { prisma } from '../db.js';
import { parseMention, getTargetAgents } from '../orchestrator/message-router.js';
import { sessionService } from './session-service.js';
import { ptyManager } from '../ws/pty-manager.js';
import { config } from '../config.js';

interface PreparedDispatchTarget {
  agent: AgentKind;
  sessionId: string;
  sessionName: string;
  prompt: string;
  cwd: string;
  vendorSessionId?: string;
}

interface PreparedDispatch {
  target: MentionTarget;
  cleanContent: string;
  targets: PreparedDispatchTarget[];
  selectedCount: number;
}

export class InteractiveDispatchService {
  async prepare(input: {
    roomId: string;
    content: string;
    mentionTarget?: MentionTarget;
    preferredSessionId?: string;
    selectedMessageIds?: string[];
  }): Promise<PreparedDispatch> {
    const { roomId, content, mentionTarget, preferredSessionId } = input;
    const selectedMessageIds = (input.selectedMessageIds ?? []).slice(0, 20);

    const { target, cleanContent } = parseMention(content, mentionTarget);
    const agents = getTargetAgents(target);
    const selectedMessages = selectedMessageIds.length > 0
      ? await prisma.chatMessage.findMany({
        where: { roomId, id: { in: selectedMessageIds } },
        orderBy: { createdAt: 'asc' },
      })
      : [];

    const selectedTranscript = selectedMessages
      .map((msg) => `[${msg.role}${msg.agent ? ` (${msg.agent})` : ''}] ${msg.content}`)
      .join('\n\n');

    const targets: PreparedDispatchTarget[] = [];
    for (const agent of agents) {
      const session = await sessionService.findOrCreateForAgent(roomId, agent, preferredSessionId);
      const ctx = await sessionService.resolveInteractiveContext(session.id);
      targets.push({
        agent,
        sessionId: session.id,
        sessionName: session.name,
        prompt: composeInteractivePrompt(cleanContent, selectedTranscript),
        cwd: ctx.cwd,
        vendorSessionId: ctx.vendorSessionId,
      });
    }

    return {
      target,
      cleanContent,
      targets,
      selectedCount: selectedMessages.length,
    };
  }

  async dispatchPrepared(
    roomId: string,
    prepared: PreparedDispatch,
    replyToMessageId?: string,
  ): Promise<void> {
    for (const target of prepared.targets) {
      this.ensurePtyStarted({
        roomId,
        sessionId: target.sessionId,
        agent: target.agent,
        cwd: target.cwd,
        vendorSessionId: target.vendorSessionId,
      });

      // Wait for CLI to be ready before sending prompt
      await ptyManager.waitUntilReady(target.sessionId);

      await ptyManager.dispatchPrompt({
        roomId,
        sessionId: target.sessionId,
        agent: target.agent,
        prompt: target.prompt,
        replyToMessageId,
      });
    }
  }

  private ensurePtyStarted(input: {
    roomId: string;
    sessionId: string;
    agent: AgentKind;
    cwd: string;
    vendorSessionId?: string;
  }): void {
    console.log('[dispatch] ensurePtyStarted', input.sessionId, input.agent, input.cwd);
    if (ptyManager.has(input.sessionId)) {
      return;
    }

    let command: string;
    let args: string[];

    if (input.agent === 'claude') {
      command = 'claude';
      args = [];
      if (config.claudeModel) args.push('--model', config.claudeModel);
      if (input.vendorSessionId) args.push('-r', input.vendorSessionId);
    } else {
      command = 'codex';
      args = ['-C', input.cwd];
      if (config.codexModel) args.push('-m', config.codexModel);
      if (input.vendorSessionId) {
        args.push('resume', input.vendorSessionId);
      }
    }

    ptyManager.start({
      sessionId: input.sessionId,
      roomId: input.roomId,
      agent: input.agent,
      command,
      args,
      cwd: input.cwd,
      ws: null,
    });
  }
}

function composeInteractivePrompt(content: string, selectedTranscript: string): string {
  if (!selectedTranscript) {
    return content;
  }

  return [
    '[Control Room Context]',
    'The following transcript was explicitly selected in Control Room:',
    selectedTranscript,
    '',
    '[New Instruction]',
    content,
  ].join('\n');
}

export const interactiveDispatchService = new InteractiveDispatchService();
