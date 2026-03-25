import type { RunStatus, TriggerType } from '@control-room/shared-types';
import { canTransitionRun } from '@control-room/shared-types';
import { prisma } from '../db.js';
import { roomChannel } from '../ws/room-channel.js';

export class RunManager {
  async createRun(input: {
    roomId: string;
    agentSessionId: string;
    triggerType: TriggerType;
    promptSnapshot?: string;
    parentRunId?: string;
  }): Promise<string> {
    const run = await prisma.run.create({
      data: {
        roomId: input.roomId,
        agentSessionId: input.agentSessionId,
        triggerType: input.triggerType,
        promptSnapshot: input.promptSnapshot,
        parentRunId: input.parentRunId,
      },
    });

    roomChannel.broadcast(input.roomId, {
      type: 'run.status',
      data: { runId: run.id, sessionId: input.agentSessionId, status: 'queued' },
    });

    return run.id;
  }

  async transitionRun(runId: string, newStatus: RunStatus): Promise<void> {
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    const current = run.status as RunStatus;

    if (!canTransitionRun(current, newStatus)) {
      throw new Error(`Invalid run transition: ${current} → ${newStatus}`);
    }

    const updateData: Record<string, unknown> = { status: newStatus };
    if (newStatus === 'running' && !run.startedAt) {
      updateData.startedAt = new Date();
    }
    if (['completed', 'failed', 'cancelled'].includes(newStatus)) {
      updateData.endedAt = new Date();
    }

    await prisma.run.update({ where: { id: runId }, data: updateData });

    roomChannel.broadcast(run.roomId, {
      type: 'run.status',
      data: { runId, sessionId: run.agentSessionId, status: newStatus },
    });
  }

  async setResult(runId: string, summary: string, costUsd?: number): Promise<void> {
    await prisma.run.update({
      where: { id: runId },
      data: { resultSummary: summary, totalCostUsd: costUsd },
    });
  }
}

export const runManager = new RunManager();
