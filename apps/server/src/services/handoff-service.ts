import type { HandoffBundle, AgentKind } from '@control-room/shared-types';
import { prisma } from '../db.js';
import { execSync } from 'node:child_process';

const MAX_MESSAGES = 20;
const MAX_EXCERPT_CHARS = 20_000;
const MAX_DIFF_CHARS = 8_000;

export class HandoffService {
  async createBundle(input: {
    roomId: string;
    targetAgent: AgentKind;
    selectedMessageIds: string[];
    userInstruction: string;
  }): Promise<HandoffBundle> {
    const { roomId, targetAgent, selectedMessageIds, userInstruction } = input;

    // 1. Fetch selected messages
    const messages = await prisma.chatMessage.findMany({
      where: { id: { in: selectedMessageIds.slice(0, MAX_MESSAGES) }, roomId },
      orderBy: { createdAt: 'asc' },
    });

    // Determine source agent from selected messages
    const agentMessages = messages.filter((m) => m.agent);
    const sourceAgent = agentMessages.length > 0 ? (agentMessages[0].agent as AgentKind) : undefined;

    // 2. Compile raw excerpt
    let rawExcerpt = messages
      .map((m) => `[${m.role}${m.agent ? ` (${m.agent})` : ''}] ${m.content}`)
      .join('\n\n');
    if (rawExcerpt.length > MAX_EXCERPT_CHARS) {
      rawExcerpt = rawExcerpt.slice(0, MAX_EXCERPT_CHARS) + '\n\n[...truncated]';
    }

    // 3. Get pinned brief snapshot
    const pinnedItems = await prisma.pinnedBriefItem.findMany({
      where: { roomId },
      orderBy: { sortOrder: 'asc' },
    });
    const pinnedBriefSnapshot = pinnedItems
      .map((p) => `[${p.section}] ${p.content}`)
      .join('\n');

    // 4. Capture repo snapshot
    const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
    const repoSnapshot = captureRepoSnapshot(room.repoPath);

    // 5. Build structured summary (simplified — no LLM call in V1, plain extraction)
    const structuredSummary = {
      goal: userInstruction,
      decisions: messages
        .filter((m) => m.pinned || m.role === 'agent')
        .slice(0, 5)
        .map((m) => m.content.slice(0, 200)),
      constraints: pinnedItems.filter((p) => p.section === 'constraints').map((p) => p.content),
      openQuestions: pinnedItems.filter((p) => p.section === 'openQuestions').map((p) => p.content),
      files: repoSnapshot.changedFiles,
      diffs: [],
      nextTask: userInstruction,
    };

    // 6. Persist bundle
    const bundle = await prisma.handoffBundle.create({
      data: {
        roomId,
        sourceAgent: sourceAgent ?? null,
        targetAgent,
        rawExcerpt,
        structuredSummaryJson: JSON.stringify(structuredSummary),
        pinnedBriefSnapshot,
        repoSnapshotJson: JSON.stringify(repoSnapshot),
        userInstruction,
      },
    });

    // 7. Create message links
    for (let i = 0; i < messages.length; i++) {
      await prisma.handoffBundleMessageLink.create({
        data: { bundleId: bundle.id, messageId: messages[i].id, sortOrder: i },
      });
    }

    return {
      id: bundle.id,
      roomId: bundle.roomId,
      sourceAgent,
      targetAgent: bundle.targetAgent as AgentKind,
      selectedMessageIds: messages.map((m) => m.id),
      rawExcerpt: bundle.rawExcerpt,
      structuredSummary,
      pinnedBriefSnapshot: bundle.pinnedBriefSnapshot,
      repoSnapshot,
      userInstruction: bundle.userInstruction,
      createdAt: bundle.createdAt.toISOString(),
    };
  }
}

function captureRepoSnapshot(repoPath: string) {
  try {
    const branch = execSync('git branch --show-current', { cwd: repoPath, encoding: 'utf-8' }).trim();
    const commit = execSync('git rev-parse --short HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim();
    const diffStat = execSync('git diff --stat', { cwd: repoPath, encoding: 'utf-8' }).trim();
    const changedFiles = diffStat
      .split('\n')
      .filter((l) => l.includes('|'))
      .map((l) => l.split('|')[0].trim());

    return { repoPath, branch, commit, changedFiles };
  } catch {
    return { repoPath, branch: 'unknown', commit: 'unknown', changedFiles: [] as string[] };
  }
}

export const handoffService = new HandoffService();
