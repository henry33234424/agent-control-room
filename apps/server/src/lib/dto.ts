import type {
  ChatMessage,
  AgentSession,
  Room,
  PinnedBriefItem,
  AgentKind,
  ChatMessageRole,
  MentionTarget,
  SessionStatus,
} from '@control-room/shared-types';

// Prisma returns null for optional fields; our DTOs use undefined.
// These helpers do the conversion in one place.

type PrismaRoom = {
  id: string;
  name: string;
  repoPath: string;
  createdAt: Date;
  updatedAt: Date;
};

export function toRoomDto(r: PrismaRoom): Room {
  return {
    id: r.id,
    name: r.name,
    repoPath: r.repoPath,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

type PrismaSession = {
  id: string;
  roomId: string;
  agent: string;
  vendorSessionId: string | null;
  name: string;
  status: string;
  metadataJson: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toSessionDto(s: PrismaSession): AgentSession {
  return {
    id: s.id,
    roomId: s.roomId,
    agent: s.agent as AgentKind,
    vendorSessionId: s.vendorSessionId ?? undefined,
    name: s.name,
    status: s.status as SessionStatus,
    metadata: s.metadataJson ? JSON.parse(s.metadataJson) : undefined,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

type PrismaMessage = {
  id: string;
  roomId: string;
  sessionId: string | null;
  agent: string | null;
  role: string;
  mentionTarget: string | null;
  replyToMessageId: string | null;
  content: string;
  contentFormat: string;
  selectable: boolean;
  pinned: boolean;
  createdAt: Date;
  updatedAt?: Date;
};

export function toMessageDto(m: PrismaMessage): ChatMessage {
  return {
    id: m.id,
    roomId: m.roomId,
    sessionId: m.sessionId ?? undefined,
    agent: (m.agent as AgentKind) ?? undefined,
    role: m.role as ChatMessageRole,
    mentionTarget: (m.mentionTarget as MentionTarget) ?? undefined,
    replyToMessageId: m.replyToMessageId ?? undefined,
    content: m.content,
    contentFormat: m.contentFormat as 'markdown' | 'plain',
    selectable: m.selectable,
    pinned: m.pinned,
    createdAt: m.createdAt.toISOString(),
  };
}

type PrismaPin = {
  id: string;
  roomId: string;
  section: string;
  content: string;
  sortOrder: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export function toPinDto(p: PrismaPin): PinnedBriefItem {
  return {
    id: p.id,
    roomId: p.roomId,
    section: p.section as PinnedBriefItem['section'],
    content: p.content,
    sortOrder: p.sortOrder,
    version: p.version,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
