'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSelectionStore } from '@/stores/selection-store';
import { api } from '@/lib/api-client';
import { useUIStore } from '@/stores/ui-store';
import type { AgentKind, AgentSession } from '@control-room/shared-types';
import { useRoomStore } from '@/stores/room-store';

type AgentState<T> = Record<AgentKind, T>;

function buildDefaultTarget(
  selectedSessionId: string | null,
  agentSessions: AgentSession[],
): string {
  if (selectedSessionId) {
    const selectedSession = agentSessions.find((session) => session.id === selectedSessionId);
    if (selectedSession) {
      return selectedSession.id;
    }
  }
  return agentSessions[0]?.id ?? '';
}

function normalizeTarget(
  current: string,
  selectedSessionId: string | null,
  agentSessions: AgentSession[],
): string {
  if (current && agentSessions.some((session) => session.id === current)) {
    return current;
  }

  return buildDefaultTarget(selectedSessionId, agentSessions);
}

function getAgentTint(agent: AgentKind): {
  label: string;
  button: string;
} {
  if (agent === 'claude') {
    return {
      label: 'text-fuchsia-300',
      button: 'bg-fuchsia-700 hover:bg-fuchsia-600',
    };
  }

  return {
    label: 'text-emerald-300',
    button: 'bg-emerald-700 hover:bg-emerald-600',
  };
}

export function HandoffBar({ roomId }: { roomId: string }) {
  const selectedIds = useSelectionStore((s) => s.selectedMessageIds);
  const clear = useSelectionStore((s) => s.clear);
  const sessions = useRoomStore((s) => s.sessions);
  const selectedSessionId = useUIStore((s) => s.selectedSessionId);
  const setSelectedSessionId = useUIStore((s) => s.setSelectedSessionId);
  const [instruction, setInstruction] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [sending, setSending] = useState<AgentState<boolean>>({
    claude: false,
    codex: false,
  });
  const sessionsByAgent = useMemo(
    () => ({
      claude: sessions.filter((session) => session.agent === 'claude'),
      codex: sessions.filter((session) => session.agent === 'codex'),
    }),
    [sessions],
  );
  const [targets, setTargets] = useState<AgentState<string>>({
    claude: buildDefaultTarget(selectedSessionId, sessionsByAgent.claude),
    codex: buildDefaultTarget(selectedSessionId, sessionsByAgent.codex),
  });

  useEffect(() => {
    setTargets((prev) => ({
      claude: normalizeTarget(prev.claude, selectedSessionId, sessionsByAgent.claude),
      codex: normalizeTarget(prev.codex, selectedSessionId, sessionsByAgent.codex),
    }));
  }, [selectedSessionId, sessionsByAgent]);

  useEffect(() => {
    setInstruction('');
    const resetTextarea = () => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.value = '';
      textarea.setSelectionRange(0, 0);
      textarea.scrollTop = 0;
    };

    resetTextarea();
    window.requestAnimationFrame(resetTextarea);
  }, [roomId]);

  if (selectedIds.size === 0) return null;

  const handleSend = async (agent: AgentKind) => {
    if (sending[agent]) return;

    const selectedSession = sessionsByAgent[agent].find(
      (session) => session.id === targets[agent],
    );
    if (!selectedSession) return;

    setSending((prev) => ({ ...prev, [agent]: true }));
    try {
      const msg = await api.messages.send(roomId, {
        content: instruction.trim() || 'Please continue based on the selected context.',
        mentionTarget: agent,
        sessionId: selectedSession?.id,
        selectedMessageIds: Array.from(selectedIds),
      });
      setInstruction('');
      clear();
      if (msg.sessionId) {
        setSelectedSessionId(msg.sessionId);
      }
    } catch (err) {
      console.error(`${agent} handoff failed:`, err);
    } finally {
      setSending((prev) => ({ ...prev, [agent]: false }));
    }
  };

  return (
    <div className="shrink-0 border-t border-blue-800 bg-blue-900/20 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-blue-300">
          {selectedIds.size} message{selectedIds.size > 1 ? 's' : ''} selected
        </span>
        <button
          onClick={clear}
          className="text-xs text-gray-400 transition-colors hover:text-gray-200"
        >
          Clear
        </button>
      </div>

      <textarea
        ref={textareaRef}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        rows={2}
        placeholder="Additional instruction for the selected context..."
        autoComplete="off"
        data-form-type="other"
        autoSave="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="mt-3 w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
      />

      <div className="mt-2 space-y-2">
        <HandoffRow
          agent="claude"
          targetValue={targets.claude}
          onTargetChange={(value) =>
            setTargets((prev) => ({ ...prev, claude: value }))
          }
          sessions={sessionsByAgent.claude}
          sending={sending.claude}
          onSend={() => void handleSend('claude')}
        />
        <HandoffRow
          agent="codex"
          targetValue={targets.codex}
          onTargetChange={(value) =>
            setTargets((prev) => ({ ...prev, codex: value }))
          }
          sessions={sessionsByAgent.codex}
          sending={sending.codex}
          onSend={() => void handleSend('codex')}
        />
      </div>
    </div>
  );
}

function HandoffRow({
  agent,
  targetValue,
  onTargetChange,
  sessions,
  sending,
  onSend,
}: {
  agent: AgentKind;
  targetValue: string;
  onTargetChange: (value: string) => void;
  sessions: AgentSession[];
  sending: boolean;
  onSend: () => void;
}) {
  const tint = getAgentTint(agent);
  const label = agent === 'claude' ? 'Claude' : 'Codex';

  return (
    <div className="flex items-center gap-2">
      <span className={`w-16 flex-shrink-0 text-xs font-semibold uppercase tracking-wide ${tint.label}`}>
        {label}
      </span>
      <select
        value={targetValue}
        onChange={(e) => onTargetChange(e.target.value)}
        disabled={sending || sessions.length === 0}
        className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 disabled:opacity-50"
      >
        {sessions.length === 0 ? (
          <option value="">No {label} sessions</option>
        ) : (
          sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.name}
            </option>
          ))
        )}
      </select>

      <button
        onClick={onSend}
        disabled={sending || sessions.length === 0 || !targetValue}
        className={`rounded-lg px-4 py-1.5 text-sm text-white transition-colors disabled:opacity-50 ${tint.button}`}
      >
        {sending ? 'Sending...' : 'Send'}
      </button>
    </div>
  );
}
