import { Prisma } from '@prisma/client';
import type { TerminalRestoreSnapshot } from '../ws/headless-terminal-state.js';
import { prisma } from '../db.js';

interface PersistedInteractiveTerminalState {
  active: boolean;
  snapshot?: TerminalRestoreSnapshot;
}

interface InteractiveTerminalStatePatch {
  active?: boolean;
  snapshot?: TerminalRestoreSnapshot | null;
}

export class InteractiveTerminalStateService {
  async get(sessionId: string): Promise<PersistedInteractiveTerminalState | null> {
    const state = await prisma.interactiveTerminalState.findUnique({
      where: { sessionId },
    });
    if (!state) return null;

    return {
      active: state.active,
      snapshot: this.parseSnapshot(state.snapshotJson),
    };
  }

  async update(sessionId: string, patch: InteractiveTerminalStatePatch): Promise<void> {
    const current = await prisma.interactiveTerminalState.findUnique({
      where: { sessionId },
      select: { active: true, snapshotJson: true },
    });

    const active = patch.active ?? current?.active ?? false;
    const snapshot = patch.snapshot === undefined
      ? current?.snapshotJson ?? null
      : patch.snapshot
        ? JSON.stringify(patch.snapshot)
        : null;

    try {
      await prisma.interactiveTerminalState.upsert({
        where: { sessionId },
        create: {
          sessionId,
          active,
          snapshotJson: snapshot,
        },
        update: {
          active,
          snapshotJson: snapshot,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError
        && (err.code === 'P2003' || err.code === 'P2025')
      ) {
        return;
      }
      throw err;
    }
  }

  private parseSnapshot(raw: string | null): TerminalRestoreSnapshot | undefined {
    if (!raw) return undefined;

    try {
      const parsed = JSON.parse(raw) as TerminalRestoreSnapshot;
      if (
        typeof parsed.cols !== 'number'
        || typeof parsed.rows !== 'number'
        || typeof parsed.viewportY !== 'number'
        || typeof parsed.screen !== 'string'
      ) {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }
}

export const interactiveTerminalStateService = new InteractiveTerminalStateService();
