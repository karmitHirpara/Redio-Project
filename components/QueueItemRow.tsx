import { GripVertical, X, Play, Music } from 'lucide-react';
import { QueueItem } from '../types';
import { formatDuration, cn } from '../lib/utils';
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
  onRemove: () => void;
  index: number;
  onDragStart: (index: number) => void;
  onDragEnter: (index: number) => void;
  onDragEnd: () => void;
  startTime?: Date;
  endTime?: Date;
}

export function QueueItemRow({
  item,
  isPlaying,
  isNext,
  onRemove,
  index,
  onDragStart,
  onDragEnter,
  onDragEnd,
  startTime,
  endTime,
}: QueueItemRowProps) {
  const formatClock = (d?: Date) => {
    if (!d) return '';
    return d.toLocaleTimeString([], { hour12: true });
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          draggable
          className={cn(
            "group flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors cursor-pointer",
            "hover:bg-accent/40",
            isPlaying && "bg-primary/10 border border-primary/20",
            isNext && !isPlaying && "bg-accent/25"
          )}
          onDragStart={() => onDragStart(index)}
          onDragEnter={() => onDragEnter(index)}
          onDragOver={(e) => e.preventDefault()}
          onDragEnd={onDragEnd}
        >
          <div className="w-5 text-[10px] text-muted-foreground text-center flex-shrink-0">
            {index + 1}
          </div>
          
          <GripVertical className="w-3.5 h-3.5 text-muted-foreground cursor-grab opacity-0 group-hover:opacity-100 transition-opacity" />
          
          {isPlaying ? (
            <Play className="w-3.5 h-3.5 text-primary animate-pulse flex-shrink-0" />
          ) : (
            <Music className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          )}

          <div className="flex-1 min-w-0">
            <div className={cn(
              "text-xs truncate",
              isPlaying ? "text-primary" : "text-foreground"
            )}>
              {item.track.name}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="truncate">{item.track.artist}</span>
              {item.fromPlaylist && (
                <span className="text-primary text-[10px] px-1.5 py-0.5 bg-primary/10 rounded">
                  {item.fromPlaylist}
                </span>
              )}
              {isNext && !isPlaying && (
                <span className="text-[10px] px-1.5 py-0.5 bg-accent rounded text-foreground">
                  Next
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-0.5 min-w-[68px]">
            <span className="text-[11px] text-muted-foreground">
              {formatDuration(item.track.duration)}
            </span>
            {startTime && endTime && (
              <span className="text-[10px] text-muted-foreground">
                {formatClock(startTime)} 
                <span className="mx-0.5">→</span>
                {formatClock(endTime)}
              </span>
            )}
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-destructive/10 hover:text-destructive rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onRemove} className="text-destructive">
          Remove from Queue
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}