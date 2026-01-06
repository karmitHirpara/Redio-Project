import { useMemo, useState, useRef } from 'react';
import type React from 'react';
import { Radio } from 'lucide-react';
import { QueueItem, Playlist } from '../types';
import { QueueItemRow } from './QueueItemRow';
import { AnimatePresence, useReducedMotion } from 'framer-motion';
import { QueueTimingResult } from '../hooks/useQueueTiming';

interface QueuePanelProps {
  queue: QueueItem[];
  currentQueueItemId: string | null;
  onRemoveFromQueue: (id: string) => void;
  onReorderQueue: (items: QueueItem[]) => void;
  timing?: QueueTimingResult;
  now?: Date | null;
  playlists: Playlist[];
  onAddQueueItemToPlaylist: (item: QueueItem, playlistId: string) => void;
}

export function QueuePanel({
  queue,
  currentQueueItemId,
  onRemoveFromQueue,
  onReorderQueue,
  timing,
  now,
  playlists,
  onAddQueueItemToPlaylist,
}: QueuePanelProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragStartOrderRef = useRef<QueueItem[] | null>(null);
  const reduceMotion = useReducedMotion() ?? false;

  const pinnedIndex = currentQueueItemId
    ? queue.findIndex((item) => item.id === currentQueueItemId)
    : -1;

  const handleDragStart = (index: number) => {
    setDragIndex(index);
    setDropIndex(index);
    // Capture the original queue order at drag start
    dragStartOrderRef.current = [...queue];
  };

  const timingByQueueItemId = useMemo(() => {
    const map = new Map<string, { start?: Date; end?: Date }>();
    const list = timing?.queueTimings ?? [];
    for (const t of list) {
      map.set(t.item.id, { start: t.start, end: t.end });
    }
    return map;
  }, [timing?.queueTimings]);

  const handleDragOverRow = (event: React.DragEvent<HTMLDivElement>, index: number) => {
    if (dragIndex === null) return;
    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    const halfway = rect.height / 2;

    const desired = offsetY < halfway ? index : index + 1;

    // Keep the currently playing item pinned to the top: do not allow any
    // drops to land above it.
    if (pinnedIndex === 0) {
      setDropIndex(Math.max(desired, 1));
    } else {
      setDropIndex(desired);
    }
  };

  const handleDragEnd = () => {
    const original = dragStartOrderRef.current;
    if (dragIndex === null || dropIndex === null || !original) {
      setDragIndex(null);
      setDropIndex(null);
      dragStartOrderRef.current = null;
      return;
    }

    const visible = [...original];
    const from = dragIndex;
    let to = dropIndex;

    if (to < 0) to = 0;
    if (to > visible.length) to = visible.length;

    if (from !== to && from >= 0 && from < visible.length && to >= 0 && to <= visible.length) {
      const [moved] = visible.splice(from, 1);
      const insertAt = to > from ? to - 1 : to;
      visible.splice(insertAt, 0, moved);

      // Enforce that the current playing item stays at index 0.
      let next = visible;
      if (currentQueueItemId) {
        const idx = next.findIndex((q) => q.id === currentQueueItemId);
        if (idx > 0) {
          next = [next[idx], ...next.slice(0, idx), ...next.slice(idx + 1)];
        }
      }

      onReorderQueue(next);
    }

    setDragIndex(null);
    setDropIndex(null);
    dragStartOrderRef.current = null;
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
          <Radio className="w-4 h-4" />
          Queue
        </h2>
        <p className="text-[11px] text-muted-foreground mt-1">
          {queue.length} tracks
        </p>
      </div>

      {/* Queue List */}
      <div className="flex-1 overflow-y-auto p-2 scroll-thin">
        {queue.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            Queue is empty
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {queue.map((item, index) => {
              const entry = timingByQueueItemId.get(item.id);
              const isCurrent = Boolean(currentQueueItemId && item.id === currentQueueItemId);
              const np = isCurrent ? timing?.nowPlaying : undefined;

              const startTime = (isCurrent ? np?.start : entry?.start) ?? undefined;
              const endTime = (isCurrent ? np?.end : entry?.end) ?? undefined;

              return (
                <QueueItemRow
                  key={item.id}
                  item={item}
                  isPlaying={item.id === currentQueueItemId}
                  isNext={index === 0 && item.id !== currentQueueItemId}
                  onRemoveFromQueue={onRemoveFromQueue}
                  index={index}
                  onDragStart={handleDragStart}
                  onDragOverRow={handleDragOverRow}
                  onDragEnd={handleDragEnd}
                  dropIndex={dropIndex}
                  startTime={startTime}
                  endTime={endTime}
                  playlists={playlists}
                  onAddToPlaylist={onAddQueueItemToPlaylist}
                  reduceMotion={reduceMotion}
                />
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}