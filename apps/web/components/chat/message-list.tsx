'use client';

import { useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import { useRoomStore } from '@/stores/room-store';
import { useSelectionStore } from '@/stores/selection-store';

const ROLE_STYLES: Record<string, string> = {
  user: 'bg-blue-900/30 border-blue-800',
  agent: 'bg-gray-800/50 border-gray-700',
  system: 'bg-gray-900/50 border-gray-800 text-gray-500 italic',
  'handoff-summary': 'bg-green-900/30 border-green-800',
  excerpt: 'bg-amber-900/30 border-amber-800',
};

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

export function MessageList() {
  const messages = useRoomStore((s) => s.messages);
  const selectedIds = useSelectionStore((s) => s.selectedMessageIds);
  const toggle = useSelectionStore((s) => s.toggle);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div ref={scrollRef} className="flex-1 p-3 space-y-2">
      {messages.length === 0 ? (
        <div className="text-gray-600 text-center mt-8 text-sm">
          No context items yet. Send prompts with @Claude/@Codex, or capture text from the terminal.
        </div>
      ) : (
        messages.map((msg) => (
          <div
            key={msg.id}
            className={`rounded-lg border p-3 text-sm flex gap-2 ${ROLE_STYLES[msg.role] ?? 'bg-gray-800 border-gray-700'} ${
              selectedIds.has(msg.id) ? 'ring-2 ring-blue-500' : ''
            }`}
          >
            {/* Checkbox for selectable messages */}
            {msg.selectable && (
              <input
                type="checkbox"
                checked={selectedIds.has(msg.id)}
                onChange={() => toggle(msg.id)}
                className="mt-1 flex-shrink-0 accent-blue-500"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-gray-400 uppercase">
                  {msg.role === 'agent' && msg.agent
                    ? AGENT_LABELS[msg.agent] ?? msg.agent
                    : msg.role}
                </span>
                <span className="text-xs text-gray-600">
                  {new Date(msg.createdAt).toLocaleTimeString('en-US', { hour12: false })}
                </span>
              </div>
              <div className="text-gray-200 prose prose-invert prose-sm max-w-none" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                <Markdown>{msg.content}</Markdown>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
