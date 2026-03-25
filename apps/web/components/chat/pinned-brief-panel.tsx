'use client';

import { useState } from 'react';
import { useRoomStore } from '@/stores/room-store';
import { api } from '@/lib/api-client';
import type { PinnedBriefSection, PinnedBriefItem } from '@control-room/shared-types';

const SECTIONS: { key: PinnedBriefSection; label: string }[] = [
  { key: 'goal', label: 'Goal' },
  { key: 'constraints', label: 'Constraints' },
  { key: 'decisions', label: 'Decisions' },
  { key: 'openQuestions', label: 'Open Questions' },
  { key: 'doNotTouch', label: 'Do Not Touch' },
];

export function PinnedBriefPanel({ roomId }: { roomId: string }) {
  const pinnedBrief = useRoomStore((s) => s.pinnedBrief);
  const [expanded, setExpanded] = useState(true);
  const [addingTo, setAddingTo] = useState<PinnedBriefSection | null>(null);
  const [newContent, setNewContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const handleAdd = async () => {
    if (!addingTo || !newContent.trim()) return;
    try {
      await api.pins.create(roomId, { section: addingTo, content: newContent.trim() });
      setNewContent('');
      setAddingTo(null);
    } catch (err) {
      console.error('Failed to add pin:', err);
    }
  };

  const handleDelete = async (pinId: string) => {
    try {
      await api.pins.delete(roomId, pinId);
    } catch (err) {
      console.error('Failed to delete pin:', err);
    }
  };

  const startEdit = (item: PinnedBriefItem) => {
    setEditingId(item.id);
    setEditContent(item.content);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editContent.trim()) return;
    try {
      await api.pins.update(roomId, editingId, { content: editContent.trim() });
      setEditingId(null);
      setEditContent('');
    } catch (err) {
      console.error('Failed to update pin:', err);
    }
  };

  const handleMove = async (item: PinnedBriefItem, direction: 'up' | 'down') => {
    const sectionItems = pinnedBrief.filter((p) => p.section === item.section);
    const idx = sectionItems.findIndex((p) => p.id === item.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sectionItems.length) return;

    const other = sectionItems[swapIdx];
    try {
      await Promise.all([
        api.pins.update(roomId, item.id, { sortOrder: other.sortOrder }),
        api.pins.update(roomId, other.id, { sortOrder: item.sortOrder }),
      ]);
    } catch (err) {
      console.error('Failed to reorder pins:', err);
    }
  };

  return (
    <div className="border-b border-gray-800">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-400 uppercase hover:bg-gray-800 transition-colors"
      >
        <span>Shared Brief ({pinnedBrief.length})</span>
        <span>{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 max-h-64 overflow-y-auto">
          {SECTIONS.map(({ key, label }) => {
            const items = pinnedBrief.filter((p) => p.section === key);
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-400">{label}</span>
                  <button
                    onClick={() => setAddingTo(addingTo === key ? null : key)}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    +
                  </button>
                </div>
                {items.length === 0 && (
                  <div className="text-xs text-gray-600 ml-2">—</div>
                )}
                {items.map((item, idx) => (
                  <div key={item.id} className="flex items-start gap-1 ml-2 group">
                    {editingId === item.id ? (
                      <div className="flex-1 flex gap-1">
                        <input
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit();
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="flex-1 px-1.5 py-0.5 text-xs bg-gray-800 border border-blue-500 rounded text-gray-200 focus:outline-none"
                          autoFocus
                        />
                        <button onClick={handleSaveEdit} className="text-xs text-blue-400">✓</button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-gray-500">✗</button>
                      </div>
                    ) : (
                      <>
                        <span
                          className="text-xs text-gray-300 flex-1 cursor-pointer hover:text-white"
                          onDoubleClick={() => startEdit(item)}
                        >
                          {item.content}
                        </span>
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          {idx > 0 && (
                            <button onClick={() => handleMove(item, 'up')} className="text-xs text-gray-500 hover:text-gray-300">↑</button>
                          )}
                          {idx < items.length - 1 && (
                            <button onClick={() => handleMove(item, 'down')} className="text-xs text-gray-500 hover:text-gray-300">↓</button>
                          )}
                          <button onClick={() => startEdit(item)} className="text-xs text-gray-500 hover:text-blue-400">✎</button>
                          <button onClick={() => handleDelete(item.id)} className="text-xs text-gray-500 hover:text-red-400">×</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {addingTo === key && (
                  <div className="flex gap-1 mt-1 ml-2">
                    <input
                      value={newContent}
                      onChange={(e) => setNewContent(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                      placeholder={`Add ${label.toLowerCase()}...`}
                      className="flex-1 px-1.5 py-0.5 text-xs bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-blue-500 text-gray-200"
                      autoFocus
                    />
                    <button
                      onClick={handleAdd}
                      className="text-xs px-2 py-0.5 bg-blue-700 text-white rounded hover:bg-blue-600"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
