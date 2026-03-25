import type { AgentKind } from './agent.js';

export interface StructuredSummary {
  goal: string;
  decisions: string[];
  constraints: string[];
  openQuestions: string[];
  files: string[];
  diffs: string[];
  nextTask: string;
}

export interface RepoSnapshot {
  repoPath: string;
  branch: string;
  commit: string;
  worktreePath?: string;
  changedFiles: string[];
}

export interface HandoffBundle {
  id: string;
  roomId: string;
  sourceAgent?: AgentKind;
  targetAgent: AgentKind;
  selectedMessageIds: string[];
  rawExcerpt: string;
  structuredSummary: StructuredSummary;
  pinnedBriefSnapshot: string;
  repoSnapshot: RepoSnapshot;
  userInstruction: string;
  createdAt: string;
}
