'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { wsClient } from '@/lib/ws-client';
import { useRoomStore } from '@/stores/room-store';
import { useUIStore } from '@/stores/ui-store';

// Dynamic import xterm to avoid SSR issues
let Terminal: any = null;
let FitAddon: any = null;

export function TerminalPanel() {
  const room = useRoomStore((s) => s.room);
  const sessions = useRoomStore((s) => s.sessions);
  const selectedSessionId = useUIStore((s) => s.selectedSessionId);

  const termRef = useRef<HTMLDivElement>(null);
  const termInstanceRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const [activePtySessionId, _setActivePtySessionId] = useState<string | null>(null);
  const activePtyRef = useRef<string | null>(null);
  const setActivePtySessionId = (id: string | null) => {
    activePtyRef.current = id;
    _setActivePtySessionId(id);
  };
  const [loaded, setLoaded] = useState(false);
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activePtySessionId) ?? null,
    [sessions, activePtySessionId],
  );

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

  // Initialize terminal
  useEffect(() => {
    if (!loaded || !termRef.current || termInstanceRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
      theme: {
        background: '#0a0e14',
        foreground: '#e6e6e6',
        cursor: '#f8f8f0',
        selectionBackground: '#3b4261',
        black: '#1a1b26',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#c0caf5',
      },
      scrollback: 10000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termRef.current);
    fitAddon.fit();

    termInstanceRef.current = term;
    fitAddonRef.current = fitAddon;

    term.writeln('\x1b[36m╔══════════════════════════════════════╗\x1b[0m');
    term.writeln('\x1b[36m║       Control Room Terminal          ║\x1b[0m');
    term.writeln('\x1b[36m╚══════════════════════════════════════╝\x1b[0m');
    term.writeln('');
    term.writeln('Use the left sidebar to select a project and start a');
    term.writeln('Claude or Codex session.');
    term.writeln('');

    // Forward user input to PTY via WebSocket (use ref to always get latest value)
    term.onData((data: string) => {
      if (activePtyRef.current) {
        wsClient.send({ type: 'pty.input', sessionId: activePtyRef.current, data } as any);
      }
    });

    // Handle resize with debounce to prevent TUI redraw spam
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        fitAddon.fit();
        if (activePtyRef.current) {
          wsClient.send({
            type: 'pty.resize',
            sessionId: activePtyRef.current,
            cols: term.cols,
            rows: term.rows,
          } as any);
        }
      }, 300);
    });
    resizeObserver.observe(termRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      termInstanceRef.current = null;
    };
  }, [loaded]);

  // Listen for PTY output from WebSocket
  useEffect(() => {
    if (!loaded) return;

    const unsub = wsClient.onEvent((event: any) => {
      if (event.type === 'pty.output' && termInstanceRef.current) {
        if (event.sessionId === activePtyRef.current) {
          termInstanceRef.current.write(event.data);
        }
      }
      if (event.type === 'pty.exit' && event.sessionId === activePtyRef.current) {
        if (event.error) {
          termInstanceRef.current?.writeln(`\r\n\x1b[31m[${event.error}]\x1b[0m`);
        }
        termInstanceRef.current?.writeln('\r\n\x1b[33m[Process exited]\x1b[0m');
        setActivePtySessionId(null);
      }
    });

    return unsub;
  }, [loaded]);

  // When session selection changes, start PTY for that session
  useEffect(() => {
    if (!room || !selectedSessionId || !loaded) return;

    const session = sessions.find((s) => s.id === selectedSessionId);
    if (!session) return;

    // Don't restart if already active
    if (activePtySessionId === selectedSessionId) return;

    const workingDirectory =
      typeof session.metadata?.worktreePath === 'string'
        ? session.metadata.worktreePath
        : room.repoPath;

    // Don't clear — server will replay buffer if PTY exists, or show fresh output if new.
    // Just add a visual separator.
    const term = termInstanceRef.current;
    if (term) {
      term.writeln(`\r\n\x1b[36m── Switching to ${session.agent === 'claude' ? 'Claude' : 'Codex'} (${session.name}) ──\x1b[0m\r\n`);
    }

    // Start PTY via WebSocket
    wsClient.send({
      type: 'pty.start',
      sessionId: selectedSessionId,
      roomId: room.id,
      agent: session.agent,
      cols: term?.cols ?? 120,
      rows: term?.rows ?? 40,
    } as any);

    setActivePtySessionId(selectedSessionId);
  }, [room, selectedSessionId, sessions, loaded]);

  return (
    <div className="relative h-full bg-[#0a0e14]">
      <div ref={termRef} className="absolute inset-0 p-1" />

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
            <div className="mt-1 text-xs text-gray-500">Create or select a Claude/Codex session from the left.</div>
          </div>
        </div>
      )}

      {activePtySessionId && activeSession && (
        <div className="absolute right-3 top-3 flex items-center gap-2 rounded-full border border-gray-800 bg-gray-950/90 px-3 py-1.5 shadow-lg">
          <span className="text-[10px] uppercase tracking-wide text-gray-500">{activeSession.agent}</span>
          <span className="max-w-52 truncate text-xs text-gray-300">{activeSession.name}</span>
          <button
            onClick={() => {
              wsClient.send({ type: 'pty.kill', sessionId: activePtySessionId } as any);
              setActivePtySessionId(null);
              termInstanceRef.current?.writeln('\r\n\x1b[31m[Killed]\x1b[0m');
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
