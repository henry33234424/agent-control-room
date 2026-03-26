'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api-client';
import { useRoomStore } from '@/stores/room-store';
import { useUIStore } from '@/stores/ui-store';
import { useConsoleStore } from '@/stores/console-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { SessionTree } from '@/components/sidebar/session-tree';
import { RuntimeConsole } from '@/components/console/runtime-console';
import { ChatPanel } from '@/components/chat/chat-panel';

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [loading, setLoading] = useState(true);
  const setSnapshot = useRoomStore((s) => s.setSnapshot);
  const setSelectedSessionId = useUIStore((s) => s.setSelectedSessionId);
  const setConsoleSession = useConsoleStore((s) => s.setCurrentSessionId);
  const loadEvents = useConsoleStore((s) => s.loadEvents);
  const setCurrentRunId = useConsoleStore((s) => s.setCurrentRunId);

  // Connect WebSocket after initial HTTP snapshot is loaded to avoid HTTP/WS snapshot races.
  useWebSocket(roomId, !loading);

  // Load initial snapshot + auto-select most recent session + load its events
  useEffect(() => {
    if (!roomId) return;

    // Immediately clear stale data from previous room
    setSnapshot({ room: null, sessions: [], recentMessages: [], pinnedBrief: [], pendingApprovals: [] });
    setSelectedSessionId(null);
    setConsoleSession(null);
    loadEvents([]);
    setCurrentRunId(null);
    setLoading(true);

    api.rooms
      .get(roomId)
      .then(async (snapshot) => {
        setSnapshot(snapshot);

        // Auto-select the most recently updated session
        if (snapshot.sessions.length > 0) {
          const mostRecent = snapshot.sessions[0]; // already sorted by updatedAt desc
          setSelectedSessionId(mostRecent.id);
          setConsoleSession(mostRecent.id);

          // Load the latest run's events for this session
          try {
            const runs = await api.runs.list(roomId, mostRecent.id);
            if (runs.length > 0) {
              setCurrentRunId(runs[0].id);
              const result = await api.runs.events(roomId, runs[0].id);
              loadEvents(result.items);
            } else {
              setCurrentRunId(null);
              loadEvents([]);
            }
          } catch {
            // No runs yet, that's fine
            setCurrentRunId(null);
            loadEvents([]);
          }
        }
      })
      .finally(() => setLoading(false));
  }, [roomId, setSnapshot, setSelectedSessionId, setConsoleSession, loadEvents, setCurrentRunId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-500">
        Loading room...
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      {/* [a] Left sidebar — Session Tree */}
      <aside className="w-60 border-r border-gray-800 bg-gray-900 flex-shrink-0">
        <SessionTree />
      </aside>

      {/* [b] Middle — Runtime Console */}
      <main className="flex-1 min-w-0">
        <RuntimeConsole />
      </main>

      {/* [c] Right — Chat Panel */}
      <aside className="w-96 border-l border-gray-800 flex-shrink-0">
        <ChatPanel />
      </aside>
    </div>
  );
}
