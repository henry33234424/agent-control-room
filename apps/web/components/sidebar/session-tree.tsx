'use client';

import { useRoomStore } from '@/stores/room-store';
import { useUIStore } from '@/stores/ui-store';
import { useConsoleStore } from '@/stores/console-store';
import { api } from '@/lib/api-client';
import type { AgentKind } from '@control-room/shared-types';

const STATUS_COLORS: Record<string, string> = {
  idle: 'bg-gray-400',
  running: 'bg-green-500 animate-pulse',
  waitingApproval: 'bg-yellow-500 animate-pulse',
  failed: 'bg-red-500',
  archived: 'bg-gray-300',
};

export function SessionTree() {
  const room = useRoomStore((s) => s.room);
  const sessions = useRoomStore((s) => s.sessions);
  const selectedId = useUIStore((s) => s.selectedSessionId);
  const setSelectedId = useUIStore((s) => s.setSelectedSessionId);
  const setConsoleSession = useConsoleStore((s) => s.setCurrentSessionId);
  const setCurrentRunId = useConsoleStore((s) => s.setCurrentRunId);
  const loadEvents = useConsoleStore((s) => s.loadEvents);

  const handleSelect = async (id: string) => {
    setSelectedId(id);
    setConsoleSession(id);

    // Load latest run's events for this session
    if (room) {
      try {
        const runs = await api.runs.list(room.id, id);
        if (runs.length > 0) {
          const latestRun = runs[0]; // sorted desc by createdAt
          setCurrentRunId(latestRun.id);
          const result = await api.runs.events(room.id, latestRun.id);
          loadEvents(result.items);
        } else {
          setCurrentRunId(null);
          loadEvents([]);
        }
      } catch (err) {
        console.error('Failed to load session events:', err);
        setCurrentRunId(null);
        loadEvents([]);
      }
    }
  };

  const claudeSessions = sessions.filter((s) => s.agent === 'claude');
  const codexSessions = sessions.filter((s) => s.agent === 'codex');

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-700">
        <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider">Sessions</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        <AgentGroup
          agent="claude"
          label="Claude"
          sessions={claudeSessions}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
        <AgentGroup
          agent="codex"
          label="Codex"
          sessions={codexSessions}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      </div>
    </div>
  );
}

function AgentGroup({
  agent,
  label,
  sessions,
  selectedId,
  onSelect,
}: {
  agent: AgentKind;
  label: string;
  sessions: Array<{
    id: string;
    name: string;
    status: string;
    updatedAt: string;
    mode: string;
    metadata?: Record<string, unknown>;
  }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <div className="text-xs font-semibold text-gray-400 uppercase px-2 mb-1">{label}</div>
      {sessions.length === 0 ? (
        <div className="text-xs text-gray-500 px-2">No sessions</div>
      ) : (
        sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${
              selectedId === s.id
                ? 'bg-gray-700 text-white'
                : 'text-gray-300 hover:bg-gray-800'
            }`}
          >
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLORS[s.status] ?? 'bg-gray-400'}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{s.name}</span>
                <span className="text-[10px] uppercase text-gray-500 flex-shrink-0">{s.status}</span>
              </div>
              <div className="text-[10px] text-gray-500 truncate">
                {formatSessionMeta(s.metadata, s.mode)}
              </div>
              <div className="text-[10px] text-gray-600">
                {new Date(s.updatedAt).toLocaleTimeString('en-US', { hour12: false })}
              </div>
            </div>
          </button>
        ))
      )}
    </div>
  );
}

function formatSessionMeta(
  metadata: Record<string, unknown> | undefined,
  mode: string,
): string {
  const branch = typeof metadata?.branch === 'string' ? metadata.branch : undefined;
  const worktreePath = typeof metadata?.worktreePath === 'string' ? metadata.worktreePath : undefined;
  const worktreeName = worktreePath ? worktreePath.split('/').filter(Boolean).pop() : undefined;

  if (branch && worktreeName) return `${branch} | ${worktreeName}`;
  if (branch) return branch;
  if (worktreeName) return worktreeName;
  return mode === 'readOnly' ? 'repo root' : 'worktree pending';
}
