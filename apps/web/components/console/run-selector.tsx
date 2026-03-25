'use client';

import { useEffect, useState } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { useConsoleStore } from '@/stores/console-store';
import { useRoomStore } from '@/stores/room-store';
import { api } from '@/lib/api-client';

interface RunSummary {
  id: string;
  status: string;
  triggerType: string;
  createdAt: string;
}

export function RunSelector() {
  const room = useRoomStore((s) => s.room);
  const selectedSessionId = useUIStore((s) => s.selectedSessionId);
  const loadEvents = useConsoleStore((s) => s.loadEvents);
  const currentRunId = useConsoleStore((s) => s.currentRunId);
  const setCurrentRunId = useConsoleStore((s) => s.setCurrentRunId);
  const [runs, setRuns] = useState<RunSummary[]>([]);

  useEffect(() => {
    if (!room || !selectedSessionId) {
      setRuns([]);
      return;
    }
    api.runs.list(room.id, selectedSessionId).then(setRuns).catch(() => setRuns([]));
  }, [room, selectedSessionId, currentRunId]);

  const handleChange = async (runId: string) => {
    if (!room) return;
    setCurrentRunId(runId);
    try {
      const result = await api.runs.events(room.id, runId);
      loadEvents(result.items);
    } catch {
      loadEvents([]);
    }
  };

  if (runs.length === 0) return null;

  return (
    <select
      value={currentRunId ?? runs[0]?.id ?? ''}
      onChange={(e) => handleChange(e.target.value)}
      className="px-2 py-0.5 text-xs bg-gray-800 border border-gray-700 rounded text-gray-300 focus:outline-none focus:border-blue-500"
    >
      {runs.map((r) => (
        <option key={r.id} value={r.id}>
          {r.triggerType} — {r.status} ({new Date(r.createdAt).toLocaleTimeString('en-US', { hour12: false })})
        </option>
      ))}
    </select>
  );
}
