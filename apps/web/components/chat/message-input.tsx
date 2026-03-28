'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api } from '@/lib/api-client';
import { useUIStore } from '@/stores/ui-store';
import { useRoomStore } from '@/stores/room-store';
import { useConsoleStore } from '@/stores/console-store';
import { useSelectionStore } from '@/stores/selection-store';
import type { AgentSession, MentionTarget } from '@control-room/shared-types';

type MentionSuggestion = {
  key: string;
  label: string;
  token: string;
  mentionTarget: MentionTarget;
  sessionId?: string;
  description: string;
};

type MentionContext = {
  start: number;
  end: number;
  query: string;
  brace: boolean;
};

type ResolvedRouting = {
  cleanedContent: string;
  mentionTarget: MentionTarget;
  preferredSessionId?: string;
};

function getActiveMentionContext(value: string, cursorPos: number): MentionContext | null {
  if (cursorPos < 0 || cursorPos > value.length) return null;

  let start = cursorPos - 1;
  while (start >= 0) {
    const char = value[start];
    if (char === '@') break;
    if (/\s/.test(char)) return null;
    start -= 1;
  }

  if (start < 0 || value[start] !== '@') return null;

  const afterAt = value.slice(start + 1, cursorPos);
  const brace = afterAt.startsWith('{');
  if (brace && afterAt.includes('}')) return null;
  if (!brace && /[\s]/.test(afterAt)) return null;

  let end = cursorPos;
  if (brace) {
    while (end < value.length && value[end] !== '}') {
      if (/\s/.test(value[end])) break;
      end += 1;
    }
    if (value[end] === '}') end += 1;
  } else {
    while (end < value.length && !/\s/.test(value[end])) {
      end += 1;
    }
  }

  return {
    start,
    end,
    query: brace ? afterAt.slice(1) : afterAt,
    brace,
  };
}

function normalizeToken(text: string): string {
  return text.trim().toLowerCase();
}

function stripMention(text: string, start: number, end: number): string {
  const before = text.slice(0, start).trimEnd();
  const after = text.slice(end).trimStart();
  return [before, after].filter(Boolean).join(' ').trim();
}

function resolveSelectedSessionPreference(
  sessions: AgentSession[],
  selectedSessionId: string | null,
  mentionTarget: MentionTarget,
): string | undefined {
  const selectedSession = sessions.find((session) => session.id === selectedSessionId);
  return selectedSession &&
    mentionTarget !== 'both' &&
    selectedSession.agent === mentionTarget
    ? selectedSession.id
    : undefined;
}

function buildMentionSuggestions(sessions: AgentSession[], query: string, brace: boolean): MentionSuggestion[] {
  const normalized = normalizeToken(query);
  const items: MentionSuggestion[] = [];

  if (!brace) {
    const builtins: MentionSuggestion[] = [
      {
        key: 'builtin-claude',
        label: 'Claude',
        token: '@Claude ',
        mentionTarget: 'claude',
        description: 'Route to Claude',
      },
      {
        key: 'builtin-codex',
        label: 'Codex',
        token: '@Codex ',
        mentionTarget: 'codex',
        description: 'Route to Codex',
      },
      {
        key: 'builtin-both',
        label: 'both',
        token: '@both ',
        mentionTarget: 'both',
        description: 'Route to both agents',
      },
    ];

    for (const builtin of builtins) {
      if (!normalized || builtin.label.toLowerCase().includes(normalized)) {
        items.push(builtin);
      }
    }
  }

  for (const session of sessions) {
    const name = session.name.trim();
    if (!name) continue;
    if (normalized && !name.toLowerCase().includes(normalized)) continue;

    items.push({
      key: `session-${session.id}`,
      label: name,
      token: `@{${name}} `,
      mentionTarget: session.agent,
      sessionId: session.id,
      description: `${session.agent} session`,
    });
  }

  return items.slice(0, 8);
}

function resolveRouting(
  text: string,
  sessions: AgentSession[],
  selectedSessionId: string | null,
): ResolvedRouting {
  const sessionPattern = /(^|\s)@\{([^}]+)\}(?=\s|$)/i;
  const builtinPattern = /(^|\s)@(both|codex|claude)(?=\s|$)/i;
  const sessionMatch = sessionPattern.exec(text);
  const builtinMatch = builtinPattern.exec(text);

  const sessionStart =
    sessionMatch && typeof sessionMatch.index === 'number'
      ? sessionMatch.index + sessionMatch[1].length
      : Number.POSITIVE_INFINITY;
  const builtinStart =
    builtinMatch && typeof builtinMatch.index === 'number'
      ? builtinMatch.index + builtinMatch[1].length
      : Number.POSITIVE_INFINITY;

  if (sessionMatch && sessionStart <= builtinStart) {
    const mentionName = sessionMatch[2].trim().toLowerCase();
    const session = sessions.find((item) => item.name.trim().toLowerCase() === mentionName);
    if (session) {
      return {
        cleanedContent: stripMention(text, sessionStart, sessionStart + sessionMatch[0].trimStart().length),
        mentionTarget: session.agent,
        preferredSessionId: session.id,
      };
    }
  }

  if (builtinMatch) {
    const mentionTarget = builtinMatch[2].toLowerCase() as MentionTarget;
    return {
      cleanedContent: stripMention(text, builtinStart, builtinStart + builtinMatch[0].trimStart().length),
      mentionTarget,
      preferredSessionId: resolveSelectedSessionPreference(sessions, selectedSessionId, mentionTarget),
    };
  }

  const cleanedContent = text.trim();
  return {
    cleanedContent,
    mentionTarget: 'claude',
    preferredSessionId: resolveSelectedSessionPreference(sessions, selectedSessionId, 'claude'),
  };
}

export function MessageInput({ roomId }: { roomId: string }) {
  const selectedSessionId = useUIStore((s) => s.selectedSessionId);
  const setSelectedSessionId = useUIStore((s) => s.setSelectedSessionId);
  const sessions = useRoomStore((s) => s.sessions);
  const setConsoleSession = useConsoleStore((s) => s.setCurrentSessionId);
  const selectedMessageIds = useSelectionStore((s) => s.selectedMessageIds);
  const clearSelection = useSelectionStore((s) => s.clear);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [cursorPos, setCursorPos] = useState(0);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mentionContext = getActiveMentionContext(content, cursorPos);
  const suggestions = mentionContext
    ? buildMentionSuggestions(sessions, mentionContext.query, mentionContext.brace)
    : [];

  useEffect(() => {
    if (activeSuggestionIndex >= suggestions.length) {
      setActiveSuggestionIndex(0);
    }
  }, [activeSuggestionIndex, suggestions.length]);

  const applySuggestion = (suggestion: MentionSuggestion) => {
    const textarea = textareaRef.current;
    if (!textarea || !mentionContext) return;

    const nextValue =
      `${content.slice(0, mentionContext.start)}${suggestion.token}${content.slice(mentionContext.end)}`;
    const nextCursorPos = mentionContext.start + suggestion.token.length;

    setContent(nextValue);
    setCursorPos(nextCursorPos);
    setActiveSuggestionIndex(0);

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursorPos, nextCursorPos);
    });
  };

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    const resolved = resolveRouting(content, sessions, selectedSessionId);
    if (!resolved.cleanedContent || sending) return;

    setSending(true);
    try {
      const msg = await api.messages.send(roomId, {
        content: resolved.cleanedContent,
        mentionTarget: resolved.mentionTarget,
        sessionId: resolved.preferredSessionId,
        selectedMessageIds: Array.from(selectedMessageIds),
      });
      if (msg.sessionId) {
        setSelectedSessionId(msg.sessionId);
        setConsoleSession(msg.sessionId);
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
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestionIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestionIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        applySuggestion(suggestions[activeSuggestionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setCursorPos(-1);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-3 border-t border-gray-800 bg-gray-900">
      <div className="relative flex gap-2">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setCursorPos(e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={handleKeyDown}
          onClick={(e) => setCursorPos(e.currentTarget.selectionStart ?? content.length)}
          onKeyUp={(e) => setCursorPos(e.currentTarget.selectionStart ?? content.length)}
          placeholder="Type @ to route to Claude, Codex, both, or a named session..."
          rows={2}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 resize-none focus:outline-none focus:border-blue-500 transition-colors"
          disabled={sending}
        />
        {suggestions.length > 0 && (
          <div className="absolute bottom-full left-0 right-14 mb-2 rounded-lg border border-gray-700 bg-gray-950/98 p-1 shadow-2xl">
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.key}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  applySuggestion(suggestion);
                }}
                className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm transition-colors ${
                  index === activeSuggestionIndex
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-300 hover:bg-gray-900'
                }`}
              >
                <span className="truncate">{suggestion.label}</span>
                <span className="ml-3 flex-shrink-0 text-[10px] uppercase text-gray-500">
                  {suggestion.description}
                </span>
              </button>
            ))}
          </div>
        )}
        <button
          type="submit"
          disabled={sending || !resolveRouting(content, sessions, selectedSessionId).cleanedContent}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end"
        >
          {sending ? '...' : 'Send'}
        </button>
      </div>
      <div className="text-xs text-gray-600 mt-1">
        Enter to send, Shift+Enter for newline. Type <code>@</code> for autocomplete. Named sessions use <code>@{'{'}Session Name{'}'}</code>.
      </div>
    </form>
  );
}
