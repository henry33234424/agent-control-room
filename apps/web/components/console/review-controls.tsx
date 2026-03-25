'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';
import { useRoomStore } from '@/stores/room-store';
import { useUIStore } from '@/stores/ui-store';
import { useConsoleStore } from '@/stores/console-store';

type ReviewTarget = 'uncommittedChanges' | 'baseBranch' | 'commit' | 'custom';

export function ReviewControls() {
  const room = useRoomStore((s) => s.room);
  const sessions = useRoomStore((s) => s.sessions);
  const selectedSessionId = useUIStore((s) => s.selectedSessionId);
  const currentRunId = useConsoleStore((s) => s.currentRunId);
  const clearEvents = useConsoleStore((s) => s.clearEvents);
  const loadEvents = useConsoleStore((s) => s.loadEvents);
  const setCurrentRunId = useConsoleStore((s) => s.setCurrentRunId);
  const [target, setTarget] = useState<ReviewTarget>('uncommittedChanges');
  const [customRef, setCustomRef] = useState('');
  const [starting, setStarting] = useState(false);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId);
  if (!room || !selectedSession || selectedSession.agent !== 'codex') return null;

  const needsRef = target === 'commit' || target === 'custom';

  const handleStart = async () => {
    if (!currentRunId || starting || (needsRef && !customRef.trim())) return;

    setStarting(true);
    try {
      const result = await api.reviews.create(room.id, {
        agent: selectedSession.agent,
        sessionId: selectedSession.id,
        target,
        customRef: needsRef ? customRef.trim() : undefined,
        parentRunId: currentRunId,
      });
      clearEvents();
      setCurrentRunId(result.runId);
      const eventPage = await api.runs.events(room.id, result.runId);
      loadEvents(eventPage.items);
    } catch (err) {
      console.error('Failed to start review:', err);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value as ReviewTarget)}
        className="px-2 py-0.5 text-xs bg-gray-800 border border-gray-700 rounded text-gray-300 focus:outline-none focus:border-blue-500"
      >
        <option value="uncommittedChanges">Review diff</option>
        <option value="baseBranch">Review vs base</option>
        <option value="commit">Review commit</option>
        <option value="custom">Review custom</option>
      </select>
      {needsRef && (
        <input
          value={customRef}
          onChange={(e) => setCustomRef(e.target.value)}
          placeholder={target === 'commit' ? 'commit sha' : 'custom ref'}
          className="w-28 px-2 py-0.5 text-xs bg-gray-800 border border-gray-700 rounded text-gray-300 placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
        />
      )}
      <button
        onClick={handleStart}
        disabled={starting || !currentRunId || (needsRef && !customRef.trim())}
        className="px-2 py-0.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {starting ? 'Starting...' : 'Start Review'}
      </button>
    </div>
  );
}
