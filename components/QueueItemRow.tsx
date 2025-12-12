import { GripVertical, X, Play, Music } from 'lucide-react';
import { QueueItem, Playlist } from '../types';
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
  onDragOverRow: (event: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDragEnd: () => void;
  startTime?: Date;
  endTime?: Date;
  dropIndex: number | null;
}

export function QueueItemRow({
  item,
  isPlaying,
  isNext,
  onRemove,
  index,
  onDragStart,
  onDragOverRow,
  onDragEnd,
  startTime,
  endTime,
  dropIndex,
  playlists,
  onAddToPlaylist,
}: QueueItemRowProps & { playlists: Playlist[]; onAddToPlaylist: (playlistId: string) => void }) {
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
      <ContextMenuTrigger>
        <div
          draggable
          className={cn(
            "group flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors cursor-pointer text-xs relative",
            "hover:bg-accent/40",
            isPlaying && "bg-primary/10 border border-primary/30 shadow-sm",
            isNext && !isPlaying && "bg-accent/25",
            dropIndex === index && "before:absolute before:left-0 before:right-0 before:top-0 before:h-px before:bg-accent",
            dropIndex === index + 1 && "after:absolute after:left-0 after:right-0 after:bottom-0 after:h-px after:bg-accent"
          )}
          onDragStart={(e) => {
            // Make queue items a cross-area drag source by encoding the
            // underlying track id, so they can be dropped onto playlists
            // just like Library tracks.
            try {
              e.dataTransfer.setData('application/x-track-id', item.track.id);
            } catch {
              // ignore if dataTransfer is not available
            }
            onDragStart(index);
          }}
          onDragOver={(e) => onDragOverRow(e, index)}
          onDragEnd={onDragEnd}
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
        {playlists.length > 0 && (
          <>
            <ContextMenuItem disabled className="opacity-60">
              Add to Playlist
            </ContextMenuItem>
            {playlists.map((playlist) => (
              <ContextMenuItem
                key={playlist.id}
                disabled={playlist.locked}
                onClick={() => onAddToPlaylist(playlist.id)}
              >
                {playlist.name}
                {playlist.locked && ' (Locked)'}
              </ContextMenuItem>
            ))}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}