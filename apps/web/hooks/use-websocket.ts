'use client';

import { useEffect } from 'react';
import { wsClient } from '@/lib/ws-client';
import { useRoomStore } from '@/stores/room-store';

export function useWebSocket(roomId: string | null, enabled = true) {
  const handleWsEvent = useRoomStore((s) => s.handleWsEvent);

  useEffect(() => {
    if (!roomId || !enabled) return;

    const unsubscribe = wsClient.onEvent((event) => {
      // Ignore events that arrive after room switch but before WS re-subscribes
      if ('data' in event && event.data && typeof event.data === 'object') {
        const d = event.data as any;
        // Most events have data.roomId; room.snapshot has data.room.id
        const eventRoomId = d.roomId ?? d.room?.id;
        if (eventRoomId && eventRoomId !== roomId) return;
      }
      handleWsEvent(event);
    });

    wsClient.subscribe(roomId);

    return () => {
      unsubscribe();
      wsClient.unsubscribe();
    };
  }, [roomId, enabled, handleWsEvent]);
}
