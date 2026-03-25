import { create } from 'zustand';
import type { RuntimeEvent } from '@control-room/shared-types';

export type EventFilter = 'all' | 'commands' | 'errors' | 'approvals' | 'tools' | 'raw';

interface ConsoleState {
  events: RuntimeEvent[];
  activeFilter: EventFilter;
  currentSessionId: string | null;
  currentRunId: string | null;

  appendEvent: (event: RuntimeEvent) => void;
  setFilter: (filter: EventFilter) => void;
  clearEvents: () => void;
  setCurrentSessionId: (sessionId: string | null) => void;
  setCurrentRunId: (runId: string | null) => void;
  loadEvents: (events: RuntimeEvent[]) => void;
}

export const useConsoleStore = create<ConsoleState>((set) => ({
  events: [],
  activeFilter: 'all',
  currentSessionId: null,
  currentRunId: null,

  appendEvent: (event) =>
    set((state) => ({ events: [...state.events, event] })),

  setFilter: (filter) => set({ activeFilter: filter }),

  clearEvents: () => set({ events: [] }),

  setCurrentSessionId: (sessionId) => set({ currentSessionId: sessionId, currentRunId: null, events: [] }),

  setCurrentRunId: (runId) => set({ currentRunId: runId }),

  loadEvents: (events) => set({ events }),
}));

export function filterEvents(events: RuntimeEvent[], filter: EventFilter): RuntimeEvent[] {
  if (filter === 'all') return events;
  if (filter === 'raw') return events;

  const kindMap: Record<string, string[]> = {
    commands: ['command.stdout', 'command.stderr'],
    errors: ['run.failed', 'tool.failed', 'command.stderr'],
    approvals: ['approval.requested', 'approval.resolved'],
    tools: ['tool.started', 'tool.completed', 'tool.failed'],
  };

  const kinds = kindMap[filter] ?? [];
  return events.filter((e) => kinds.includes(e.kind));
}
