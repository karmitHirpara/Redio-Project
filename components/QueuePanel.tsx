import { useState, useRef } from 'react';
import { GripVertical, Radio } from 'lucide-react';
import { QueueItem, Playlist } from '../types';
import { QueueItemRow } from './QueueItemRow';
import { motion, AnimatePresence } from 'framer-motion';
import { QueueTimingResult } from '../hooks/useQueueTiming';

interface QueuePanelProps {
  queue: QueueItem[];
  currentTrackId: string | null;
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
  currentTrackId,
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

  const handleDragStart = (index: number) => {
    setDragIndex(index);
    setDropIndex(index);
    // Capture the original queue order at drag start
    dragStartOrderRef.current = [...queue];
  };

  const handleDragOverRow = (event: React.DragEvent<HTMLDivElement>, index: number) => {
    if (dragIndex === null) return;
    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    const halfway = rect.height / 2;

    if (offsetY < halfway) {
      setDropIndex(index);
    } else {
      setDropIndex(index + 1);
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
      onReorderQueue(visible);
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
            {queue.map((item, index) => (
              // Find timing entry for this item, falling back to nowPlaying for the current track
              // if it's not present in queueTimings
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -100 }}
                transition={{ duration: 0.2 }}
                className="mb-1"
              >
                {(() => {
                  const entry = timing?.queueTimings.find((t) => t.item.id === item.id);
                  const isCurrent = item.track.id === currentTrackId;
                  const np = isCurrent ? timing?.nowPlaying : undefined;

                  const startTime = (isCurrent ? np?.start : entry?.start) ?? null;
                  const endTime = (isCurrent ? np?.end : entry?.end) ?? null;
                  return (
                    <QueueItemRow
                      item={item}
                      isPlaying={item.id === currentQueueItemId}
                      isNext={index === 0 && item.id !== currentQueueItemId}
                      onRemove={() => onRemoveFromQueue(item.id)}
                      index={index}
                      onDragStart={handleDragStart}
                      onDragOverRow={handleDragOverRow}
                      onDragEnd={handleDragEnd}
                      dropIndex={dropIndex}
                      startTime={startTime ?? undefined}
                      endTime={endTime ?? undefined}
                      playlists={playlists}
                      onAddToPlaylist={(playlistId) => onAddQueueItemToPlaylist(item, playlistId)}
                    />
                  );
                })()}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}