import type { AgentKind } from '@control-room/shared-types';

export interface RunInput {
  roomId: string;
  sessionId: string;
  runId: string;
  vendorSessionId?: string;
  prompt: string;
  workingDirectory: string;
  worktreeId?: string;
}

export interface ReviewInput {
  roomId: string;
  sessionId: string;
  runId: string;
  vendorSessionId?: string;
  target: 'uncommittedChanges' | 'baseBranch' | 'commit' | 'custom';
  customRef?: string;
  workingDirectory: string;
  worktreeId?: string;
}

export interface AgentDriver {
  agent: AgentKind;
  run(input: RunInput): Promise<void>;
  review?(input: ReviewInput): Promise<void>;
}
