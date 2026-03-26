'use client';

import { useState } from 'react';
import { useSelectionStore } from '@/stores/selection-store';
import { api } from '@/lib/api-client';
import { useUIStore } from '@/stores/ui-store';
import { useConsoleStore } from '@/stores/console-store';
import type { AgentKind } from '@control-room/shared-types';

export function HandoffBar({ roomId }: { roomId: string }) {
  const selectedIds = useSelectionStore((s) => s.selectedMessageIds);
  const clear = useSelectionStore((s) => s.clear);
  const setSelectedSessionId = useUIStore((s) => s.setSelectedSessionId);
  const setConsoleSession = useConsoleStore((s) => s.setCurrentSessionId);
  const [instruction, setInstruction] = useState('');
  const [sending, setSending] = useState(false);

  if (selectedIds.size === 0) return null;

  const handleSend = async (target: AgentKind) => {
    if (sending) return;
    setSending(true);
    try {
      const msg = await api.messages.send(roomId, {
        content: `@${target} ${instruction || 'Please continue based on the selected context.'}`,
        mentionTarget: target,
        selectedMessageIds: Array.from(selectedIds),
      });
      if (msg.sessionId) {
        setSelectedSessionId(msg.sessionId);
        setConsoleSession(msg.sessionId);
      }
      clear();
      setInstruction('');
    } catch (err) {
      console.error('Handoff failed:', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-blue-800 bg-blue-900/20 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-blue-300 font-semibold">
          {selectedIds.size} message{selectedIds.size > 1 ? 's' : ''} selected
        </span>
        <button
          onClick={clear}
          className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
        >
          Clear
        </button>
      </div>
      <input
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="Additional instruction for the target agent..."
        className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
      />
      <div className="flex gap-2">
        <button
          onClick={() => handleSend('claude')}
          disabled={sending}
          className="flex-1 py-1 text-xs bg-purple-700 text-white rounded hover:bg-purple-600 disabled:opacity-50 transition-colors"
        >
          Send to Claude
        </button>
        <button
          onClick={() => handleSend('codex')}
          disabled={sending}
          className="flex-1 py-1 text-xs bg-green-700 text-white rounded hover:bg-green-600 disabled:opacity-50 transition-colors"
        >
          Send to Codex
        </button>
      </div>
    </div>
  );
}
