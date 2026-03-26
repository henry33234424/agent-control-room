import type { AgentKind, SessionStatus, SessionMode } from './agent.js';
import type { Approval } from './approval.js';
import type { ChatMessage } from './chat-message.js';
import type { PinnedBriefItem } from './pinned-brief.js';

export interface Room {
  id: string;
  name: string;
  repoPath: string;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSession {
  id: string;
  roomId: string;
  agent: AgentKind;
  vendorSessionId?: string;
  name: string;
  mode: SessionMode;
  status: SessionStatus;
  worktreeId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RoomSnapshot {
  room: Room;
  sessions: AgentSession[];
  recentMessages: ChatMessage[];
  pinnedBrief: PinnedBriefItem[];
  pendingApprovals: Approval[];
}
