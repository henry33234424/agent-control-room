'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentSession, ServerWsEvent, WsPtyRestore } from '@control-room/shared-types';
import { wsClient } from '@/lib/ws-client';
import { useRoomStore } from '@/stores/room-store';
import { useUIStore } from '@/stores/ui-store';
import { api } from '@/lib/api-client';

let Terminal: any = null;
let FitAddon: any = null;

const PANEL_RESIZE_START = 'control-room:panel-resize-start';
const PANEL_RESIZE_END = 'control-room:panel-resize-end';

type TerminalConnectionState = 'idle' | 'attaching' | 'running' | 'ended';

interface TermInstance {
  term: any;
  fitAddon: any;
  container: HTMLDivElement;
  sessionId: string;
  lastReportedCols?: number;
  lastReportedRows?: number;
  connectionState: TerminalConnectionState;
  statusMessage: string | null;
  autoStartAttempted: boolean;
}

function isPtyNotRunningError(error: unknown): boolean {
  return typeof error === 'string' && error === 'PTY session is not running';
}

function shouldAutoStartSession(session: AgentSession | undefined, inst: TermInstance): boolean {
  return Boolean(
    session
      && session.status === 'idle'
      && !session.vendorSessionId
      && !inst.autoStartAttempted,
  );
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
  const [, setTerminalUiVersion] = useState(0);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const refreshTerminalUi = useCallback(() => {
    setTerminalUiVersion((version) => version + 1);
  }, []);

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

  const getOrCreateTerm = useCallback((sessionId: string): TermInstance | null => {
    if (!loaded || !wrapperRef.current) return null;

    const existing = termsRef.current.get(sessionId);
    if (existing) return existing;

    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.inset = '0';
    container.style.display = 'none';
    container.style.padding = '4px';
    wrapperRef.current.appendChild(container);

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace",
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

    term.onData((data: string) => {
      wsClient.send({ type: 'pty.input', sessionId, data });
    });

    term.onSelectionChange(() => {
      const sel = term.getSelection();
      setSelectedText(sel && sel.trim() ? sel.trim() : null);
    });

    const inst: TermInstance = {
      term,
      fitAddon,
      container,
      sessionId,
      connectionState: 'idle',
      statusMessage: null,
      autoStartAttempted: false,
    };
    termsRef.current.set(sessionId, inst);

    return inst;
  }, [loaded]);

  const setTermStatus = useCallback((
    sessionId: string,
    connectionState: TerminalConnectionState,
    statusMessage: string | null,
    options?: { autoStartAttempted?: boolean },
  ) => {
    const inst = termsRef.current.get(sessionId);
    if (!inst) return;

    let changed = false;

    if (inst.connectionState !== connectionState) {
      inst.connectionState = connectionState;
      changed = true;
    }
    if (inst.statusMessage !== statusMessage) {
      inst.statusMessage = statusMessage;
      changed = true;
    }
    if (
      options?.autoStartAttempted !== undefined
      && inst.autoStartAttempted !== options.autoStartAttempted
    ) {
      inst.autoStartAttempted = options.autoStartAttempted;
      changed = true;
    }

    if (changed) {
      refreshTerminalUi();
    }
  }, [refreshTerminalUi]);

  const syncTerminalSize = useCallback((
    sessionId: string,
    options?: { notifyPty?: boolean; force?: boolean },
  ) => {
    const inst = termsRef.current.get(sessionId);
    if (!inst) return;

    inst.fitAddon.fit();

    const cols = inst.term.cols;
    const rows = inst.term.rows;
    const shouldNotifyPty = options?.notifyPty && inst.connectionState !== 'attaching';

    if (!shouldNotifyPty || cols <= 0 || rows <= 0) {
      return;
    }

    if (!options.force && inst.lastReportedCols === cols && inst.lastReportedRows === rows) {
      return;
    }

    inst.lastReportedCols = cols;
    inst.lastReportedRows = rows;

    wsClient.send({
      type: 'pty.resize',
      sessionId,
      cols,
      rows,
    });
  }, []);

  const startTerminalSession = useCallback((sessionId: string, options?: { auto?: boolean }) => {
    const inst = termsRef.current.get(sessionId);
    const currentRoom = useRoomStore.getState().room;
    const session = useRoomStore.getState().sessions.find((item) => item.id === sessionId);

    if (!inst || !currentRoom || !session) return;

    inst.term.reset();
    syncTerminalSize(sessionId, { notifyPty: false, force: true });
    inst.lastReportedCols = inst.term.cols;
    inst.lastReportedRows = inst.term.rows;

    setTermStatus(sessionId, 'attaching', null, {
      autoStartAttempted: options?.auto === true,
    });

    wsClient.send({
      type: 'pty.start',
      sessionId,
      roomId: currentRoom.id,
      agent: session.agent,
      cols: inst.term.cols,
      rows: inst.term.rows,
    });
  }, [setTermStatus, syncTerminalSize]);

  const attachTerminalSession = useCallback((sessionId: string) => {
    setTermStatus(sessionId, 'attaching', null);
    wsClient.send({ type: 'pty.attach', sessionId });
  }, [setTermStatus]);

  const restoreTerminal = useCallback((event: WsPtyRestore) => {
    const inst = termsRef.current.get(event.sessionId);
    if (!inst) return;

    setTermStatus(event.sessionId, 'running', null, { autoStartAttempted: false });

    inst.term.reset();
    if (event.cols > 0 && event.rows > 0) {
      inst.term.resize(event.cols, event.rows);
      inst.lastReportedCols = event.cols;
      inst.lastReportedRows = event.rows;
    }

    const finalizeRestore = () => {
      if (event.viewportY > 0) {
        inst.term.scrollToLine(event.viewportY);
      } else {
        inst.term.scrollToBottom();
      }

      if (event.sessionId === activeSessionRef.current) {
        window.requestAnimationFrame(() => {
          syncTerminalSize(event.sessionId, { notifyPty: true, force: true });
        });
      }
    };

    if (event.screen) {
      inst.term.write(event.screen, finalizeRestore);
    } else {
      finalizeRestore();
    }
  }, [setTermStatus, syncTerminalSize]);

  // Switch visible terminal when selected session changes
  useEffect(() => {
    for (const inst of termsRef.current.values()) {
      inst.container.style.display = 'none';
    }

    if (!loaded || !selectedSessionId) {
      activeSessionRef.current = null;
      return;
    }

    const session = sessions.find((item) => item.id === selectedSessionId);
    if (!session || !room) {
      activeSessionRef.current = null;
      return;
    }

    const inst = getOrCreateTerm(selectedSessionId);
    if (!inst) return;

    inst.container.style.display = 'block';
    activeSessionRef.current = selectedSessionId;
    attachTerminalSession(selectedSessionId);
  }, [attachTerminalSession, getOrCreateTerm, loaded, room, selectedSessionId, sessions]);

  // Listen for PTY events
  useEffect(() => {
    if (!loaded) return;

    const unsub = wsClient.onEvent((event: ServerWsEvent) => {
      if (event.type === 'pty.restore') {
        restoreTerminal(event);
        return;
      }

      if (event.type === 'pty.output') {
        const inst = termsRef.current.get(event.sessionId);
        if (!inst) return;

        const wasNotRunning = inst.connectionState !== 'running';
        inst.term.write(event.data);
        inst.connectionState = 'running';
        inst.statusMessage = null;
        if (wasNotRunning) {
          refreshTerminalUi();
        }
        return;
      }

      if (event.type === 'pty.started') {
        if (!event.restored) {
          setTermStatus(event.sessionId, 'running', null, { autoStartAttempted: false });
        }
        return;
      }

      if (event.type !== 'pty.exit') {
        return;
      }

      const inst = termsRef.current.get(event.sessionId);
      if (!inst) return;

      const session = useRoomStore.getState().sessions.find((item) => item.id === event.sessionId);
      const isActive = event.sessionId === activeSessionRef.current;

      if (isPtyNotRunningError(event.error) && isActive && shouldAutoStartSession(session, inst)) {
        startTerminalSession(event.sessionId, { auto: true });
        return;
      }

      const statusMessage = event.error ?? 'Process exited';
      setTermStatus(event.sessionId, 'ended', statusMessage, { autoStartAttempted: false });
    });

    return unsub;
  }, [loaded, refreshTerminalUi, restoreTerminal, setTermStatus, startTerminalSession]);

  useEffect(() => {
    if (!loaded) return;

    return wsClient.onOpen(() => {
      const activeId = activeSessionRef.current;
      if (!activeId) return;
      attachTerminalSession(activeId);
    });
  }, [attachTerminalSession, loaded]);

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
      const activeId = activeSessionRef.current;
      if (!activeId) return;
      setTimeout(() => {
        syncTerminalSize(activeId, { notifyPty: true, force: true });
      }, 100);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [loaded, syncTerminalSize]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (resizeRafRef.current !== null) {
      window.cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = null;
    }
    for (const inst of termsRef.current.values()) {
      inst.term.dispose();
      inst.container.remove();
    }
    termsRef.current.clear();
  }, []);

  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const activeSession = sessions.find((s) => s.id === activeSessionRef.current);
  const activeTerm = activeSessionRef.current
    ? termsRef.current.get(activeSessionRef.current) ?? null
    : null;

  const handleCapture = async (target: 'context' | 'brief' | 'claude' | 'codex') => {
    if (!selectedText || !room || capturing) return;
    setCapturing(true);
    try {
      if (target === 'context') {
        const activeAgent = activeSession?.agent;
        await api.excerpts.create(room.id, {
          content: selectedText,
          sourceAgent: activeAgent,
          sourceSessionId: activeSessionRef.current ?? undefined,
        });
      } else if (target === 'brief') {
        await api.pins.create(room.id, { section: 'decisions', content: selectedText });
      } else {
        await api.messages.send(room.id, {
          content: `@${target} ${selectedText}`,
          mentionTarget: target,
        });
      }
      setSelectedText(null);
      const inst = termsRef.current.get(activeSessionRef.current ?? '');
      if (inst) inst.term.clearSelection();
    } catch (err) {
      console.error('Capture failed:', err);
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-[#0a0e14]">
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

      {activeSession && activeTerm?.connectionState === 'attaching' && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="rounded-xl border border-gray-800 bg-gray-950/92 px-4 py-3 text-center shadow-2xl">
            <div className="text-sm font-medium text-gray-200">Restoring terminal</div>
            <div className="mt-1 text-xs text-gray-500">Attaching to the server PTY and rebuilding the screen.</div>
          </div>
        </div>
      )}

      {activeSession && activeTerm?.connectionState === 'ended' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="rounded-xl border border-red-900/70 bg-gray-950/95 px-5 py-4 text-center shadow-2xl">
            <div className="text-sm font-medium text-gray-100">Session ended</div>
            <div className="mt-1 max-w-sm text-xs text-gray-400">
              {activeTerm.statusMessage ?? 'The PTY is no longer running.'}
            </div>
            <button
              onClick={() => startTerminalSession(activeSession.id)}
              className="mt-3 rounded bg-red-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
            >
              Restart
            </button>
          </div>
        </div>
      )}

      {selectedText && (
        <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-700 bg-gray-950/95 px-4 py-2 shadow-2xl backdrop-blur">
          <span className="mr-1 text-xs text-amber-300">Capture:</span>
          <button
            onClick={() => handleCapture('context')}
            disabled={capturing}
            className="rounded bg-amber-700 px-2 py-1 text-xs text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
          >
            To Context
          </button>
          <button
            onClick={() => handleCapture('brief')}
            disabled={capturing}
            className="rounded bg-blue-700 px-2 py-1 text-xs text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
          >
            To Brief
          </button>
          <button
            onClick={() => handleCapture('claude')}
            disabled={capturing}
            className="rounded bg-purple-700 px-2 py-1 text-xs text-white transition-colors hover:bg-purple-600 disabled:opacity-50"
          >
            → Claude
          </button>
          <button
            onClick={() => handleCapture('codex')}
            disabled={capturing}
            className="rounded bg-green-700 px-2 py-1 text-xs text-white transition-colors hover:bg-green-600 disabled:opacity-50"
          >
            → Codex
          </button>
          <button
            onClick={() => {
              setSelectedText(null);
              const inst = termsRef.current.get(activeSessionRef.current ?? '');
              if (inst) inst.term.clearSelection();
            }}
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
          {activeTerm?.connectionState === 'ended' ? (
            <button
              onClick={() => startTerminalSession(activeSession.id)}
              className="text-xs text-red-400 transition-colors hover:text-red-300"
            >
              Restart
            </button>
          ) : (
            <button
              onClick={() => {
                wsClient.send({ type: 'pty.kill', sessionId: activeSessionRef.current! });
              }}
              className="text-xs text-red-400 transition-colors hover:text-red-300"
            >
              Kill
            </button>
          )}
        </div>
      )}
    </div>
  );
}
