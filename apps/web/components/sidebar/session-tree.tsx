'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRoomStore } from '@/stores/room-store';
import { useUIStore } from '@/stores/ui-store';
import { useConsoleStore } from '@/stores/console-store';
import { api } from '@/lib/api-client';
import type { AgentKind, Room } from '@control-room/shared-types';

const STATUS_COLORS: Record<string, string> = {
  idle: 'bg-gray-400',
  running: 'bg-green-500 animate-pulse',
  waitingApproval: 'bg-yellow-500 animate-pulse',
  failed: 'bg-red-500',
  archived: 'bg-gray-300',
};

export function SessionTree() {
  const router = useRouter();
  const room = useRoomStore((s) => s.room);
  const handleRoomEvent = useRoomStore((s) => s.handleWsEvent);
  const sessions = useRoomStore((s) => s.sessions);
  const selectedId = useUIStore((s) => s.selectedSessionId);
  const setSelectedId = useUIStore((s) => s.setSelectedSessionId);
  const setConsoleSession = useConsoleStore((s) => s.setCurrentSessionId);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(new Set());
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set(['claude', 'codex']));
  const [addingProject, setAddingProject] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingSessionFor, setCreatingSessionFor] = useState<AgentKind | null>(null);

  useEffect(() => {
    api.rooms.list().then(setRooms).catch((err) => {
      console.error('Failed to load projects:', err);
    });
  }, []);

  useEffect(() => {
    if (!room?.id) return;
    setExpandedRooms((prev) => {
      if (prev.has(room.id)) return prev;
      const next = new Set(prev);
      next.add(room.id);
      return next;
    });
  }, [room?.id]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setConsoleSession(id);
  };

  const currentRoomId = room?.id ?? null;
  const currentRoomSessions = useMemo(
    () => ({
      claude: sessions.filter((s) => s.agent === 'claude'),
      codex: sessions.filter((s) => s.agent === 'codex'),
    }),
    [sessions],
  );

  const toggleRoom = (roomId: string) => {
    if (roomId !== currentRoomId) {
      router.push(`/rooms/${roomId}`);
      return;
    }

    setExpandedRooms((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  };

  const toggleAgent = (agent: AgentKind) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  };

  const handleCreateProject = async () => {
    if (!projectName.trim() || !projectPath.trim() || creatingProject) return;

    setCreatingProject(true);
    try {
      const created = await api.rooms.create({
        name: projectName.trim(),
        repoPath: projectPath.trim(),
      });
      setRooms((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setProjectName('');
      setProjectPath('');
      setAddingProject(false);
      router.push(`/rooms/${created.id}`);
    } catch (err) {
      console.error('Failed to create project:', err);
      alert(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setCreatingProject(false);
    }
  };

  const handleCreateSession = async (agent: AgentKind) => {
    if (!room || creatingSessionFor) return;

    setCreatingSessionFor(agent);
    try {
      const session = await api.sessions.create(room.id, {
        agent,
        name: `${agent}-${Date.now()}`,
      });
      handleRoomEvent({ type: 'session.updated', data: session });
      setSelectedId(session.id);
      setConsoleSession(session.id);
      setExpandedAgents((prev) => {
        const next = new Set(prev);
        next.add(agent);
        return next;
      });
    } catch (err) {
      console.error(`Failed to create ${agent} session:`, err);
      alert(err instanceof Error ? err.message : `Failed to create ${agent} session`);
    } finally {
      setCreatingSessionFor(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-700">
        <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider">Projects</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {rooms.map((project) => {
          const isCurrent = project.id === currentRoomId;
          const isExpanded = expandedRooms.has(project.id);

          return (
            <div key={project.id} className="rounded-lg border border-gray-800/80 bg-gray-950/40 overflow-hidden">
              <button
                onClick={() => toggleRoom(project.id)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 text-left transition-colors ${
                  isCurrent ? 'bg-gray-800/90 text-white' : 'text-gray-300 hover:bg-gray-900'
                }`}
              >
                <span className="text-[11px] text-gray-500">{isExpanded && isCurrent ? 'v' : '>'}</span>
                <span className="text-[10px] uppercase tracking-wide text-gray-500">dir</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{project.name}</div>
                  <div className="truncate text-[10px] text-gray-500">
                    {project.repoPath.split('/').filter(Boolean).pop()}
                  </div>
                </div>
              </button>

              {isCurrent && isExpanded && (
                <div className="border-t border-gray-800 bg-gray-950/60">
                  <AgentGroup
                    agent="claude"
                    label="Claude"
                    sessions={currentRoomSessions.claude}
                    selectedId={selectedId}
                    expanded={expandedAgents.has('claude')}
                    onToggle={() => toggleAgent('claude')}
                    onSelect={handleSelect}
                    onCreate={() => handleCreateSession('claude')}
                    creating={creatingSessionFor === 'claude'}
                  />
                  <AgentGroup
                    agent="codex"
                    label="Codex"
                    sessions={currentRoomSessions.codex}
                    selectedId={selectedId}
                    expanded={expandedAgents.has('codex')}
                    onToggle={() => toggleAgent('codex')}
                    onSelect={handleSelect}
                    onCreate={() => handleCreateSession('codex')}
                    creating={creatingSessionFor === 'codex'}
                  />
                </div>
              )}
            </div>
          );
        })}

        <div className="mt-3 rounded-lg border border-dashed border-gray-700 bg-gray-950/30 p-2">
          <button
            onClick={() => setAddingProject((prev) => !prev)}
            className="w-full flex items-center justify-between text-left text-xs font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-200 transition-colors"
          >
            <span>Add Project</span>
            <span className="text-gray-600">{addingProject ? 'v' : '+'}</span>
          </button>

          {addingProject && (
            <div className="mt-2 space-y-2">
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Project name"
                className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <input
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                placeholder="Absolute repo path"
                className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleCreateProject}
                disabled={creatingProject || !projectName.trim() || !projectPath.trim()}
                className="w-full rounded bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                {creatingProject ? 'Adding...' : 'Add Project'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentGroup({
  agent,
  label,
  sessions,
  selectedId,
  expanded,
  onToggle,
  onSelect,
  onCreate,
  creating,
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
  expanded: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  creating: boolean;
}) {
  return (
    <div className="px-1 py-1">
      <div className="flex items-center gap-1">
        <button
          onClick={onToggle}
          className="flex-1 flex items-center gap-2 px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-400 hover:bg-gray-900 transition-colors rounded"
        >
          <span className="text-[10px] text-gray-600">{expanded ? 'v' : '>'}</span>
          <span className="text-[10px] uppercase tracking-wide text-gray-600">dir</span>
          <span>{label}</span>
          <span className="ml-auto text-[10px] text-gray-600">{sessions.length}</span>
        </button>
        <button
          onClick={onCreate}
          disabled={creating}
          title={`New ${label} session`}
          className="px-2 py-1.5 text-xs font-semibold text-gray-400 hover:bg-gray-900 hover:text-gray-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {creating ? '...' : '+'}
        </button>
      </div>

      {expanded && (
        <div className="mt-1 space-y-1 border-l border-gray-800 ml-3 pl-2">
          {sessions.length === 0 ? (
            <div className="text-xs text-gray-500 px-2 py-1">No sessions</div>
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
                <span className="text-gray-600">└</span>
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
