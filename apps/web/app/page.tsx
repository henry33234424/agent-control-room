'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import type { Room } from '@control-room/shared-types';

export default function HomePage() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [repoPath, setRepoPath] = useState('');

  useEffect(() => {
    api.rooms.list().then(setRooms).finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!name || !repoPath) return;
    setCreating(true);
    try {
      const room = await api.rooms.create({ name, repoPath });
      router.push(`/rooms/${room.id}`);
    } catch (err) {
      alert(`Failed to create room: ${err}`);
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-screen text-gray-500">Loading...</div>;

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-full max-w-md p-6 space-y-6">
        <h1 className="text-2xl font-bold text-center">Control Room</h1>

        {/* Existing rooms */}
        {rooms.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-400">Existing Rooms</h2>
            {rooms.map((r) => (
              <div key={r.id} className="flex items-center gap-2">
                <button
                  onClick={() => router.push(`/rooms/${r.id}`)}
                  className="flex-1 text-left p-3 rounded-lg border border-gray-800 bg-gray-900 hover:bg-gray-800 transition-colors"
                >
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{r.repoPath}</div>
                </button>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm(`Delete room "${r.name}"?`)) return;
                    try {
                      await api.rooms.delete(r.id);
                      setRooms((prev) => prev.filter((x) => x.id !== r.id));
                    } catch (err) {
                      alert(err instanceof Error ? err.message : 'Failed to delete room');
                    }
                  }}
                  className="p-3 text-gray-500 hover:text-red-400 transition-colors"
                  title="Delete room"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Create room */}
        <div className="space-y-3 border-t border-gray-800 pt-4">
          <h2 className="text-sm font-semibold text-gray-400">Create New Room</h2>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Room name"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
          />
          <input
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder="Repo path (absolute)"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !name || !repoPath}
            className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 text-sm transition-colors"
          >
            {creating ? 'Creating...' : 'Create Room'}
          </button>
        </div>
      </div>
    </div>
  );
}
