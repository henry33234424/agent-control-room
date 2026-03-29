import type { AgentKind, SessionStatus } from './agent.js';
import type { ChatMessage } from './chat-message.js';
import type { PinnedBriefItem } from './pinned-brief.js';

export interface Room {
  id: string;
  name: string;
  repoPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSession {
  id: string;
  roomId: string;
  agent: AgentKind;
  vendorSessionId?: string;
  name: string;
  status: SessionStatus;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RoomSnapshot {
  room: Room;
  sessions: AgentSession[];
  recentMessages: ChatMessage[];
  pinnedBrief: PinnedBriefItem[];
}
