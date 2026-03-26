'use client';

import { useEffect } from 'react';
import { api } from '@/lib/api-client';
import { wsClient } from '@/lib/ws-client';
import { useRoomStore } from '@/stores/room-store';
import { useConsoleStore } from '@/stores/console-store';
import { useUIStore } from '@/stores/ui-store';

export function useWebSocket(roomId: string | null, enabled = true) {
  const handleWsEvent = useRoomStore((s) => s.handleWsEvent);
  const appendEvent = useConsoleStore((s) => s.appendEvent);
  const clearEvents = useConsoleStore((s) => s.clearEvents);
  const loadEvents = useConsoleStore((s) => s.loadEvents);
  const setCurrentRunId = useConsoleStore((s) => s.setCurrentRunId);

  useEffect(() => {
    if (!roomId || !enabled) return;

    const restoreSelectedRun = async () => {
      const selectedSessionId = useUIStore.getState().selectedSessionId;
      if (!selectedSessionId) return;

      const currentRunId = useConsoleStore.getState().currentRunId;

      try {
        if (currentRunId) {
          const result = await api.runs.events(roomId, currentRunId);
          loadEvents(result.items);
          return;
        }

        const runs = await api.runs.list(roomId, selectedSessionId);
        if (runs.length === 0) {
          setCurrentRunId(null);
          loadEvents([]);
          return;
        }

        setCurrentRunId(runs[0].id);
        const result = await api.runs.events(roomId, runs[0].id);
        loadEvents(result.items);
      } catch {
        setCurrentRunId(null);
        loadEvents([]);
      }
    };

    const unsubscribe = wsClient.onEvent((event) => {
      // Ignore events that arrive after room switch but before WS re-subscribes
      if ('data' in event && event.data && typeof event.data === 'object') {
        const d = event.data as any;
        // Most events have data.roomId; room.snapshot has data.room.id
        const eventRoomId = d.roomId ?? d.room?.id;
        if (eventRoomId && eventRoomId !== roomId) return;
      }
      handleWsEvent(event);

      if (event.type === 'room.snapshot') {
        void restoreSelectedRun();
      }

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
  }, [roomId, enabled, handleWsEvent, appendEvent, clearEvents, loadEvents, setCurrentRunId]);
}
