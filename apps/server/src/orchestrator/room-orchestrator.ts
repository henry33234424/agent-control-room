import type { MentionTarget, AgentKind } from '@control-room/shared-types';
import { parseMention, getTargetAgents } from './message-router.js';
import { runManager } from './run-manager.js';
import { promptAssembler } from './prompt-assembler.js';
import { sessionService } from '../services/session-service.js';
import { messageService } from '../services/message-service.js';
import { eventService } from '../services/event-service.js';
import { prisma } from '../db.js';
import { ensureWorktree } from '@control-room/git-worktree';
import type { AgentDriver } from '../adapters/agent-driver.js';

class RoomOrchestrator {
  private drivers = new Map<AgentKind, AgentDriver>();

  // Track which worktree paths have a running write session
  private activeWritePaths = new Set<string>();

  registerDriver(agent: AgentKind, driver: AgentDriver): void {
    this.drivers.set(agent, driver);
  }

  async handleUserMessage(
    roomId: string,
    content: string,
    mentionTarget?: MentionTarget,
    preferredSessionId?: string,
    triggerType: 'user' | 'handoff' | 'review' = 'user',
  ): Promise<void> {
    const { target, cleanContent } = parseMention(content, mentionTarget);
    const agents = getTargetAgents(target);

    const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });

    for (const agent of agents) {
      const session = await sessionService.findOrCreateForAgent(roomId, agent, preferredSessionId);

      // Determine working directory
      let workDir: string;
      let branch = room.defaultBranch;
      let worktreeId: string | undefined;
      if (session.mode === 'readWrite') {
        // Fail-closed: if worktree creation fails, refuse to run — never fall back to repo root
        try {
          const wt = ensureWorktree({
            repoPath: room.repoPath,
            baseDir: room.repoPath,
            agent,
            sessionKey: session.name,
            baseBranch: room.defaultBranch,
          });
          workDir = wt.path;
          branch = wt.branch;
          const binding = await sessionService.bindWorktree(session.id, {
            path: wt.path,
            branch: wt.branch,
          });
          worktreeId = binding.id;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await messageService.create({
            roomId,
            sessionId: session.id,
            agent,
            role: 'system',
            content: `Cannot create isolated worktree for this session: ${errMsg}. Ensure the repo has at least one commit and the branch "${room.defaultBranch}" exists.`,
            selectable: false,
          });
          continue;
        }

        // Prevent two concurrent write sessions on the same path
        if (this.activeWritePaths.has(workDir)) {
          await messageService.create({
            roomId,
            sessionId: session.id,
            agent,
            role: 'system',
            content: `Cannot start: another write session is already using ${workDir}. Wait for it to finish or use a different session.`,
            selectable: false,
          });
          continue;
        }
      } else {
        // Read-only sessions can share the repo root
        workDir = room.repoPath;
      }

      const prompt = await promptAssembler.assemble({
        roomId,
        taskContent: cleanContent,
        triggerType,
        repoPath: room.repoPath,
        worktreePath: workDir !== room.repoPath ? workDir : undefined,
        branch,
      });

      const runId = await runManager.createRun({
        roomId,
        agentSessionId: session.id,
        triggerType,
        promptSnapshot: prompt,
      });

      await sessionService.updateStatus(session.id, 'running');

      const driver = this.drivers.get(agent);
      if (!driver) {
        await messageService.create({
          roomId,
          role: 'system',
          content: `Agent driver for ${agent} is not available yet.`,
          selectable: false,
        });
        await runManager.transitionRun(runId, 'preparing');
        await runManager.transitionRun(runId, 'failed');
        await sessionService.updateStatus(session.id, 'failed');
        continue;
      }

      if (session.mode === 'readWrite') {
        this.activeWritePaths.add(workDir);
      }

      this.executeRun(driver, {
        roomId,
        sessionId: session.id,
        runId,
        vendorSessionId: session.vendorSessionId,
        prompt,
        workingDirectory: workDir,
        worktreeId,
      })
        .catch(async (err) => {
          console.error(`Run ${runId} failed:`, err);
          try {
            await runManager.transitionRun(runId, 'failed');
            await sessionService.updateStatus(session.id, 'failed');
            await messageService.create({
              roomId,
              sessionId: session.id,
              agent,
              role: 'system',
              content: `Run failed: ${err instanceof Error ? err.message : String(err)}`,
              selectable: false,
            });
          } catch (innerErr) {
            console.error('Failed to handle run error:', innerErr);
          }
        })
        .finally(() => {
          if (session.mode === 'readWrite') {
            this.activeWritePaths.delete(workDir);
          }
        });
    }
  }

  /**
   * Dispatch a detached review to the appropriate agent.
   * Creates a single run with triggerType='review' and calls driver.review().
   */
  async dispatchReview(input: {
    roomId: string;
    agent: AgentKind;
    sessionId: string;
    target: 'uncommittedChanges' | 'baseBranch' | 'commit' | 'custom';
    customRef?: string;
    parentRunId?: string;
  }): Promise<string> {
    const { roomId, agent, sessionId, target, customRef, parentRunId } = input;

    const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
    const session = await prisma.agentSession.findUniqueOrThrow({ where: { id: sessionId } });

    const driver = this.drivers.get(agent);
    if (!driver?.review) {
      throw new Error(`Agent ${agent} does not support review`);
    }

    let workDir = room.repoPath;
    let worktreeId: string | undefined;
    if (session.mode === 'readWrite') {
      const wt = ensureWorktree({
        repoPath: room.repoPath,
        baseDir: room.repoPath,
        agent,
        sessionKey: session.name,
        baseBranch: room.defaultBranch,
      });
      workDir = wt.path;
      const binding = await sessionService.bindWorktree(sessionId, {
        path: wt.path,
        branch: wt.branch,
      });
      worktreeId = binding.id;
    }

    const runId = await runManager.createRun({
      roomId,
      agentSessionId: sessionId,
      triggerType: 'review',
      parentRunId,
    });

    await sessionService.updateStatus(sessionId, 'running');

    this.executeRun(driver, {
      roomId,
      sessionId,
      runId,
      vendorSessionId: undefined,
      prompt: '', // review doesn't need a prompt
      workingDirectory: workDir,
      worktreeId,
    }, 'review', {
      target,
      customRef: target === 'baseBranch' && !customRef ? room.defaultBranch : customRef,
    })
      .catch(async (err) => {
        console.error(`Review run ${runId} failed:`, err);
        try {
          await runManager.transitionRun(runId, 'failed');
          await sessionService.updateStatus(sessionId, 'failed');
        } catch {}
      });

    return runId;
  }

  private async executeRun(
    driver: AgentDriver,
    input: {
      roomId: string;
      sessionId: string;
      runId: string;
      vendorSessionId?: string;
      prompt: string;
      workingDirectory: string;
      worktreeId?: string;
    },
    mode: 'run' | 'review' = 'run',
    reviewOpts?: { target: string; customRef?: string },
  ): Promise<void> {
    await runManager.transitionRun(input.runId, 'preparing');
    await runManager.transitionRun(input.runId, 'running');

    if (mode === 'review' && driver.review && reviewOpts) {
      await driver.review({
        ...input,
        target: reviewOpts.target as any,
        customRef: reviewOpts.customRef,
      });
    } else {
      await driver.run(input);
    }
  }
}

export const orchestrator = new RoomOrchestrator();
