import { create } from 'zustand';
import type {
  Room,
  AgentSession,
  ChatMessage,
  PinnedBriefItem,
  Approval,
  ServerWsEvent,
} from '@control-room/shared-types';

interface RoomState {
  room: Room | null;
  sessions: AgentSession[];
  messages: ChatMessage[];
  pinnedBrief: PinnedBriefItem[];
  pendingApprovals: Approval[];

  // Actions
  setSnapshot: (data: {
    room: Room | null;
    sessions: AgentSession[];
    recentMessages: ChatMessage[];
    pinnedBrief: PinnedBriefItem[];
    pendingApprovals: Approval[];
  }) => void;
  addMessage: (msg: ChatMessage) => void;
  updateMessage: (msg: ChatMessage) => void;
  updateSession: (session: Partial<AgentSession> & { id: string }) => void;
  addApproval: (approval: Approval) => void;
  resolveApproval: (id: string) => void;
  handleWsEvent: (event: ServerWsEvent) => void;
}

export const useRoomStore = create<RoomState>((set, get) => ({
  room: null,
  sessions: [],
  messages: [],
  pinnedBrief: [],
  pendingApprovals: [],

  setSnapshot: (data) =>
    set({
      room: data.room,
      sessions: data.sessions,
      messages: data.recentMessages,
      pinnedBrief: data.pinnedBrief,
      pendingApprovals: data.pendingApprovals,
    }),

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

  addApproval: (approval) =>
    set((state) => ({
      pendingApprovals: [
        ...state.pendingApprovals.filter((existing) => existing.id !== approval.id),
        approval,
      ],
    })),

  resolveApproval: (id) =>
    set((state) => ({
      pendingApprovals: state.pendingApprovals.filter((a) => a.id !== id),
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
      case 'run.status':
        // run.status is for tracking run state — do NOT write it into session status
        // Session status is handled by session.status events
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
      case 'approval.requested':
        state.addApproval(event.data);
        break;
      case 'approval.resolved':
        state.resolveApproval(event.data.id);
        break;
      case 'pin.updated':
        set({ pinnedBrief: event.data.items });
        break;
      case 'handoff.created':
        // Handoff-summary message is already broadcast via message.created
        // Store the bundle for potential UI display
        break;
    }
  },
}));
