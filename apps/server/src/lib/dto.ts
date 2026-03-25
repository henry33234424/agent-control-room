import type {
  ChatMessage,
  AgentSession,
  Room,
  RuntimeEvent,
  PinnedBriefItem,
  AgentKind,
  ChatMessageRole,
  MentionTarget,
  SessionMode,
  SessionStatus,
  RuntimeEventKind,
  EventLevel,
} from '@control-room/shared-types';

// Prisma returns null for optional fields; our DTOs use undefined.
// These helpers do the conversion in one place.

type PrismaRoom = {
  id: string;
  name: string;
  repoPath: string;
  defaultBranch: string;
  createdAt: Date;
  updatedAt: Date;
};

export function toRoomDto(r: PrismaRoom): Room {
  return {
    id: r.id,
    name: r.name,
    repoPath: r.repoPath,
    defaultBranch: r.defaultBranch,
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
  mode: string;
  status: string;
  worktreeId: string | null;
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
    mode: s.mode as SessionMode,
    status: s.status as SessionStatus,
    worktreeId: s.worktreeId ?? undefined,
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

type PrismaEvent = {
  id: string;
  roomId: string;
  agent: string;
  sessionId: string;
  runId: string;
  worktreeId: string | null;
  kind: string;
  title: string | null;
  text: string | null;
  payloadJson: string | null;
  level: string;
  ts: Date;
};

export function toEventDto(e: PrismaEvent): RuntimeEvent {
  return {
    id: e.id,
    roomId: e.roomId,
    agent: e.agent as AgentKind,
    sessionId: e.sessionId,
    runId: e.runId,
    worktreeId: e.worktreeId ?? undefined,
    kind: e.kind as RuntimeEventKind,
    title: e.title ?? undefined,
    text: e.text ?? undefined,
    payload: e.payloadJson ? JSON.parse(e.payloadJson) : undefined,
    level: e.level as EventLevel,
    ts: e.ts.toISOString(),
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
