import type {
  Room,
  RoomSnapshot,
  AgentSession,
  ChatMessage,
  CreateRoomRequest,
  UpdateRoomRequest,
  CreateSessionRequest,
  UpdateSessionRequest,
  SendMessageRequest,
  CreatePinRequest,
  UpdatePinRequest,
  PinnedBriefItem,
  PaginatedResponse,
} from '@control-room/shared-types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3002';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

export const api = {
  rooms: {
    list: () => request<Room[]>('/api/rooms'),
    get: (id: string) => request<RoomSnapshot>(`/api/rooms/${id}`),
    create: (data: CreateRoomRequest) =>
      request<Room>('/api/rooms', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: UpdateRoomRequest) =>
      request<Room>(`/api/rooms/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => request<{ ok: boolean }>(`/api/rooms/${id}`, { method: 'DELETE' }),
  },
  sessions: {
    list: (roomId: string) => request<AgentSession[]>(`/api/rooms/${roomId}/sessions`),
    create: (roomId: string, data: CreateSessionRequest) =>
      request<AgentSession>(`/api/rooms/${roomId}/sessions`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (roomId: string, sessionId: string, data: UpdateSessionRequest) =>
      request<AgentSession>(`/api/rooms/${roomId}/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (roomId: string, sessionId: string) =>
      request<{ ok: boolean }>(`/api/rooms/${roomId}/sessions/${sessionId}`, {
        method: 'DELETE',
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
};
