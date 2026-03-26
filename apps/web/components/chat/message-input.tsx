'use client';

import { useState, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { api } from '@/lib/api-client';
import { useUIStore } from '@/stores/ui-store';
import { useRoomStore } from '@/stores/room-store';
import { useConsoleStore } from '@/stores/console-store';
import { useSelectionStore } from '@/stores/selection-store';
import type { MentionTarget } from '@control-room/shared-types';

export function MessageInput({ roomId }: { roomId: string }) {
  const selectedSessionId = useUIStore((s) => s.selectedSessionId);
  const setSelectedSessionId = useUIStore((s) => s.setSelectedSessionId);
  const sessions = useRoomStore((s) => s.sessions);
  const clearEvents = useConsoleStore((s) => s.clearEvents);
  const setConsoleSession = useConsoleStore((s) => s.setCurrentSessionId);
  const setCurrentRunId = useConsoleStore((s) => s.setCurrentRunId);
  const selectedMessageIds = useSelectionStore((s) => s.selectedMessageIds);
  const clearSelection = useSelectionStore((s) => s.clear);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const parseMention = (text: string): MentionTarget => {
    const lower = text.toLowerCase();
    if (lower.startsWith('@both ') || lower.includes(' @both')) return 'both';
    if (lower.startsWith('@codex ') || lower.includes(' @codex')) return 'codex';
    return 'claude'; // default
  };

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || sending) return;

    setSending(true);
    try {
      const mentionTarget = parseMention(trimmed);
      const selectedSession = sessions.find((session) => session.id === selectedSessionId);
      const preferredSessionId =
        selectedSession &&
        mentionTarget !== 'both' &&
        selectedSession.agent === mentionTarget
          ? selectedSession.id
          : undefined;

      const msg = await api.messages.send(roomId, {
        content: trimmed,
        mentionTarget,
        sessionId: preferredSessionId,
        selectedMessageIds: Array.from(selectedMessageIds),
      });
      if (msg.sessionId) {
        setSelectedSessionId(msg.sessionId);
        setConsoleSession(msg.sessionId);
        clearEvents();
        setCurrentRunId(null);
      }
      clearSelection();
      setContent('');
      textareaRef.current?.focus();
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-3 border-t border-gray-800 bg-gray-900">
      <div className="flex gap-2">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="@Claude or @Codex ..."
          rows={2}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 resize-none focus:outline-none focus:border-blue-500 transition-colors"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !content.trim()}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end"
        >
          {sending ? '...' : 'Send'}
        </button>
      </div>
      <div className="text-xs text-gray-600 mt-1">
        Enter to send, Shift+Enter for newline. Prefix with @Claude, @Codex, or @both.
      </div>
    </form>
  );
}
