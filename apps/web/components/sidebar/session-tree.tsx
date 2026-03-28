'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  const updateRoom = useRoomStore((s) => s.updateRoom);
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
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!room) return;
    setRooms((prev) => prev.map((item) => (item.id === room.id ? room : item)));
  }, [room]);

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

  const handleDeleteProject = async (project: Room) => {
    if (busyRoomId) return;

    const confirmed = window.confirm(
      `Delete project "${project.name}"?\n\nThis removes the Control Room record, sessions, messages, runs, and managed worktrees for this project.`,
    );
    if (!confirmed) return;

    setBusyRoomId(project.id);
    try {
      await api.rooms.delete(project.id);

      const remainingRooms = rooms.filter((item) => item.id !== project.id);
      setRooms(remainingRooms);
      setExpandedRooms((prev) => {
        const next = new Set(prev);
        next.delete(project.id);
        return next;
      });

      if (project.id === currentRoomId) {
        const fallbackRoom = remainingRooms[0];
        if (fallbackRoom) {
          router.push(`/rooms/${fallbackRoom.id}`);
        } else {
          setSelectedId(null);
          setConsoleSession(null);
          router.push('/');
        }
      }
    } catch (err) {
      console.error(`Failed to delete project ${project.id}:`, err);
      alert(err instanceof Error ? err.message : 'Failed to delete project');
    } finally {
      setBusyRoomId(null);
    }
  };

  const handleRenameProject = async (project: Room) => {
    if (busyRoomId) return;

    const nextName = window.prompt('Rename project', project.name)?.trim();
    if (!nextName || nextName === project.name) return;

    setBusyRoomId(project.id);
    try {
      const updated = await api.rooms.update(project.id, { name: nextName });
      setRooms((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      updateRoom(updated);
    } catch (err) {
      console.error(`Failed to rename project ${project.id}:`, err);
      alert(err instanceof Error ? err.message : 'Failed to rename project');
    } finally {
      setBusyRoomId(null);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!room || busySessionId) return;

    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;

    const confirmed = window.confirm(
      `Delete session "${session.name}"?\n\nThis removes its runs, messages, approvals, terminal state, and managed worktree.`,
    );
    if (!confirmed) return;

    setBusySessionId(sessionId);
    try {
      await api.sessions.delete(room.id, sessionId);
      handleRoomEvent({ type: 'session.deleted', data: { roomId: room.id, sessionId } });

      if (selectedId === sessionId) {
        const remainingSessions = sessions.filter((item) => item.id !== sessionId);
        const fallbackSession = remainingSessions[0] ?? null;
        setSelectedId(fallbackSession?.id ?? null);
        setConsoleSession(fallbackSession?.id ?? null);
      }
    } catch (err) {
      console.error(`Failed to delete session ${sessionId}:`, err);
      alert(err instanceof Error ? err.message : 'Failed to delete session');
    } finally {
      setBusySessionId(null);
    }
  };

  const handleRenameSession = async (sessionId: string) => {
    if (!room || busySessionId) return;

    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;

    const nextName = window.prompt('Rename session', session.name)?.trim();
    if (!nextName || nextName === session.name) return;

    setBusySessionId(sessionId);
    try {
      const updated = await api.sessions.update(room.id, sessionId, { name: nextName });
      handleRoomEvent({ type: 'session.updated', data: updated });
    } catch (err) {
      console.error(`Failed to rename session ${sessionId}:`, err);
      alert(err instanceof Error ? err.message : 'Failed to rename session');
    } finally {
      setBusySessionId(null);
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
            <div key={project.id} className="rounded-lg border border-gray-800/80 bg-gray-950/40 overflow-visible">
              <div
                className={`flex items-center gap-1 px-1.5 py-1 ${
                  isCurrent ? 'bg-gray-800/90 text-white' : 'text-gray-300'
                }`}
              >
                <button
                  onClick={() => toggleRoom(project.id)}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left transition-colors ${
                    isCurrent ? 'hover:bg-gray-700/60' : 'hover:bg-gray-900'
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
                <ActionMenu
                  title={`${project.name} actions`}
                  disabled={busyRoomId === project.id}
                  actions={[
                    { label: 'Rename', onSelect: () => handleRenameProject(project) },
                    { label: 'Delete', danger: true, onSelect: () => handleDeleteProject(project) },
                  ]}
                />
              </div>

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
                    onRename={handleRenameSession}
                    onDelete={handleDeleteSession}
                    creating={creatingSessionFor === 'claude'}
                    busySessionId={busySessionId}
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
                    onRename={handleRenameSession}
                    onDelete={handleDeleteSession}
                    creating={creatingSessionFor === 'codex'}
                    busySessionId={busySessionId}
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
  onRename,
  onDelete,
  creating,
  busySessionId,
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
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  creating: boolean;
  busySessionId: string | null;
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
              <div
                key={s.id}
                className={`flex items-start gap-1 rounded ${
                  selectedId === s.id ? 'bg-gray-700 text-white' : 'text-gray-300'
                }`}
              >
                <button
                  onClick={() => onSelect(s.id)}
                  className={`flex min-w-0 flex-1 items-start gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
                    selectedId === s.id
                      ? 'hover:bg-gray-600/60'
                      : 'hover:bg-gray-800'
                  }`}
                >
                  <span className="text-gray-600">└</span>
                  <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${STATUS_COLORS[s.status] ?? 'bg-gray-400'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{s.name}</span>
                      <span className="flex-shrink-0 text-[10px] uppercase text-gray-500">{s.status}</span>
                    </div>
                    <div className="truncate text-[10px] text-gray-500">
                      {formatSessionMeta(s.metadata, s.mode)}
                    </div>
                    <div className="text-[10px] text-gray-600">
                      {new Date(s.updatedAt).toLocaleTimeString('en-US', { hour12: false })}
                    </div>
                  </div>
                </button>
                <ActionMenu
                  title={`${s.name} actions`}
                  disabled={busySessionId === s.id}
                  actions={[
                    { label: 'Rename', onSelect: () => onRename(s.id) },
                    { label: 'Delete', danger: true, onSelect: () => onDelete(s.id) },
                  ]}
                />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ActionMenu({
  title,
  actions,
  disabled = false,
}: {
  title: string;
  actions: Array<{ label: string; onSelect: () => void; danger?: boolean }>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        onClick={(event) => {
          event.stopPropagation();
          if (!disabled) setOpen((prev) => !prev);
        }}
        disabled={disabled}
        title={title}
        className="rounded px-2 py-1 text-sm font-semibold text-gray-500 transition-colors hover:bg-gray-900 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        …
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 min-w-28 rounded-lg border border-gray-800 bg-gray-950/98 p-1 shadow-2xl">
          {actions.map((action) => (
            <button
              key={action.label}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                action.onSelect();
              }}
              className={`block w-full rounded px-3 py-1.5 text-left text-xs transition-colors ${
                action.danger
                  ? 'text-red-400 hover:bg-red-950/60 hover:text-red-300'
                  : 'text-gray-200 hover:bg-gray-900'
              }`}
            >
              {action.label}
            </button>
          ))}
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
