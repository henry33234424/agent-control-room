'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { wsClient } from '@/lib/ws-client';
import { useRoomStore } from '@/stores/room-store';
import { useUIStore } from '@/stores/ui-store';
import { api } from '@/lib/api-client';

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
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

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

    // Detect text selection for capture toolbar
    term.onSelectionChange(() => {
      const sel = term.getSelection();
      setSelectedText(sel && sel.trim() ? sel.trim() : null);
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
    } else {
      // Re-attach WS to existing PTY (without buffer replay) so input works
      wsClient.send({ type: 'pty.attach', sessionId: selectedSessionId } as any);
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

  const handleCapture = async (target: 'context' | 'brief' | 'claude' | 'codex') => {
    if (!selectedText || !room || capturing) return;
    setCapturing(true);
    try {
      if (target === 'context') {
        // Create excerpt via dedicated API (no agent dispatch)
        const activeAgent = activeSession?.agent;
        await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3002'}/api/rooms/${room.id}/excerpts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: selectedText,
            sourceAgent: activeAgent,
            sourceSessionId: activeSessionRef.current,
          }),
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
