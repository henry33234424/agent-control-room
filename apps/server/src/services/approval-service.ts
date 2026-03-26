import type { Approval, ApprovalType, AgentKind } from '@control-room/shared-types';
import { prisma } from '../db.js';
import { roomChannel } from '../ws/room-channel.js';
import { eventService } from './event-service.js';
import { randomUUID } from 'node:crypto';
import { toApprovalDto } from '../lib/dto.js';

export interface CreateApprovalInput {
  roomId: string;
  runId: string;
  sessionId: string;
  agent: AgentKind;
  approvalType: ApprovalType;
  title: string;
  payload?: Record<string, unknown>;
}

type ApprovalDecision = 'approved' | 'denied';

class ApprovalService {
  private pendingResolvers = new Map<string, (decision: ApprovalDecision) => void>();

  async listPendingByRoom(roomId: string): Promise<Approval[]> {
    const approvals = await prisma.approval.findMany({
      where: { roomId, status: 'pending' },
      include: {
        run: {
          select: {
            agentSessionId: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return approvals.map(toApprovalDto);
  }

  async createApproval(input: CreateApprovalInput): Promise<Approval> {
    const approval = await prisma.approval.create({
      data: {
        roomId: input.roomId,
        runId: input.runId,
        agent: input.agent,
        approvalType: input.approvalType,
        title: input.title,
        payloadJson: input.payload ? JSON.stringify(input.payload) : null,
      },
    });

    const dto: Approval = toApprovalDto({
      ...approval,
      run: {
        agentSessionId: input.sessionId,
      },
      payloadJson: input.payload ? JSON.stringify(input.payload) : null,
    });

    await eventService.emitAndBroadcast({
      id: randomUUID(),
      roomId: input.roomId,
      agent: input.agent,
      sessionId: input.sessionId,
      runId: input.runId,
      kind: 'approval.requested',
      title: input.title,
      payload: { ...input.payload, approvalId: approval.id },
      level: 'warn',
      ts: new Date().toISOString(),
    });

    roomChannel.broadcast(input.roomId, { type: 'approval.requested', data: dto });
    return dto;
  }

  async waitForDecision(approvalId: string, timeoutMs = 600_000): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResolvers.delete(approvalId);
        this.markTimedOut(approvalId).catch(() => {});
        reject(new Error(`Approval ${approvalId} timed out`));
      }, timeoutMs);

      this.pendingResolvers.set(approvalId, (decision) => {
        clearTimeout(timer);
        resolve(decision);
      });
    });
  }

  async decide(approvalId: string, decision: ApprovalDecision): Promise<void> {
    const approval = await prisma.approval.update({
      where: { id: approvalId },
      data: { status: decision, resolvedAt: new Date() },
    });

    // Look up run to get sessionId
    const run = await prisma.run.findUnique({ where: { id: approval.runId } });

    const dto: Approval = toApprovalDto({
      ...approval,
      run: run ? { agentSessionId: run.agentSessionId } : null,
    });

    // Write resolved runtime event
    await eventService.emitAndBroadcast({
      id: randomUUID(),
      roomId: approval.roomId,
      agent: approval.agent as AgentKind,
      sessionId: run?.agentSessionId ?? '',
      runId: approval.runId,
      kind: 'approval.resolved',
      title: `${approval.title} → ${decision}`,
      payload: { approvalId, decision },
      level: 'info',
      ts: new Date().toISOString(),
    });

    roomChannel.broadcast(approval.roomId, { type: 'approval.resolved', data: dto });

    const resolver = this.pendingResolvers.get(approvalId);
    if (resolver) {
      resolver(decision);
      this.pendingResolvers.delete(approvalId);
    }
  }

  private async markTimedOut(approvalId: string): Promise<void> {
    const approval = await prisma.approval.update({
      where: { id: approvalId },
      data: { status: 'cancelled', resolvedAt: new Date() },
    });

    const run = await prisma.run.findUnique({ where: { id: approval.runId } });

    // Broadcast cancelled so frontend clears the pending approval card
    const dto: Approval = toApprovalDto({
      ...approval,
      run: run ? { agentSessionId: run.agentSessionId } : null,
    });
    roomChannel.broadcast(approval.roomId, { type: 'approval.resolved', data: dto });

    // Write runtime event
    await eventService.emitAndBroadcast({
      id: randomUUID(),
      roomId: approval.roomId,
      agent: approval.agent as AgentKind,
      sessionId: run?.agentSessionId ?? '',
      runId: approval.runId,
      kind: 'approval.resolved',
      title: `${approval.title} → timed out`,
      payload: { approvalId, decision: 'cancelled', reason: 'timeout' },
      level: 'warn',
      ts: new Date().toISOString(),
    });
  }
}

export const approvalService = new ApprovalService();
