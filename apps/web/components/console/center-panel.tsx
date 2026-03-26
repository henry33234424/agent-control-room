'use client';

import { useState } from 'react';
import { TerminalPanel } from './terminal-panel';
import { RuntimeConsole } from './runtime-console';

type CenterTab = 'terminal' | 'events';

export function CenterPanel() {
  const [tab, setTab] = useState<CenterTab>('terminal');

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex bg-gray-900 border-b border-gray-800">
        <button
          onClick={() => setTab('terminal')}
          className={`px-4 py-1.5 text-xs font-medium transition-colors ${
            tab === 'terminal'
              ? 'text-white bg-gray-800 border-b-2 border-blue-500'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          Terminal
        </button>
        <button
          onClick={() => setTab('events')}
          className={`px-4 py-1.5 text-xs font-medium transition-colors ${
            tab === 'events'
              ? 'text-white bg-gray-800 border-b-2 border-blue-500'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          Events
        </button>
      </div>

      {/* Panel content */}
      <div className="flex-1 min-h-0">
        {tab === 'terminal' ? <TerminalPanel /> : <RuntimeConsole />}
      </div>
    </div>
  );
}
