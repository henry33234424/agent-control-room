'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { wsClient } from '@/lib/ws-client';
import { useRoomStore } from '@/stores/room-store';
import { useUIStore } from '@/stores/ui-store';
import { api } from '@/lib/api-client';

let Terminal: any = null;
let FitAddon: any = null;

const PANEL_RESIZE_START = 'control-room:panel-resize-start';
const PANEL_RESIZE_END = 'control-room:panel-resize-end';

interface TermInstance {
  term: any;
  fitAddon: any;
  container: HTMLDivElement;
  sessionId: string;
  isNew: boolean;
  lastReportedCols?: number;
  lastReportedRows?: number;
  snapshotTimer: ReturnType<typeof setTimeout> | null;
  restoredFromSnapshot: boolean;
}

interface TerminalSnapshot {
  cols?: number;
  rows?: number;
  lines: string[];
  capturedAt: number;
}

function toPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

export function TerminalPanel() {
  const room = useRoomStore((s) => s.room);
  const sessions = useRoomStore((s) => s.sessions);
  const selectedSessionId = useUIStore((s) => s.selectedSessionId);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const termsRef = useRef<Map<string, TermInstance>>(new Map());
  const activeSessionRef = useRef<string | null>(null);
  const panelDraggingRef = useRef(false);
  const resizeRafRef = useRef<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const getSnapshotKey = useCallback((sessionId: string) => {
    if (!room?.id) return null;
    return `control-room:terminal-snapshot:${room.id}:${sessionId}`;
  }, [room?.id]);

  const readSnapshot = useCallback((sessionId: string): TerminalSnapshot | null => {
    const key = getSnapshotKey(sessionId);
    if (!key || typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as Partial<TerminalSnapshot> | null;
      if (!parsed || !Array.isArray(parsed.lines)) {
        window.localStorage.removeItem(key);
        return null;
      }

      const lines = parsed.lines.map((line) => (typeof line === 'string' ? line : ''));
      if (lines.length === 0) {
        window.localStorage.removeItem(key);
        return null;
      }

      return {
        cols: toPositiveInteger(parsed.cols),
        rows: toPositiveInteger(parsed.rows),
        lines,
        capturedAt: typeof parsed.capturedAt === 'number' ? parsed.capturedAt : Date.now(),
      };
    } catch {
      window.localStorage.removeItem(key);
      return null;
    }
  }, [getSnapshotKey]);

  const clearSnapshot = useCallback((sessionId: string) => {
    const key = getSnapshotKey(sessionId);
    if (!key || typeof window === 'undefined') return;
    window.localStorage.removeItem(key);
  }, [getSnapshotKey]);

  // Load xterm dynamically
  useEffect(() => {
    Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
    ]).then(([xtermMod, fitMod]) => {
      Terminal = xtermMod.Terminal;
      FitAddon = fitMod.FitAddon;
      setLoaded(true);
    });
  }, []);

  const restoreSnapshot = useCallback((inst: Pick<TermInstance, 'term'>, snapshot: TerminalSnapshot | null) => {
    if (!snapshot || snapshot.lines.length === 0) return false;

    inst.term.reset();

    const content = snapshot.lines.join('\r\n');
    if (content) {
      inst.term.write(content);
    }
    return true;
  }, []);

  // Create or get a Terminal instance for a session
  const getOrCreateTerm = useCallback((sessionId: string): TermInstance | null => {
    if (!loaded || !wrapperRef.current) return null;

    const existing = termsRef.current.get(sessionId);
    if (existing) return existing;

    // Create container div
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.inset = '0';
    container.style.display = 'none'; // hidden by default
    container.style.padding = '4px';
    wrapperRef.current.appendChild(container);

    const snapshot = readSnapshot(sessionId);

    // Create terminal
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace",
      ...(snapshot?.cols !== undefined ? { cols: snapshot.cols } : {}),
      ...(snapshot?.rows !== undefined ? { rows: snapshot.rows } : {}),
      theme: {
        background: '#0a0e14',
        foreground: '#e6e6e6',
        cursor: '#f8f8f0',
        selectionBackground: '#3b4261',
      },
      scrollback: 10000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    const restoredFromSnapshot = restoreSnapshot({ term }, snapshot);

    // Forward input to PTY
    term.onData((data: string) => {
      wsClient.send({ type: 'pty.input', sessionId, data } as any);
    });

    // Detect text selection for capture toolbar
    term.onSelectionChange(() => {
      const sel = term.getSelection();
      setSelectedText(sel && sel.trim() ? sel.trim() : null);
    });

    const inst: TermInstance = {
      term,
      fitAddon,
      container,
      sessionId,
      isNew: true,
      snapshotTimer: null,
      restoredFromSnapshot,
    };
    termsRef.current.set(sessionId, inst);

    return inst;
  }, [loaded, readSnapshot, restoreSnapshot]);

  const persistSnapshot = useCallback((sessionId: string) => {
    const inst = termsRef.current.get(sessionId);
    const key = getSnapshotKey(sessionId);
    if (!inst || !key || typeof window === 'undefined') return;

    const buffer = inst.term.buffer.active;
    const start = buffer.viewportY;
    const lines: string[] = [];
    for (let i = 0; i < inst.term.rows; i += 1) {
      const line = buffer.getLine(start + i);
      lines.push(line ? line.translateToString(true) : '');
    }

    const snapshot: TerminalSnapshot = {
      cols: inst.term.cols,
      rows: inst.term.rows,
      lines,
      capturedAt: Date.now(),
    };
    window.localStorage.setItem(key, JSON.stringify(snapshot));
  }, [getSnapshotKey]);

  const scheduleSnapshotPersist = useCallback((sessionId: string) => {
    const inst = termsRef.current.get(sessionId);
    if (!inst) return;
    if (inst.snapshotTimer) clearTimeout(inst.snapshotTimer);
    inst.snapshotTimer = setTimeout(() => {
      inst.snapshotTimer = null;
      persistSnapshot(sessionId);
    }, 120);
  }, [persistSnapshot]);

  const syncTerminalSize = useCallback((
    sessionId: string,
    options?: { notifyPty?: boolean; force?: boolean },
  ) => {
    const inst = termsRef.current.get(sessionId);
    if (!inst) return;

    inst.fitAddon.fit();

    const cols = inst.term.cols;
    const rows = inst.term.rows;
    if (!options?.notifyPty || cols <= 0 || rows <= 0) {
      return;
    }

    if (!options.force && inst.lastReportedCols === cols && inst.lastReportedRows === rows) {
      return;
    }

    inst.lastReportedCols = cols;
    inst.lastReportedRows = rows;
    scheduleSnapshotPersist(sessionId);

    wsClient.send({
      type: 'pty.resize',
      sessionId,
      cols,
      rows,
    } as any);
  }, [scheduleSnapshotPersist]);

  // Switch visible terminal when selected session changes
  useEffect(() => {
    if (!loaded || !selectedSessionId) return;

    const session = sessions.find((s) => s.id === selectedSessionId);
    if (!session || !room) return;

    // Hide all terminals
    for (const inst of termsRef.current.values()) {
      inst.container.style.display = 'none';
    }

    // Show selected terminal
    const inst = getOrCreateTerm(selectedSessionId);
    if (!inst) return;
    inst.container.style.display = 'block';

    // Only send pty.start for NEW terminal instances (first time seeing this session).
    // Switching back to an existing terminal just shows it — no pty.start, no buffer replay.
    activeSessionRef.current = selectedSessionId;
    syncTerminalSize(selectedSessionId, { notifyPty: false, force: true });

    if (inst.isNew) {
      inst.isNew = false;

      const workingDirectory =
        typeof session.metadata?.worktreePath === 'string'
          ? session.metadata.worktreePath
          : room.repoPath;

      wsClient.send({
        type: 'pty.start',
        sessionId: selectedSessionId,
        roomId: room.id,
        agent: session.agent,
        cwd: workingDirectory,
        skipReplay: inst.restoredFromSnapshot,
        cols: inst.term.cols,
        rows: inst.term.rows,
      } as any);
      inst.lastReportedCols = inst.term.cols;
      inst.lastReportedRows = inst.term.rows;
    } else {
      // Re-attach WS to existing PTY (without buffer replay) so input works
      wsClient.send({ type: 'pty.attach', sessionId: selectedSessionId } as any);
      syncTerminalSize(selectedSessionId, { notifyPty: true });
    }
  }, [loaded, selectedSessionId, sessions, room, getOrCreateTerm, syncTerminalSize]);

  // Listen for PTY output — route to correct terminal
  useEffect(() => {
    if (!loaded) return;

    const unsub = wsClient.onEvent((event: any) => {
      if (event.type === 'pty.output') {
        const inst = termsRef.current.get(event.sessionId);
        if (inst) {
          inst.term.write(event.data);
          inst.restoredFromSnapshot = false;
          scheduleSnapshotPersist(event.sessionId);
        }
      }
      if (event.type === 'pty.started') {
        const inst = termsRef.current.get(event.sessionId);
        if (!inst) return;

        if (event.restored === false) {
          clearSnapshot(event.sessionId);
          if (inst.restoredFromSnapshot) {
            inst.term.reset();
            inst.fitAddon.fit();
          }
          inst.restoredFromSnapshot = false;
        }
      }
      if (event.type === 'pty.exit') {
        const inst = termsRef.current.get(event.sessionId);
        if (inst) {
          // Only show exit message if there was no error (normal exit)
          // Error exits (e.g. attach to dead PTY) should auto-restart
          if (event.error && event.sessionId === activeSessionRef.current) {
            // PTY not running (e.g. server restarted). Auto-restart it.
            inst.isNew = true;
            inst.restoredFromSnapshot = false;
            const session = useRoomStore.getState().sessions.find((s: any) => s.id === event.sessionId);
            const currentRoom = useRoomStore.getState().room;
            if (session && currentRoom) {
              const cwd = typeof session.metadata?.worktreePath === 'string'
                ? session.metadata.worktreePath
                : currentRoom.repoPath;
              inst.term.writeln('\x1b[90m[Reconnecting...]\x1b[0m');
              wsClient.send({
                type: 'pty.start',
                sessionId: event.sessionId,
                roomId: currentRoom.id,
                agent: session.agent,
                cwd,
                cols: inst.term.cols,
                rows: inst.term.rows,
              } as any);
              inst.isNew = false;
            }
          } else if (!event.error) {
            inst.term.writeln('\r\n\x1b[33m[Process exited]\x1b[0m');
            inst.isNew = true;
          }
          scheduleSnapshotPersist(event.sessionId);
        }
      }
    });

    return unsub;
  }, [loaded, clearSnapshot, scheduleSnapshotPersist]);

  useEffect(() => {
    if (!loaded) return;

    return wsClient.onOpen(() => {
      const activeId = activeSessionRef.current;
      if (!activeId) return;
      wsClient.send({ type: 'pty.attach', sessionId: activeId } as any);
      syncTerminalSize(activeId, { notifyPty: true });
    });
  }, [loaded, syncTerminalSize]);

  useEffect(() => {
    const handleResizeStart = () => {
      panelDraggingRef.current = true;
    };
    const handleResizeEnd = () => {
      panelDraggingRef.current = false;
      const activeId = activeSessionRef.current;
      if (!activeId) return;
      syncTerminalSize(activeId, { notifyPty: true, force: true });
    };

    window.addEventListener(PANEL_RESIZE_START, handleResizeStart);
    window.addEventListener(PANEL_RESIZE_END, handleResizeEnd);

    return () => {
      window.removeEventListener(PANEL_RESIZE_START, handleResizeStart);
      window.removeEventListener(PANEL_RESIZE_END, handleResizeEnd);
    };
  }, [syncTerminalSize]);

  // Resize observer — fit locally on the next frame so the canvas does not
  // appear stretched during sidebar drag. Only commit the PTY resize when
  // we're not in an active panel drag; the final authoritative resize is sent
  // once the drag ends.
  useEffect(() => {
    if (!loaded || !wrapperRef.current) return;

    const observer = new ResizeObserver(() => {
      if (resizeRafRef.current !== null) return;
      resizeRafRef.current = window.requestAnimationFrame(() => {
        resizeRafRef.current = null;
        const activeId = activeSessionRef.current;
        if (!activeId) return;
        syncTerminalSize(activeId, { notifyPty: !panelDraggingRef.current });
      });
    });
    observer.observe(wrapperRef.current);

    return () => {
      observer.disconnect();
      if (resizeRafRef.current !== null) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
    };
  }, [loaded, syncTerminalSize]);

  // Re-fit terminal when browser tab becomes visible again
  useEffect(() => {
    if (!loaded) return;

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      // Re-fit all visible terminals after tab switch
      const activeId = activeSessionRef.current;
      if (!activeId) return;
      // Small delay to let the browser finish layout
      setTimeout(() => {
        syncTerminalSize(activeId, { notifyPty: true, force: true });
      }, 100);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [loaded, syncTerminalSize]);

  // Cleanup on unmount
  useEffect(() => {
    const persistAllSnapshots = () => {
      for (const inst of termsRef.current.values()) {
        if (inst.snapshotTimer) {
          clearTimeout(inst.snapshotTimer);
          inst.snapshotTimer = null;
        }
        persistSnapshot(inst.sessionId);
      }
    };

    window.addEventListener('pagehide', persistAllSnapshots);

    return () => {
      window.removeEventListener('pagehide', persistAllSnapshots);
      if (resizeRafRef.current !== null) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      for (const inst of termsRef.current.values()) {
        if (inst.snapshotTimer) {
          clearTimeout(inst.snapshotTimer);
          inst.snapshotTimer = null;
        }
        persistSnapshot(inst.sessionId);
        inst.term.dispose();
        inst.container.remove();
      }
      termsRef.current.clear();
    };
  }, [persistSnapshot]);

  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const activeSession = sessions.find((s) => s.id === activeSessionRef.current);

  const handleCapture = async (target: 'context' | 'brief' | 'claude' | 'codex') => {
    if (!selectedText || !room || capturing) return;
    setCapturing(true);
    try {
      if (target === 'context') {
        // Create excerpt via dedicated API (no agent dispatch)
        const activeAgent = activeSession?.agent;
        await api.excerpts.create(room.id, {
          content: selectedText,
          sourceAgent: activeAgent,
          sourceSessionId: activeSessionRef.current ?? undefined,
        });
      } else if (target === 'brief') {
        await api.pins.create(room.id, { section: 'decisions', content: selectedText });
      } else {
        // Send to another agent
        await api.messages.send(room.id, {
          content: `@${target} ${selectedText}`,
          mentionTarget: target,
        });
      }
      setSelectedText(null);
      // Clear selection in terminal
      const inst = termsRef.current.get(activeSessionRef.current ?? '');
      if (inst) inst.term.clearSelection();
    } catch (err) {
      console.error('Capture failed:', err);
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="relative h-full bg-[#0a0e14]">
      <div ref={wrapperRef} className="absolute inset-0" />

      {!room && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-xl border border-gray-800 bg-gray-950/90 px-4 py-3 text-center shadow-2xl">
            <div className="text-sm font-medium text-gray-200">No project selected</div>
            <div className="mt-1 text-xs text-gray-500">Choose or add a project from the left sidebar.</div>
          </div>
        </div>
      )}

      {room && !selectedSession && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-xl border border-gray-800 bg-gray-950/90 px-4 py-3 text-center shadow-2xl">
            <div className="text-sm font-medium text-gray-200">{room.name}</div>
            <div className="mt-1 text-xs text-gray-500">Create or select a session from the left.</div>
          </div>
        </div>
      )}

      {/* Capture toolbar — appears when text is selected */}
      {selectedText && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full border border-amber-700 bg-gray-950/95 px-4 py-2 shadow-2xl backdrop-blur">
          <span className="text-xs text-amber-300 mr-1">Capture:</span>
          <button
            onClick={() => handleCapture('context')}
            disabled={capturing}
            className="px-2 py-1 text-xs bg-amber-700 text-white rounded hover:bg-amber-600 disabled:opacity-50 transition-colors"
          >
            To Context
          </button>
          <button
            onClick={() => handleCapture('brief')}
            disabled={capturing}
            className="px-2 py-1 text-xs bg-blue-700 text-white rounded hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            To Brief
          </button>
          <button
            onClick={() => handleCapture('claude')}
            disabled={capturing}
            className="px-2 py-1 text-xs bg-purple-700 text-white rounded hover:bg-purple-600 disabled:opacity-50 transition-colors"
          >
            → Claude
          </button>
          <button
            onClick={() => handleCapture('codex')}
            disabled={capturing}
            className="px-2 py-1 text-xs bg-green-700 text-white rounded hover:bg-green-600 disabled:opacity-50 transition-colors"
          >
            → Codex
          </button>
          <button
            onClick={() => { setSelectedText(null); const inst = termsRef.current.get(activeSessionRef.current ?? ''); if (inst) inst.term.clearSelection(); }}
            className="px-1 py-1 text-xs text-gray-400 hover:text-gray-200"
          >
            ✕
          </button>
        </div>
      )}

      {activeSessionRef.current && activeSession && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-full border border-gray-800 bg-gray-950/90 px-3 py-1.5 shadow-lg">
          <span className="text-[10px] uppercase tracking-wide text-gray-500">{activeSession.agent}</span>
          <span className="max-w-52 truncate text-xs text-gray-300">{activeSession.name}</span>
          <button
            onClick={() => {
              wsClient.send({ type: 'pty.kill', sessionId: activeSessionRef.current } as any);
              const inst = termsRef.current.get(activeSessionRef.current!);
              if (inst) inst.term.writeln('\r\n\x1b[31m[Killed]\x1b[0m');
              activeSessionRef.current = null;
            }}
            className="text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            Kill
          </button>
        </div>
      )}
    </div>
  );
}
