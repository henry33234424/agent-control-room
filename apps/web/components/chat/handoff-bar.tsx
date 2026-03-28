'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSelectionStore } from '@/stores/selection-store';
import { api } from '@/lib/api-client';
import { useUIStore } from '@/stores/ui-store';
import { useConsoleStore } from '@/stores/console-store';
import type { AgentKind, AgentSession } from '@control-room/shared-types';
import { useRoomStore } from '@/stores/room-store';

type AgentTargetValue = 'auto' | `session:${string}`;
type AgentState<T> = Record<AgentKind, T>;

function buildDefaultTarget(
  agent: AgentKind,
  selectedSessionId: string | null,
  sessions: AgentSession[],
): AgentTargetValue {
  const selectedSession = sessions.find((session) => session.id === selectedSessionId);
  if (selectedSession?.agent === agent) {
    return `session:${selectedSession.id}`;
  }
  return 'auto';
}

function normalizeTarget(
  agent: AgentKind,
  current: AgentTargetValue,
  selectedSessionId: string | null,
  sessions: AgentSession[],
): AgentTargetValue {
  if (current.startsWith('session:')) {
    const sessionId = current.slice('session:'.length);
    if (sessions.some((session) => session.id === sessionId && session.agent === agent)) {
      return current;
    }
  }

  return buildDefaultTarget(agent, selectedSessionId, sessions);
}

function getAgentTint(agent: AgentKind): {
  panel: string;
  label: string;
  button: string;
} {
  if (agent === 'claude') {
    return {
      panel: 'border-fuchsia-800/70 bg-fuchsia-950/20',
      label: 'text-fuchsia-300',
      button: 'bg-fuchsia-700 hover:bg-fuchsia-600',
    };
  }

  return {
    panel: 'border-emerald-800/70 bg-emerald-950/20',
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
  const setConsoleSession = useConsoleStore((s) => s.setCurrentSessionId);
  const [instructions, setInstructions] = useState<AgentState<string>>({
    claude: '',
    codex: '',
  });
  const [sending, setSending] = useState<AgentState<boolean>>({
    claude: false,
    codex: false,
  });
  const [targets, setTargets] = useState<AgentState<AgentTargetValue>>({
    claude: buildDefaultTarget('claude', selectedSessionId, sessions),
    codex: buildDefaultTarget('codex', selectedSessionId, sessions),
  });

  const sessionsByAgent = useMemo(
    () => ({
      claude: sessions.filter((session) => session.agent === 'claude'),
      codex: sessions.filter((session) => session.agent === 'codex'),
    }),
    [sessions],
  );

  useEffect(() => {
    setTargets((prev) => ({
      claude: normalizeTarget('claude', prev.claude, selectedSessionId, sessions),
      codex: normalizeTarget('codex', prev.codex, selectedSessionId, sessions),
    }));
  }, [selectedSessionId, sessions]);

  if (selectedIds.size === 0) return null;

  const handleSend = async (agent: AgentKind) => {
    if (sending[agent]) return;

    const targetValue = targets[agent];
    const selectedSession =
      targetValue === 'auto'
        ? undefined
        : sessionsByAgent[agent].find(
            (session) => session.id === targetValue.slice('session:'.length),
          );

    setSending((prev) => ({ ...prev, [agent]: true }));
    try {
      const msg = await api.messages.send(roomId, {
        content: instructions[agent].trim() || 'Please continue based on the selected context.',
        mentionTarget: agent,
        sessionId: selectedSession?.id,
        selectedMessageIds: Array.from(selectedIds),
      });
      if (msg.sessionId) {
        setSelectedSessionId(msg.sessionId);
        setConsoleSession(msg.sessionId);
      }
      setInstructions((prev) => ({ ...prev, [agent]: '' }));
    } catch (err) {
      console.error(`${agent} handoff failed:`, err);
    } finally {
      setSending((prev) => ({ ...prev, [agent]: false }));
    }
  };

  return (
    <div className="border-t border-blue-800 bg-blue-900/20 p-3 space-y-3">
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

      <div className="grid gap-3 lg:grid-cols-2">
        <HandoffLane
          agent="claude"
          instruction={instructions.claude}
          onInstructionChange={(value) =>
            setInstructions((prev) => ({ ...prev, claude: value }))
          }
          targetValue={targets.claude}
          onTargetChange={(value) =>
            setTargets((prev) => ({ ...prev, claude: value }))
          }
          sessions={sessionsByAgent.claude}
          sending={sending.claude}
          onSend={() => void handleSend('claude')}
        />
        <HandoffLane
          agent="codex"
          instruction={instructions.codex}
          onInstructionChange={(value) =>
            setInstructions((prev) => ({ ...prev, codex: value }))
          }
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

function HandoffLane({
  agent,
  instruction,
  onInstructionChange,
  targetValue,
  onTargetChange,
  sessions,
  sending,
  onSend,
}: {
  agent: AgentKind;
  instruction: string;
  onInstructionChange: (value: string) => void;
  targetValue: AgentTargetValue;
  onTargetChange: (value: AgentTargetValue) => void;
  sessions: AgentSession[];
  sending: boolean;
  onSend: () => void;
}) {
  const tint = getAgentTint(agent);
  const label = agent === 'claude' ? 'Claude' : 'Codex';

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${tint.panel}`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold uppercase tracking-wide ${tint.label}`}>
          Send To {label}
        </span>
        <span className="text-[11px] text-gray-500">{sessions.length} session{sessions.length === 1 ? '' : 's'}</span>
      </div>

      <textarea
        value={instruction}
        onChange={(e) => onInstructionChange(e.target.value)}
        rows={2}
        placeholder={`Additional instruction for ${label}...`}
        className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
      />

      <div className="flex gap-2">
        <select
          value={targetValue}
          onChange={(e) => onTargetChange(e.target.value as AgentTargetValue)}
          disabled={sending}
          className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 disabled:opacity-50"
        >
          <option value="auto">{label} (auto)</option>
          {sessions.map((session) => (
            <option key={session.id} value={`session:${session.id}`}>
              {session.name}
            </option>
          ))}
        </select>

        <button
          onClick={onSend}
          disabled={sending}
          className={`rounded-lg px-4 py-2 text-sm text-white transition-colors disabled:opacity-50 ${tint.button}`}
        >
          {sending ? 'Sending...' : `Send`}
        </button>
      </div>
    </div>
  );
}
