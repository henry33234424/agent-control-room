'use client';

import { useState } from 'react';
import type { Approval } from '@control-room/shared-types';
import { wsClient } from '@/lib/ws-client';

export function ApprovalCard({ approval }: { approval: Approval }) {
  const [deciding, setDeciding] = useState(false);

  const handleDecide = (decision: 'approved' | 'denied') => {
    setDeciding(true);
    wsClient.send({ type: 'approval.decide', approvalId: approval.id, decision });
  };

  return (
    <div className="border border-yellow-600 bg-yellow-900/30 rounded-lg p-3 my-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-yellow-400 font-bold text-sm">⚠ APPROVAL NEEDED</span>
        <span className="text-xs text-gray-400 uppercase">{approval.agent}</span>
      </div>
      <div className="text-sm text-gray-200 mb-2">{approval.title}</div>
      {approval.payload && (
        <pre className="text-xs text-gray-400 bg-gray-900 rounded p-2 mb-2 overflow-x-auto">
          {JSON.stringify(approval.payload, null, 2)}
        </pre>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => handleDecide('approved')}
          disabled={deciding}
          className="px-3 py-1 text-xs bg-green-700 text-white rounded hover:bg-green-600 disabled:opacity-50 transition-colors"
        >
          Approve
        </button>
        <button
          onClick={() => handleDecide('denied')}
          disabled={deciding}
          className="px-3 py-1 text-xs bg-red-700 text-white rounded hover:bg-red-600 disabled:opacity-50 transition-colors"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
