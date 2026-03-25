import { prisma } from '../db.js';

/**
 * Assemble the 4-layer prompt for an agent run.
 * Layer 1: System/Driver Prompt
 * Layer 2: Room Brief (Pinned Brief)
 * Layer 3: Task input (user message or handoff bundle)
 * Layer 4: Repo context
 */
export class PromptAssembler {
  async assemble(input: {
    roomId: string;
    taskContent: string;
    triggerType: string;
    repoPath: string;
    worktreePath?: string;
    branch?: string;
  }): Promise<string> {
    // Layer 1: System prompt
    const systemPrompt = `You are working inside Control Room, a multi-agent collaboration console.
Your output should be clear and structured to help both the user and another agent that may take over.
When you finish a task, provide a concise summary of what was done, what decisions were made, and what remains.`;

    // Layer 2: Pinned brief
    const pinnedItems = await prisma.pinnedBriefItem.findMany({
      where: { roomId: input.roomId },
      orderBy: { sortOrder: 'asc' },
    });

    let briefSection = '';
    if (pinnedItems.length > 0) {
      const grouped: Record<string, string[]> = {};
      for (const item of pinnedItems) {
        if (!grouped[item.section]) grouped[item.section] = [];
        grouped[item.section].push(item.content);
      }

      const sectionLabels: Record<string, string> = {
        goal: 'Goal',
        constraints: 'Constraints',
        decisions: 'Decisions',
        openQuestions: 'Open Questions',
        doNotTouch: 'Do Not Touch',
      };

      briefSection = '\n[Shared Brief]\n';
      for (const [section, items] of Object.entries(grouped)) {
        briefSection += `- ${sectionLabels[section] ?? section}:\n`;
        for (const item of items) {
          briefSection += `  - ${item}\n`;
        }
      }
    }

    // Layer 3: Task
    const taskSection = `\n[This Task]\n- Trigger: ${input.triggerType}\n${input.taskContent}`;

    // Layer 4: Repo context
    const repoSection = `\n[Repo Context]\n- Path: ${input.worktreePath ?? input.repoPath}\n- Branch: ${input.branch ?? 'unknown'}`;

    return [systemPrompt, briefSection, taskSection, repoSection].filter(Boolean).join('\n');
  }
}

export const promptAssembler = new PromptAssembler();
