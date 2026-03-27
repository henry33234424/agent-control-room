'use client';

import { useRoomStore } from '@/stores/room-store';
import { MessageList } from './message-list';
import { MessageInput } from './message-input';
import { HandoffBar } from './handoff-bar';
import { PinnedBriefPanel } from './pinned-brief-panel';

export function ChatPanel() {
  const room = useRoomStore((s) => s.room);

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="p-3 border-b border-gray-800 bg-gray-900">
        <h2 className="text-sm font-bold text-gray-200">Context</h2>
        {room && <p className="text-xs text-gray-500 mt-0.5">{room.name}</p>}
      </div>

      {/* Pinned Brief */}
      {room && <PinnedBriefPanel roomId={room.id} />}

      {/* Messages */}
      <MessageList />

      {/* Handoff Bar (visible when messages selected) */}
      {room && <HandoffBar roomId={room.id} />}

      {/* Input */}
      {room && <MessageInput roomId={room.id} />}
    </div>
  );
}
