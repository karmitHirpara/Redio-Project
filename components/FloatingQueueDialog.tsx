import { useEffect, useRef } from 'react';
import type React from 'react';
import { X } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

export type FloatingDialogRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ResizeHandle =
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw';

interface FloatingQueueDialogProps {
  open: boolean;
  title: string;
  subtitle?: string;
  rect: FloatingDialogRect;
  minWidth: number;
  minHeight: number;
  locked: boolean;
  onClose: () => void;
  onToggleLocked: () => void;
  onRectChange: (next: FloatingDialogRect) => void;
  children: React.ReactNode;
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const VIEWPORT_MARGIN = 24;

export function FloatingQueueDialog({
  open,
  title,
  subtitle,
  rect,
  minWidth,
  minHeight,
  locked,
  onClose,
  onToggleLocked,
  onRectChange,
  children,
}: FloatingQueueDialogProps) {
  const dragStartRef = useRef<{
    type: 'drag' | 'resize';
    handle?: ResizeHandle;
    startX: number;
    startY: number;
    startRect: FloatingDialogRect;
  } | null>(null);

  useEffect(() => {
    if (!open) return;

    const onMove = (e: MouseEvent) => {
      const s = dragStartRef.current;
      if (!s) return;

      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;

      const maxW = Math.max(minWidth, window.innerWidth - VIEWPORT_MARGIN * 2);
      const maxH = Math.max(minHeight, window.innerHeight - VIEWPORT_MARGIN * 2);

      if (s.type === 'drag') {
        const nextW = clamp(s.startRect.width, minWidth, maxW);
        const nextH = clamp(s.startRect.height, minHeight, maxH);
        const nextX = clamp(
          s.startRect.x + dx,
          VIEWPORT_MARGIN,
          window.innerWidth - VIEWPORT_MARGIN - nextW
        );
        const nextY = clamp(
          s.startRect.y + dy,
          VIEWPORT_MARGIN,
          window.innerHeight - VIEWPORT_MARGIN - nextH
        );
        onRectChange({ x: nextX, y: nextY, width: nextW, height: nextH });
        return;
      }

      const handle = s.handle;
      if (!handle) return;

      const maxX = window.innerWidth - VIEWPORT_MARGIN - minWidth;
      const maxY = window.innerHeight - VIEWPORT_MARGIN - minHeight;

      let nextX = s.startRect.x;
      let nextY = s.startRect.y;
      let nextW = s.startRect.width;
      let nextH = s.startRect.height;

      if (handle.includes('e')) {
        nextW = clamp(s.startRect.width + dx, minWidth, maxW);
      }
      if (handle.includes('s')) {
        nextH = clamp(s.startRect.height + dy, minHeight, maxH);
      }
      if (handle.includes('w')) {
        const proposedW = s.startRect.width - dx;
        nextW = clamp(proposedW, minWidth, maxW);
        nextX = s.startRect.x + (s.startRect.width - nextW);
      }
      if (handle.includes('n')) {
        const proposedH = s.startRect.height - dy;
        nextH = clamp(proposedH, minHeight, maxH);
        nextY = s.startRect.y + (s.startRect.height - nextH);
      }

      nextX = clamp(nextX, VIEWPORT_MARGIN, maxX);
      nextY = clamp(nextY, VIEWPORT_MARGIN, maxY);

      // Ensure the dialog remains within bounds after resizing.
      nextW = Math.min(nextW, window.innerWidth - VIEWPORT_MARGIN - nextX);
      nextH = Math.min(nextH, window.innerHeight - VIEWPORT_MARGIN - nextY);

      onRectChange({ x: nextX, y: nextY, width: nextW, height: nextH });
    };

    const onUp = () => {
      dragStartRef.current = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [open, minWidth, minHeight, onRectChange]);

  if (!open) return null;

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartRef.current = {
      type: 'drag',
      startX: e.clientX,
      startY: e.clientY,
      startRect: rect,
    };
  };

  const startResize = (handle: ResizeHandle) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragStartRef.current = {
      type: 'resize',
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startRect: rect,
    };
  };

  const handleClass = (cursor: string) =>
    cn('absolute z-50', cursor, 'bg-transparent');

  return (
    <>
      <div className="fixed inset-0 z-30 pointer-events-none bg-black/5 dark:bg-black/25" />
      <div
        className="fixed z-40"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
        }}
      >
        <div className="h-full w-full rounded-xl border border-border/80 bg-background shadow-2xl shadow-black/10 dark:shadow-black/50 ring-1 ring-black/10 dark:ring-white/10 overflow-hidden flex flex-col">
          <div
            className={cn(
              'flex items-center justify-between px-4 py-2.5 border-b border-border/70 select-none bg-muted/30',
              locked ? 'cursor-default' : 'cursor-move'
            )}
            onMouseDown={locked ? undefined : startDrag}
          >
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-foreground truncate">{title}</div>
              {subtitle ? <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div> : null}
            </div>
            <Button size="sm" variant="ghost" onClick={onClose} title="Close">
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 min-h-0">{children}</div>

          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/70 bg-muted/20">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={locked ? 'default' : 'outline'}
                onClick={onToggleLocked}
                title={locked ? 'Unlock queue edits' : 'Lock queue edits'}
              >
                Lock
              </Button>
            </div>
            <Button size="sm" variant="outline" disabled title="Auto-Fill (coming soon)">
              Auto-Fill
            </Button>
          </div>
        </div>

        {/* Resize handles */}
        <div
          className={handleClass('cursor-n-resize')}
          style={{ left: 8, right: 8, top: -4, height: 8 }}
          onMouseDown={startResize('n')}
        />
        <div
          className={handleClass('cursor-s-resize')}
          style={{ left: 8, right: 8, bottom: -4, height: 8 }}
          onMouseDown={startResize('s')}
        />
        <div
          className={handleClass('cursor-e-resize')}
          style={{ top: 8, bottom: 8, right: -4, width: 8 }}
          onMouseDown={startResize('e')}
        />
        <div
          className={handleClass('cursor-w-resize')}
          style={{ top: 8, bottom: 8, left: -4, width: 8 }}
          onMouseDown={startResize('w')}
        />

        <div
          className={handleClass('cursor-nw-resize')}
          style={{ left: -4, top: -4, width: 10, height: 10 }}
          onMouseDown={startResize('nw')}
        />
        <div
          className={handleClass('cursor-ne-resize')}
          style={{ right: -4, top: -4, width: 10, height: 10 }}
          onMouseDown={startResize('ne')}
        />
        <div
          className={handleClass('cursor-sw-resize')}
          style={{ left: -4, bottom: -4, width: 10, height: 10 }}
          onMouseDown={startResize('sw')}
        />
        <div
          className={handleClass('cursor-se-resize')}
          style={{ right: -4, bottom: -4, width: 10, height: 10 }}
          onMouseDown={startResize('se')}
        />
      </div>
    </>
  );
}
