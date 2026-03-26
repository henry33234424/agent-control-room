import type { AgentSession, AgentKind, SessionStatus } from '@control-room/shared-types';
import { canTransitionSession } from '@control-room/shared-types';
import { prisma } from '../db.js';
import { toSessionDto } from '../lib/dto.js';
import { roomChannel } from '../ws/room-channel.js';

interface SessionMetadata {
  branch?: string;
  worktreePath?: string;
}

export class SessionService {
  async updateStatus(sessionId: string, newStatus: SessionStatus): Promise<void> {
    const session = await prisma.agentSession.findUniqueOrThrow({ where: { id: sessionId } });
    const currentStatus = session.status as SessionStatus;

    if (!canTransitionSession(currentStatus, newStatus)) {
      throw new Error(`Invalid session transition: ${currentStatus} → ${newStatus}`);
    }

    await prisma.agentSession.update({
      where: { id: sessionId },
      data: { status: newStatus },
    });

    // Broadcast session status change (separate from run.status)
    roomChannel.broadcast(session.roomId, {
      type: 'session.status',
      data: { sessionId, status: newStatus },
    });
    await this.broadcastSessionUpdated(sessionId);
  }

  async setVendorSessionId(sessionId: string, vendorId: string): Promise<void> {
    await prisma.agentSession.update({
      where: { id: sessionId },
      data: { vendorSessionId: vendorId },
    });
    await this.broadcastSessionUpdated(sessionId);
  }

  async bindWorktree(
    sessionId: string,
    input: { path: string; branch: string },
  ): Promise<{ id: string; path: string; branch: string }> {
    const session = await prisma.agentSession.findUniqueOrThrow({ where: { id: sessionId } });

    let worktree = await prisma.worktree.findFirst({
      where: { roomId: session.roomId, path: input.path },
    });
    if (!worktree) {
      worktree = await prisma.worktree.create({
        data: {
          roomId: session.roomId,
          agent: session.agent,
          sessionKey: session.name,
          path: input.path,
          branch: input.branch,
          mode: session.mode,
        },
      });
    }

    const metadata = this.parseMetadata(session.metadataJson);
    metadata.branch = input.branch;
    metadata.worktreePath = input.path;

    await prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        worktreeId: worktree.id,
        metadataJson: JSON.stringify(metadata),
      },
    });

    await this.broadcastSessionUpdated(sessionId);

    return { id: worktree.id, path: worktree.path, branch: worktree.branch };
  }

  async findOrCreateForAgent(
    roomId: string,
    agent: AgentKind,
    preferredSessionId?: string,
  ): Promise<AgentSession> {
    // If a specific session is requested, use it
    if (preferredSessionId) {
      const specific = await prisma.agentSession.findFirst({
        where: { id: preferredSessionId, roomId, agent },
      });
      if (specific) {
        // Recover failed session to idle before returning
        if (specific.status === 'failed') {
          await this.updateStatus(specific.id, 'idle');
          specific.status = 'idle';
        }
        return toSessionDto(specific);
      }
    }

    // Find an existing idle or failed session for this agent
    const existing = await prisma.agentSession.findFirst({
      where: { roomId, agent, status: { in: ['idle', 'failed'] } },
      orderBy: { updatedAt: 'desc' },
    });

    if (existing) {
      if (existing.status === 'failed') {
        await this.updateStatus(existing.id, 'idle');
        existing.status = 'idle';
      }
      return toSessionDto(existing);
    }

    // Create a new session
    const name = `${agent}-${Date.now()}`;
    const created = await prisma.agentSession.create({
      data: { roomId, agent, name, mode: 'readWrite' },
    });
    await this.broadcastSessionUpdated(created.id);
    return toSessionDto(created);
  }

  private parseMetadata(raw: string | null): SessionMetadata {
    if (!raw) return {};
    try {
      return JSON.parse(raw) as SessionMetadata;
    } catch {
      return {};
    }
  }

  private async broadcastSessionUpdated(sessionId: string): Promise<void> {
    const session = await prisma.agentSession.findUniqueOrThrow({ where: { id: sessionId } });
    roomChannel.broadcast(session.roomId, {
      type: 'session.updated',
      data: toSessionDto(session),
    });
  }
}

export const sessionService = new SessionService();
