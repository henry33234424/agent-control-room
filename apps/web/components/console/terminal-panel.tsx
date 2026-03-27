'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { wsClient } from '@/lib/ws-client';
import { useRoomStore } from '@/stores/room-store';
import { useUIStore } from '@/stores/ui-store';

let Terminal: any = null;
let FitAddon: any = null;

interface TermInstance {
  term: any;
  fitAddon: any;
  container: HTMLDivElement;
  sessionId: string;
  isNew: boolean;
}

export function TerminalPanel() {
  const room = useRoomStore((s) => s.room);
  const sessions = useRoomStore((s) => s.sessions);
  const selectedSessionId = useUIStore((s) => s.selectedSessionId);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const termsRef = useRef<Map<string, TermInstance>>(new Map());
  const activeSessionRef = useRef<string | null>(null);
  const [loaded, setLoaded] = useState(false);

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

    // Create terminal
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

    // Forward input to PTY
    term.onData((data: string) => {
      wsClient.send({ type: 'pty.input', sessionId, data } as any);
    });

    const inst: TermInstance = { term, fitAddon, container, sessionId, isNew: true };
    termsRef.current.set(sessionId, inst);

    return inst;
  }, [loaded]);

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
    inst.fitAddon.fit();

    // Only send pty.start for NEW terminal instances (first time seeing this session).
    // Switching back to an existing terminal just shows it — no pty.start, no buffer replay.
    activeSessionRef.current = selectedSessionId;

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
        cols: inst.term.cols,
        rows: inst.term.rows,
      } as any);
    }
  }, [loaded, selectedSessionId, sessions, room, getOrCreateTerm]);

  // Listen for PTY output — route to correct terminal
  useEffect(() => {
    if (!loaded) return;

    const unsub = wsClient.onEvent((event: any) => {
      if (event.type === 'pty.output') {
        const inst = termsRef.current.get(event.sessionId);
        if (inst) {
          inst.term.write(event.data);
        }
      }
      if (event.type === 'pty.exit') {
        const inst = termsRef.current.get(event.sessionId);
        if (inst) {
          inst.term.writeln('\r\n\x1b[33m[Process exited]\x1b[0m');
        }
      }
    });

    return unsub;
  }, [loaded]);

  // Resize observer — debounced, resizes the active terminal
  useEffect(() => {
    if (!loaded || !wrapperRef.current) return;

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const activeId = activeSessionRef.current;
        if (!activeId) return;
        const inst = termsRef.current.get(activeId);
        if (!inst) return;
        inst.fitAddon.fit();
        wsClient.send({
          type: 'pty.resize',
          sessionId: activeId,
          cols: inst.term.cols,
          rows: inst.term.rows,
        } as any);
      }, 300);
    });
    observer.observe(wrapperRef.current);

    return () => {
      observer.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, [loaded]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const inst of termsRef.current.values()) {
        inst.term.dispose();
        inst.container.remove();
      }
      termsRef.current.clear();
    };
  }, []);

  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const activeSession = sessions.find((s) => s.id === activeSessionRef.current);

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
