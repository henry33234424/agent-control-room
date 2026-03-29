import { create } from 'zustand';
import type {
  Room,
  AgentSession,
  ChatMessage,
  PinnedBriefItem,
  ServerWsEvent,
} from '@control-room/shared-types';

interface RoomState {
  room: Room | null;
  sessions: AgentSession[];
  messages: ChatMessage[];
  pinnedBrief: PinnedBriefItem[];

  // Actions
  setSnapshot: (data: {
    room: Room | null;
    sessions: AgentSession[];
    recentMessages: ChatMessage[];
    pinnedBrief: PinnedBriefItem[];
  }) => void;
  updateRoom: (room: Partial<Room> & { id: string }) => void;
  addMessage: (msg: ChatMessage) => void;
  updateMessage: (msg: ChatMessage) => void;
  updateSession: (session: Partial<AgentSession> & { id: string }) => void;
  removeSession: (sessionId: string) => void;
  handleWsEvent: (event: ServerWsEvent) => void;
}

export const useRoomStore = create<RoomState>((set, get) => ({
  room: null,
  sessions: [],
  messages: [],
  pinnedBrief: [],

  setSnapshot: (data) =>
    set({
      room: data.room,
      sessions: data.sessions,
      messages: data.recentMessages,
      pinnedBrief: data.pinnedBrief,
    }),

  updateRoom: (partial) =>
    set((state) => ({
      room: state.room && state.room.id === partial.id
        ? { ...state.room, ...partial }
        : state.room,
    })),

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  updateMessage: (msg) =>
    set((state) => ({
      messages: state.messages.map((existing) => (existing.id === msg.id ? msg : existing)),
    })),

  updateSession: (partial) =>
    set((state) => ({
      sessions: state.sessions
        .map((s) =>
          s.id === partial.id ? { ...s, ...partial } : s,
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    })),

  removeSession: (sessionId) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== sessionId),
      messages: state.messages.filter((msg) => msg.sessionId !== sessionId),
    })),

  handleWsEvent: (event) => {
    const state = get();
    switch (event.type) {
      case 'room.snapshot':
        state.setSnapshot(event.data);
        break;
      case 'message.created':
        state.addMessage(event.data);
        break;
      case 'message.updated':
        state.updateMessage(event.data);
        break;
      case 'session.status':
        state.updateSession({ id: event.data.sessionId, status: event.data.status });
        break;
      case 'session.updated': {
        // If session exists, update; if new, add it
        const exists = state.sessions.some((s) => s.id === event.data.id);
        if (exists) {
          state.updateSession(event.data);
        } else {
          set((prev) => ({
            sessions: [...prev.sessions, event.data].sort(
              (a, b) => b.updatedAt.localeCompare(a.updatedAt),
            ),
          }));
        }
        break;
      }
      case 'session.deleted':
        state.removeSession(event.data.sessionId);
        break;
      case 'pin.updated':
        set({ pinnedBrief: event.data.items });
        break;
    }
  },
}));
