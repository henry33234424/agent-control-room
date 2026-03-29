'use client';

import { useState, useCallback, useRef, type ReactNode, type MouseEvent } from 'react';

const PANEL_RESIZE_START = 'control-room:panel-resize-start';
const PANEL_RESIZE_END = 'control-room:panel-resize-end';

interface ResizablePanelsProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  defaultLeftWidth?: number;
  defaultRightWidth?: number;
  minWidth?: number;
}

export function ResizablePanels({
  left,
  center,
  right,
  defaultLeftWidth = 240,
  defaultRightWidth = 384,
  minWidth = 160,
}: ResizablePanelsProps) {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [rightWidth, setRightWidth] = useState(defaultRightWidth);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDrag = useCallback(
    (setter: (w: number) => void, side: 'left' | 'right') =>
      (e: MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const container = containerRef.current;
        if (!container) return;

        const startWidth = side === 'left' ? leftWidth : rightWidth;
        const maxWidth = container.offsetWidth * 0.4;

        const onMouseMove = (ev: globalThis.MouseEvent) => {
          const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
          const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + delta));
          setter(newWidth);
        };

        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          window.dispatchEvent(new CustomEvent(PANEL_RESIZE_END));
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.dispatchEvent(new CustomEvent(PANEL_RESIZE_START));
      },
    [leftWidth, rightWidth, minWidth],
  );

  return (
    <div ref={containerRef} className="flex h-screen min-h-0 w-screen overflow-hidden">
      {/* Left panel */}
      <div
        style={{ width: leftWidth, flexShrink: 0 }}
        className="flex h-full min-h-0 flex-col overflow-hidden"
      >
        {left}
      </div>

      {/* Left divider */}
      <div
        onMouseDown={handleDrag(setLeftWidth, 'left')}
        className="w-1 bg-gray-800 hover:bg-blue-500 cursor-col-resize flex-shrink-0 transition-colors"
      />

      {/* Center panel */}
      <div className="flex h-full min-h-0 flex-1 min-w-0 flex-col overflow-hidden">
        {center}
      </div>

      {/* Right divider */}
      <div
        onMouseDown={handleDrag(setRightWidth, 'right')}
        className="w-1 bg-gray-800 hover:bg-blue-500 cursor-col-resize flex-shrink-0 transition-colors"
      />

      {/* Right panel */}
      <div
        style={{ width: rightWidth, flexShrink: 0 }}
        className="flex h-full min-h-0 flex-col overflow-hidden"
      >
        {right}
      </div>
    </div>
  );
}
