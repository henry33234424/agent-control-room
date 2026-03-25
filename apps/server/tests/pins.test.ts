import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTestPrisma } from './setup.js';

let prisma: PrismaClient;
let roomId: string;

beforeAll(async () => {
  prisma = createTestPrisma();
  const room = await prisma.room.create({
    data: { name: 'test-room', repoPath: '/tmp/test-repo', defaultBranch: 'main' },
  });
  roomId = room.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PinnedBriefItem CRUD + History', () => {
  let pinId: string;

  it('creates a pin and writes a "created" history snapshot', async () => {
    const maxOrder = await prisma.pinnedBriefItem.aggregate({
      where: { roomId, section: 'goal' },
      _max: { sortOrder: true },
    });

    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.pinnedBriefItem.create({
        data: {
          roomId,
          section: 'goal',
          content: 'Ship V1 by end of March',
          sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
        },
      });
      await tx.pinnedBriefHistory.create({
        data: {
          roomId: created.roomId,
          itemId: created.id,
          section: created.section,
          content: created.content,
          sortOrder: created.sortOrder,
          version: created.version,
          changeType: 'created',
        },
      });
      return created;
    });

    pinId = item.id;
    expect(item.section).toBe('goal');
    expect(item.content).toBe('Ship V1 by end of March');
    expect(item.version).toBe(1);

    const history = await prisma.pinnedBriefHistory.findMany({ where: { itemId: pinId } });
    expect(history).toHaveLength(1);
    expect(history[0].changeType).toBe('created');
    expect(history[0].content).toBe('Ship V1 by end of March');
    expect(history[0].section).toBe('goal');
    expect(history[0].sortOrder).toBe(0);
  });

  it('updates a pin content and writes an "updated" history snapshot with OLD content', async () => {
    const current = await prisma.pinnedBriefItem.findUniqueOrThrow({ where: { id: pinId } });

    const updated = await prisma.$transaction(async (tx) => {
      // History snapshot captures the CURRENT state before mutation
      await tx.pinnedBriefHistory.create({
        data: {
          roomId: current.roomId,
          itemId: current.id,
          section: current.section,
          content: current.content,
          sortOrder: current.sortOrder,
          version: current.version,
          changeType: 'updated',
        },
      });
      return tx.pinnedBriefItem.update({
        where: { id: pinId },
        data: { content: 'Ship V1 by April 1st', version: { increment: 1 } },
      });
    });

    expect(updated.content).toBe('Ship V1 by April 1st');
    expect(updated.version).toBe(2);

    const history = await prisma.pinnedBriefHistory.findMany({
      where: { itemId: pinId },
      orderBy: { changedAt: 'asc' },
    });
    expect(history).toHaveLength(2);
    // Second history entry has the OLD content (before update)
    expect(history[1].changeType).toBe('updated');
    expect(history[1].content).toBe('Ship V1 by end of March');
    expect(history[1].version).toBe(1);
  });

  it('reorder writes a "reordered" history snapshot', async () => {
    const current = await prisma.pinnedBriefItem.findUniqueOrThrow({ where: { id: pinId } });

    await prisma.$transaction(async (tx) => {
      await tx.pinnedBriefHistory.create({
        data: {
          roomId: current.roomId,
          itemId: current.id,
          section: current.section,
          content: current.content,
          sortOrder: current.sortOrder,
          version: current.version,
          changeType: 'reordered',
        },
      });
      await tx.pinnedBriefItem.update({
        where: { id: pinId },
        data: { sortOrder: 5, version: { increment: 1 } },
      });
    });

    const history = await prisma.pinnedBriefHistory.findMany({
      where: { itemId: pinId, changeType: 'reordered' },
    });
    expect(history).toHaveLength(1);
    expect(history[0].sortOrder).toBe(0); // old sortOrder
  });

  it('delete writes a "deleted" history snapshot, and history survives item deletion', async () => {
    const current = await prisma.pinnedBriefItem.findUniqueOrThrow({ where: { id: pinId } });

    await prisma.$transaction(async (tx) => {
      await tx.pinnedBriefHistory.create({
        data: {
          roomId: current.roomId,
          itemId: current.id,
          section: current.section,
          content: current.content,
          sortOrder: current.sortOrder,
          version: current.version,
          changeType: 'deleted',
        },
      });
      await tx.pinnedBriefItem.delete({ where: { id: pinId } });
    });

    // Item should be gone
    const item = await prisma.pinnedBriefItem.findUnique({ where: { id: pinId } });
    expect(item).toBeNull();

    // History should survive (FK is to room, not item)
    const history = await prisma.pinnedBriefHistory.findMany({ where: { itemId: pinId } });
    expect(history.length).toBeGreaterThanOrEqual(4); // created, updated, reordered, deleted
    const deleteEntry = history.find((h) => h.changeType === 'deleted');
    expect(deleteEntry).toBeDefined();
    expect(deleteEntry!.content).toBe('Ship V1 by April 1st');
  });
});
