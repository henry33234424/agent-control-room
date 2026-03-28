import type { AgentKind, SessionMode, TriggerType } from './agent.js';
import type { MentionTarget } from './chat-message.js';
import type { PinnedBriefSection } from './pinned-brief.js';

// ── Room ──

export interface CreateRoomRequest {
  name: string;
  repoPath: string;
  defaultBranch?: string;
}

export interface UpdateRoomRequest {
  name: string;
}

// ── Session ──

export interface CreateSessionRequest {
  agent: AgentKind;
  name: string;
  mode?: SessionMode;
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

// ── Handoff ──

export interface CreateHandoffRequest {
  targetAgent: AgentKind;
  selectedMessageIds: string[];
  userInstruction: string;
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

// ── Approval ──

export interface DecideApprovalRequest {
  decision: 'approved' | 'denied';
}

// ── Review ──

export interface CreateReviewRequest {
  agent: AgentKind;
  sessionId: string;
  target: 'uncommittedChanges' | 'baseBranch' | 'commit' | 'custom';
  customRef?: string;
  parentRunId?: string;
}

// ── Paginated response ──

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}
