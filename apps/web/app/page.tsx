'use client';

import { useEffect } from 'react';
import { SessionTree } from '@/components/sidebar/session-tree';
import { CenterPanel } from '@/components/console/center-panel';
import { ChatPanel } from '@/components/chat/chat-panel';
import { ResizablePanels } from '@/components/layout/resizable-panels';
import { useRoomStore } from '@/stores/room-store';
import { useUIStore } from '@/stores/ui-store';
import { useConsoleStore } from '@/stores/console-store';

export default function HomePage() {
  const setSnapshot = useRoomStore((s) => s.setSnapshot);
  const setSelectedSessionId = useUIStore((s) => s.setSelectedSessionId);
  const setConsoleSession = useConsoleStore((s) => s.setCurrentSessionId);
  const loadEvents = useConsoleStore((s) => s.loadEvents);
  const setCurrentRunId = useConsoleStore((s) => s.setCurrentRunId);

  useEffect(() => {
    setSnapshot({
      room: null,
      sessions: [],
      recentMessages: [],
      pinnedBrief: [],
      pendingApprovals: [],
    });
    setSelectedSessionId(null);
    setConsoleSession(null);
    loadEvents([]);
    setCurrentRunId(null);
  }, [setSnapshot, setSelectedSessionId, setConsoleSession, loadEvents, setCurrentRunId]);

  return (
    <ResizablePanels
      left={
        <div className="h-full bg-gray-900">
          <SessionTree />
        </div>
      }
      center={<CenterPanel />}
      right={<ChatPanel />}
      defaultLeftWidth={260}
      defaultRightWidth={420}
      minWidth={160}
    />
  );
}
