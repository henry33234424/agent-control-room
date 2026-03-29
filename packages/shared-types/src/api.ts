import type { AgentKind } from './agent.js';
import type { MentionTarget } from './chat-message.js';
import type { PinnedBriefSection } from './pinned-brief.js';

// ── Room ──

export interface CreateRoomRequest {
  name: string;
  repoPath: string;
}

export interface UpdateRoomRequest {
  name: string;
}

// ── Session ──

export interface CreateSessionRequest {
  agent: AgentKind;
  name: string;
}

export interface UpdateSessionRequest {
  name: string;
}

// ── Message ──

export interface SendMessageRequest {
  content: string;
  mentionTarget: MentionTarget;
  sessionId?: string;
  selectedMessageIds?: string[];
}

export interface ListMessagesQuery {
  limit?: number;
  cursor?: string;
}

// ── Pinned Brief ──

export interface CreatePinRequest {
  section: PinnedBriefSection;
  content: string;
  messageId?: string;
}

export interface UpdatePinRequest {
  content?: string;
  sortOrder?: number;
}

// ── Paginated response ──

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}
