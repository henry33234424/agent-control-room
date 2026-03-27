import type {
  Room,
  RoomSnapshot,
  AgentSession,
  ChatMessage,
  RuntimeEvent,
  CreateRoomRequest,
  CreateSessionRequest,
  SendMessageRequest,
  CreateHandoffRequest,
  CreatePinRequest,
  UpdatePinRequest,
  PinnedBriefItem,
  HandoffBundle,
  PaginatedResponse,
  DecideApprovalRequest,
  CreateReviewRequest,
} from '@control-room/shared-types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3002';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

interface RunSummary {
  id: string;
  roomId: string;
  agentSessionId: string;
  triggerType: string;
  status: string;
  resultSummary?: string;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
}

export const api = {
  rooms: {
    list: () => request<Room[]>('/api/rooms'),
    get: (id: string) => request<RoomSnapshot>(`/api/rooms/${id}`),
    create: (data: CreateRoomRequest) =>
      request<Room>('/api/rooms', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: string) => request<{ ok: boolean }>(`/api/rooms/${id}`, { method: 'DELETE' }),
  },
  sessions: {
    list: (roomId: string) => request<AgentSession[]>(`/api/rooms/${roomId}/sessions`),
    create: (roomId: string, data: CreateSessionRequest) =>
      request<AgentSession>(`/api/rooms/${roomId}/sessions`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  messages: {
    list: (roomId: string, limit = 50, cursor?: string) =>
      request<PaginatedResponse<ChatMessage>>(
        `/api/rooms/${roomId}/messages?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
      ),
    send: (roomId: string, data: SendMessageRequest) =>
      request<ChatMessage>(`/api/rooms/${roomId}/messages`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  excerpts: {
    create: (
      roomId: string,
      data: { content: string; sourceAgent?: string; sourceSessionId?: string },
    ) =>
      request<ChatMessage>(`/api/rooms/${roomId}/excerpts`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  runs: {
    list: (roomId: string, sessionId?: string) =>
      request<RunSummary[]>(
        `/api/rooms/${roomId}/runs${sessionId ? `?sessionId=${sessionId}` : ''}`,
      ),
    events: (roomId: string, runId: string, limit = 200) =>
      request<PaginatedResponse<RuntimeEvent>>(
        `/api/rooms/${roomId}/runs/${runId}/events?limit=${limit}`,
      ),
  },
  approvals: {
    decide: (approvalId: string, data: DecideApprovalRequest) =>
      request<{ ok: boolean }>(`/api/approvals/${approvalId}/decide`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  handoffs: {
    create: (roomId: string, data: CreateHandoffRequest) =>
      request<HandoffBundle>(`/api/rooms/${roomId}/handoffs`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  pins: {
    list: (roomId: string) => request<PinnedBriefItem[]>(`/api/rooms/${roomId}/pins`),
    create: (roomId: string, data: CreatePinRequest) =>
      request<PinnedBriefItem>(`/api/rooms/${roomId}/pins`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (roomId: string, pinId: string, data: UpdatePinRequest) =>
      request<PinnedBriefItem>(`/api/rooms/${roomId}/pins/${pinId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (roomId: string, pinId: string) =>
      request<void>(`/api/rooms/${roomId}/pins/${pinId}`, { method: 'DELETE' }),
  },
  reviews: {
    create: (roomId: string, data: CreateReviewRequest) =>
      request<{ runId: string; status: string }>(`/api/rooms/${roomId}/reviews`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
};
