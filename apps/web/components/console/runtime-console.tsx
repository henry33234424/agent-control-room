'use client';

import { useEffect, useRef } from 'react';
import { useConsoleStore, filterEvents, type EventFilter } from '@/stores/console-store';
import { useRoomStore } from '@/stores/room-store';
import { useUIStore } from '@/stores/ui-store';
import type { RuntimeEvent } from '@control-room/shared-types';
import { ApprovalCard } from './approval-card';
import { ReviewControls } from './review-controls';
import { RunSelector } from './run-selector';

const FILTER_LABELS: { key: EventFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'commands', label: 'Commands' },
  { key: 'errors', label: 'Errors' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'tools', label: 'Tools' },
  { key: 'raw', label: 'Raw JSON' },
];

const KIND_STYLES: Record<string, string> = {
  'run.started': 'text-cyan-400 font-bold',
  'run.completed': 'text-cyan-400 font-bold',
  'run.failed': 'text-red-400 font-bold',
  'run.status': 'text-cyan-500',
  'tool.started': 'text-yellow-400',
  'tool.completed': 'text-yellow-300',
  'tool.failed': 'text-red-400',
  'command.stdout': 'text-gray-200',
  'command.stderr': 'text-red-300',
  'message.delta': 'text-green-400',
  'message.final': 'text-white font-medium',
  'approval.requested': 'text-yellow-300 font-bold bg-yellow-900/30 px-2 py-1 rounded',
  'approval.resolved': 'text-cyan-300',
  'diff.ready': 'text-green-400 font-bold',
  'system.log': 'text-gray-500',
};

export function RuntimeConsole() {
  const events = useConsoleStore((s) => s.events);
  const activeFilter = useConsoleStore((s) => s.activeFilter);
  const setFilter = useConsoleStore((s) => s.setFilter);
  const allPendingApprovals = useRoomStore((s) => s.pendingApprovals);
  const selectedSessionId = useUIStore((s) => s.selectedSessionId);
  const currentRunId = useConsoleStore((s) => s.currentRunId);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = compactEvents(filterEvents(events, activeFilter), activeFilter);

  // Only show approvals for the currently selected session
  const pendingApprovals = allPendingApprovals.filter((approval) => {
    if (selectedSessionId && approval.sessionId !== selectedSessionId) return false;
    if (currentRunId && approval.runId !== currentRunId) return false;
    return true;
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length, activeFilter, pendingApprovals.length]);

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Toolbar */}
      <div className="flex items-center gap-1 p-2 border-b border-gray-800 bg-gray-900">
        <RunSelector />
        <ReviewControls />
        <div className="w-px h-4 bg-gray-700 mx-1" />
        {FILTER_LABELS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              activeFilter === key
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Event stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-0.5">
        {filtered.length === 0 ? (
          <div className="text-gray-600 text-center mt-8">
            No events yet. Send a message to start a run.
          </div>
        ) : (
          filtered.map((event) => (
            <div
              key={event.id}
              className={`leading-relaxed whitespace-pre-wrap break-words ${
                event.kind === 'message.delta'
                  ? 'rounded-md bg-green-950/30 px-2 py-1'
                  : ''
              } ${KIND_STYLES[event.kind] ?? 'text-gray-400'}`}
            >
              {activeFilter === 'raw' ? (
                <pre className="whitespace-pre-wrap text-gray-400">{JSON.stringify(event, null, 2)}</pre>
              ) : (
                <>
                  <span className="text-gray-600 mr-2">
                    {new Date(event.ts).toLocaleTimeString('en-US', { hour12: false })}
                  </span>
                  {event.title && <span className="mr-2">{event.title}</span>}
                  {event.text && <span>{event.text}</span>}
                </>
              )}
            </div>
          ))
        )}
        {/* Pending approvals rendered as interactive cards */}
        {(activeFilter === 'all' || activeFilter === 'approvals') &&
          pendingApprovals.map((a) => (
            <ApprovalCard key={a.id} approval={a} />
          ))}
      </div>
    </div>
  );
}

function compactEvents(events: RuntimeEvent[], filter: EventFilter): RuntimeEvent[] {
  if (filter === 'raw') return events;

  const compacted: RuntimeEvent[] = [];

  for (const event of events) {
    const last = compacted[compacted.length - 1];

    if (event.kind === 'message.delta' && last?.kind === 'message.delta') {
      last.text = `${last.text ?? ''}${event.text ?? ''}`;
      last.ts = event.ts;
      continue;
    }

    compacted.push({ ...event });
  }

  return compacted;
}
