'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
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
  const setSelectedSessionId = useUIStore((s) => s.setSelectedSessionId);

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
    term.writeln('Select a session from the left panel, or create one by');
    term.writeln('sending a message with @Claude or @Codex.');
    term.writeln('');

    // Forward user input to PTY via WebSocket (use ref to always get latest value)
    term.onData((data: string) => {
      if (activePtyRef.current) {
        wsClient.send({ type: 'pty.input', sessionId: activePtyRef.current, data } as any);
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (activePtyRef.current) {
        wsClient.send({
          type: 'pty.resize',
          sessionId: activePtyRef.current,
          cols: term.cols,
          rows: term.rows,
        } as any);
      }
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

    // Clear terminal
    const term = termInstanceRef.current;
    if (term) {
      term.clear();
      term.writeln(`\x1b[36m── Starting ${session.agent === 'claude' ? 'Claude' : 'Codex'} (${session.name}) ──\x1b[0m`);
      term.writeln(`\x1b[90mWorking directory: ${workingDirectory}\x1b[0m`);
      term.writeln('');
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

  // Quick launch: create a real AgentSession via API, then start PTY
  const handleLaunch = async (agent: 'claude' | 'codex') => {
    if (!room) return;

    const term = termInstanceRef.current;

    // Create a real session via API
    try {
      const session = await api.sessions.create(room.id, {
        agent,
        name: `${agent}-${Date.now()}`,
      });

      if (term) {
        term.clear();
        term.writeln(`\x1b[36m── Creating ${agent === 'claude' ? 'Claude' : 'Codex'} session (${session.name}) ──\x1b[0m`);
        term.writeln('\x1b[90mWaiting for terminal to attach…\x1b[0m');
        term.writeln('');
      }

      useRoomStore.getState().handleWsEvent({ type: 'session.updated', data: session });
      setSelectedSessionId(session.id);
    } catch (err) {
      if (term) {
        term.writeln(`\x1b[31mFailed to create session: ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0e14]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-gray-800">
        <button
          onClick={() => handleLaunch('claude')}
          className="px-3 py-1 text-xs bg-purple-700 text-white rounded hover:bg-purple-600 transition-colors"
        >
          + Claude
        </button>
        <button
          onClick={() => handleLaunch('codex')}
          className="px-3 py-1 text-xs bg-green-700 text-white rounded hover:bg-green-600 transition-colors"
        >
          + Codex
        </button>
        {activePtySessionId && (
          <>
            <div className="w-px h-4 bg-gray-700" />
            <span className="text-xs text-gray-400">
              Active: {activePtySessionId.slice(0, 12)}…
            </span>
            <button
              onClick={() => {
                wsClient.send({ type: 'pty.kill', sessionId: activePtySessionId } as any);
                setActivePtySessionId(null);
                termInstanceRef.current?.writeln('\r\n\x1b[31m[Killed]\x1b[0m');
              }}
              className="px-2 py-0.5 text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Kill
            </button>
          </>
        )}
      </div>

      {/* Terminal */}
      <div ref={termRef} className="flex-1 p-1" />
    </div>
  );
}
