import { useState } from 'react';
import { GripVertical, Radio } from 'lucide-react';
import { QueueItem } from '../types';
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
}

export function QueuePanel({
  queue,
  currentTrackId,
  currentQueueItemId,
  onRemoveFromQueue,
  onReorderQueue,
  timing,
}: QueuePanelProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragEnter = (index: number) => {
    if (dragIndex === null || dragIndex === index) return;
    const updated = [...queue];
    const [moved] = updated.splice(dragIndex, 1);
    updated.splice(index, 0, moved);
    setDragIndex(index);
    onReorderQueue(updated);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <h2 className="text-foreground flex items-center gap-2">
          <Radio className="w-4 h-4" />
          Queue
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          {queue.length} tracks
        </p>
      </div>

      {/* Queue List */}
      <div className="flex-1 overflow-y-auto p-2">
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
                  const np =
                    !entry && item.track.id === currentTrackId ? timing?.nowPlaying : undefined;
                  const startTime = entry?.start ?? np?.start ?? null;
                  const endTime = entry?.end ?? np?.end ?? null;
                  return (
                    <QueueItemRow
                      item={item}
                      isPlaying={item.id === currentQueueItemId}
                      isNext={index === 0 && item.id !== currentQueueItemId}
                      onRemove={() => onRemoveFromQueue(item.id)}
                      index={index}
                      onDragStart={handleDragStart}
                      onDragEnter={handleDragEnter}
                      onDragEnd={handleDragEnd}
                      startTime={startTime ?? undefined}
                      endTime={endTime ?? undefined}
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