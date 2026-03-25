'use client';

import { useEffect } from 'react';
import { wsClient } from '@/lib/ws-client';
import { useRoomStore } from '@/stores/room-store';
import { useConsoleStore } from '@/stores/console-store';
import { useUIStore } from '@/stores/ui-store';

export function useWebSocket(roomId: string | null) {
  const handleWsEvent = useRoomStore((s) => s.handleWsEvent);
  const appendEvent = useConsoleStore((s) => s.appendEvent);
  const clearEvents = useConsoleStore((s) => s.clearEvents);
  const setCurrentRunId = useConsoleStore((s) => s.setCurrentRunId);

  useEffect(() => {
    if (!roomId) return;

    const unsubscribe = wsClient.onEvent((event) => {
      handleWsEvent(event);

      if (event.type === 'run.status') {
        const selectedSessionId = useUIStore.getState().selectedSessionId;
        const currentRunId = useConsoleStore.getState().currentRunId;
        if (
          event.data.status === 'queued' &&
          selectedSessionId &&
          event.data.sessionId === selectedSessionId &&
          currentRunId === null
        ) {
          clearEvents();
          setCurrentRunId(event.data.runId);
        }
      }

      // Only append runtime events for the currently selected session
      if (event.type === 'runtime.event') {
        const selectedSessionId = useUIStore.getState().selectedSessionId;
        const currentRunId = useConsoleStore.getState().currentRunId;
        const matchesSession = !selectedSessionId || event.data.sessionId === selectedSessionId;
        const matchesRun = !currentRunId || event.data.runId === currentRunId;
        if (matchesSession && matchesRun) {
          appendEvent(event.data);
        }
      }
    });

    wsClient.subscribe(roomId);

    return () => {
      unsubscribe();
      wsClient.unsubscribe();
    };
  }, [roomId, handleWsEvent, appendEvent, clearEvents, setCurrentRunId]);
}
