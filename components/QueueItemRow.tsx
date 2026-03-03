import { memo, forwardRef } from 'react';
import type React from 'react';
import { GripVertical, X, Play, Music } from 'lucide-react';
import { QueueItem, Playlist } from '../types';
import { formatDuration, cn } from '../lib/utils';
import { motion } from 'framer-motion';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from './ui/context-menu';

interface QueueItemRowProps {
  item: QueueItem;
  isPlaying: boolean;
  isNext: boolean;
  pendingGapRemainingSeconds?: number;
  onRemoveFromQueue: (id: string) => void;
  onSelect: (id: string) => void;
  selected: boolean;
  index: number;
  onDragStart: (index: number) => void;
  onDragOverRow: (event: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDragEnd: () => void;
  startTime?: Date;
  endTime?: Date;
  dropIndex: number | null;
  reduceMotion: boolean;
  playlists: Playlist[];
  onAddToPlaylist: (item: QueueItem, playlistId: string) => void;
  locked?: boolean;
}

export const QueueItemRow = memo(forwardRef<HTMLDivElement, QueueItemRowProps>(function QueueItemRow(
  {
    item,
    isPlaying,
    isNext,
    pendingGapRemainingSeconds,
    onRemoveFromQueue,
    onSelect,
    selected,
    index,
    onDragStart,
    onDragOverRow,
    onDragEnd,
    startTime,
    endTime,
    dropIndex,
    reduceMotion,
    locked = false,
  },
  ref,
) {
  const formatClock = (d?: Date) => {
    if (!d) return '';
    const raw = d.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
    const parts = raw.split(' ');
    if (parts.length > 1) {
      const suffix = parts.pop()!;
      const time = parts.join(' ');
      return `${time} ${suffix.toUpperCase()}`;
    }
    return raw;
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger disabled={locked}>
        <motion.div
          ref={ref}
          layout
          initial={reduceMotion ? false : { opacity: 0, y: -6 }}
          animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
          transition={reduceMotion ? undefined : { duration: 0.18, ease: 'easeOut' }}
          whileTap={reduceMotion ? undefined : { scale: 0.99 }}
          draggable={!locked && !isPlaying}
          className={cn(
            "group flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors cursor-pointer text-xs relative",
            "hover:bg-accent/25",
            isPlaying && "bg-primary/10 border border-primary/30 shadow-sm",
            isNext && !isPlaying && "bg-accent/20",
            locked && "opacity-80",
            selected && !isPlaying && "bg-accent/30 ring-1 ring-accent/70",
            // Make the active drop target stand out more than simple hover
            (dropIndex === index || dropIndex === index + 1) &&
              "bg-accent/30 ring-1 ring-accent/60 shadow-sm",
            dropIndex === index &&
              "before:absolute before:left-0 before:right-0 before:top-0 before:h-px before:bg-accent",
            dropIndex === index + 1 &&
              "after:absolute after:left-0 before:right-0 after:bottom-0 after:h-px after:bg-accent"
          )}
          onDragStartCapture={(e: React.DragEvent<HTMLDivElement>) => {
            if (locked) {
              e.preventDefault();
              return;
            }
            if (isPlaying) {
              e.preventDefault();
              return;
            }
            // Make queue items a cross-area drag source by encoding the
            // underlying track id, so they can be dropped onto playlists
            // just like Library tracks.
            try {
              const dt = (e as unknown as React.DragEvent<HTMLDivElement>).dataTransfer;
              dt?.setData('application/x-track-id', item.track.id);
            } catch {
              // ignore if dataTransfer is not available
            }
            onDragStart(index);
          }}
          onDragOverCapture={(e: React.DragEvent<HTMLDivElement>) => onDragOverRow(e, index)}
          onDragEndCapture={onDragEnd}
          onClick={() => {
            if (locked) return;
            onSelect(item.id);
          }}
        >
          <div className="w-5 text-[10px] text-foreground/70 text-center flex-shrink-0">
            {index + 1}
          </div>

          <GripVertical className="w-3.5 h-3.5 text-muted-foreground cursor-grab opacity-0 group-hover:opacity-100 transition-opacity" />

          {isPlaying ? (
            <Play className="w-3.5 h-3.5 text-primary animate-pulse flex-shrink-0" />
          ) : (
            <Music className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          )}

          <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
            <div
              className={cn(
                "truncate",
                isPlaying ? "text-foreground font-semibold" : "text-foreground"
              )}
            >
              {item.track.name}
            </div>

            <div className="flex items-center gap-1.5 text-[10px] text-foreground tabular-nums flex-shrink-0">
              {typeof pendingGapRemainingSeconds === 'number' && pendingGapRemainingSeconds > 0 && (
                <>
                  <span className="text-muted-foreground">Pending</span>
                  <span className="text-muted-foreground">{formatDuration(pendingGapRemainingSeconds)}</span>
                  <span className="mx-0.5 text-muted-foreground">•</span>
                </>
              )}
              {startTime && endTime && (
                <>
                  <span>{formatClock(startTime)}</span>
                  <span className="mx-0.5">→</span>
                  <span>{formatClock(endTime)}</span>
                  <span className="mx-0.5">•</span>
                </>
              )}
              <span>{formatDuration(item.track.duration)}</span>
            </div>
          </div>

          {!locked && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemoveFromQueue(item.id);
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-destructive/10 hover:text-destructive rounded"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </motion.div>
      </ContextMenuTrigger>
      {!locked && (
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onRemoveFromQueue(item.id)} className="text-destructive">
            Remove from Queue
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}));