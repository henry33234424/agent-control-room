import type { AgentKind } from './agent.js';

export type ChatMessageRole =
  | 'user'
  | 'agent'
  | 'system'
  | 'handoff-summary'
  | 'excerpt';

export type MentionTarget = 'claude' | 'codex' | 'both';

export interface ChatMessage {
  id: string;
  roomId: string;
  sessionId?: string;
  agent?: AgentKind;
  role: ChatMessageRole;
  mentionTarget?: MentionTarget;
  replyToMessageId?: string;
  content: string;
  contentFormat: 'markdown' | 'plain';
  selectable: boolean;
  pinned: boolean;
  createdAt: string;
}
