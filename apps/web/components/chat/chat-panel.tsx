'use client';

import { useRoomStore } from '@/stores/room-store';
import { useSelectionStore } from '@/stores/selection-store';
import { MessageList } from './message-list';
import { MessageInput } from './message-input';
import { HandoffBar } from './handoff-bar';
import { PinnedBriefPanel } from './pinned-brief-panel';

export function ChatPanel() {
  const room = useRoomStore((s) => s.room);
  const selectedMessageIds = useSelectionStore((s) => s.selectedMessageIds);
  const hasSelectedMessages = selectedMessageIds.size > 0;

  return (
    <div className="flex min-h-full flex-col bg-gray-950">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-800 bg-gray-900 p-3">
        <h2 className="text-sm font-bold text-gray-200">Context</h2>
        {room && <p className="text-xs text-gray-500 mt-0.5">{room.name}</p>}
      </div>

      {/* Pinned Brief */}
      {room && <PinnedBriefPanel key={`brief-${room.id}`} roomId={room.id} />}

      {/* Messages */}
      <MessageList />

      {/* Handoff Bar (visible when messages selected) */}
      {room && <HandoffBar key={`handoff-${room.id}`} roomId={room.id} />}

      {/* Input */}
      {room && !hasSelectedMessages && <MessageInput key={`input-${room.id}`} roomId={room.id} />}
    </div>
  );
}
