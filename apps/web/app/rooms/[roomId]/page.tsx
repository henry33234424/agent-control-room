'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api-client';
import { useRoomStore } from '@/stores/room-store';
import { useUIStore } from '@/stores/ui-store';
import { useConsoleStore } from '@/stores/console-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { SessionTree } from '@/components/sidebar/session-tree';
import { CenterPanel } from '@/components/console/center-panel';
import { ChatPanel } from '@/components/chat/chat-panel';
import { ResizablePanels } from '@/components/layout/resizable-panels';

function storageKey(roomId: string): string {
  return `control-room:last-session:${roomId}`;
}

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [loading, setLoading] = useState(true);
  const setSnapshot = useRoomStore((s) => s.setSnapshot);
  const selectedSessionId = useUIStore((s) => s.selectedSessionId);
  const setSelectedSessionId = useUIStore((s) => s.setSelectedSessionId);
  const setConsoleSession = useConsoleStore((s) => s.setCurrentSessionId);

  // Connect WebSocket after initial HTTP snapshot is loaded to avoid HTTP/WS snapshot races.
  useWebSocket(roomId, !loading);

  useEffect(() => {
    if (!roomId || !selectedSessionId) return;

    window.localStorage.setItem(storageKey(roomId), selectedSessionId);
  }, [roomId, selectedSessionId]);

  // Load initial snapshot + auto-select most recent session
  useEffect(() => {
    if (!roomId) return;

    // Immediately clear stale data from previous room
    setSnapshot({ room: null, sessions: [], recentMessages: [], pinnedBrief: [], pendingApprovals: [] });
    setSelectedSessionId(null);
    setConsoleSession(null);
    setLoading(true);

    api.rooms
      .get(roomId)
      .then((snapshot) => {
        setSnapshot(snapshot);

        const preferredSessionId = window.localStorage.getItem(storageKey(roomId));
        const preferredSession = preferredSessionId
          ? snapshot.sessions.find((session) => session.id === preferredSessionId)
          : undefined;

        // Prefer the last selected session for this room, then fall back to the most recent one.
        if (snapshot.sessions.length > 0) {
          const sessionToSelect = preferredSession ?? snapshot.sessions[0];
          setSelectedSessionId(sessionToSelect.id);
          setConsoleSession(sessionToSelect.id);
        }
      })
      .finally(() => setLoading(false));
  }, [roomId, setSnapshot, setSelectedSessionId, setConsoleSession]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-500">
        Loading room...
      </div>
    );
  }

  return (
    <ResizablePanels
      left={
        <div className="h-full bg-gray-900">
          <SessionTree />
        </div>
      }
      center={<CenterPanel />}
      right={<ChatPanel />}
      defaultLeftWidth={240}
      defaultRightWidth={420}
      minWidth={160}
    />
  );
}
