// TrackRow.tsx (modified)
import { useState } from 'react';
import { Music, Plus } from 'lucide-react';
import { Track, Playlist } from '../types';
import { formatDuration, formatFileSize, cn } from '../lib/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from './ui/context-menu';

interface TrackRowProps {
  track: Track;
  onAddToQueue: (track: Track) => void;
  onAddToPlaylist: (track: Track, playlistId: string) => void;
  playlists: Playlist[];
  onRemove?: () => void;
  showRemove?: boolean;
  isLibrary?: boolean;
  isSelected?: boolean;         
  isFocused?: boolean;          
  onSelect?: () => void;        
  onFocusRow?: () => void;      
  onKeyDown?: (e: React.KeyboardEvent) => void; 
  startTimeLabel?: string; // optional: scheduled start time for this track
}

export function TrackRow({
  track,
  onAddToQueue,
  onAddToPlaylist,
  playlists,
  onRemove,
  showRemove = false,
  isLibrary = false,
  isSelected = false,
  isFocused = false,
  onSelect,
  onFocusRow,
  onKeyDown,
  startTimeLabel,
}: TrackRowProps) {
  const [isHovered, setIsHovered] = useState(false);

 
  const rowClasses = cn(
    "group flex items-center gap-2 w-full transition-colors duration-150 ease-out outline-none",
    "px-1.5 py-0.5 rounded-sm",
    isSelected
      ? "bg-sky-600/25 text-foreground" 
      : isFocused
        ? "bg-slate-700/40 text-foreground" 
        : isHovered
          ? "bg-slate-700/20 hover:bg-slate-700/30"
          : "bg-transparent hover:bg-slate-700/10"
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          role="option"
          aria-selected={isSelected}
          tabIndex={0} // focusable
          className={rowClasses}
          onClick={() => {
            if (onSelect) onSelect();
          }}
          onFocus={() => onFocusRow && onFocusRow()}
          onBlur={() => {}}
          onKeyDown={onKeyDown}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <Music className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />

          <div className="flex-1 min-w-0 grid grid-cols-[minmax(0,1fr)_56px_80px] items-center gap-1.5 select-text">
            <div className="truncate text-foreground text-xs">{track.name}</div>
            <div className="text-[10px] text-foreground text-right tabular-nums">
              {formatDuration(track.duration)}
            </div>
            <div className="text-[10px] text-foreground text-right tabular-nums opacity-80">
              {startTimeLabel ? startTimeLabel : formatFileSize(track.size)}
            </div>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddToQueue(track);
            }}
            className="p-1 hover:bg-accent rounded opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
            aria-label={`Add ${track.name} to queue`}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onClick={() => onAddToQueue(track)}>Add to Queue</ContextMenuItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger>Add to Playlist</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {playlists.map((playlist) => (
              <ContextMenuItem
                key={playlist.id}
                onClick={() => onAddToPlaylist(track, playlist.id)}
                disabled={playlist.locked}
              >
                {playlist.name}
                {playlist.locked && ' (Locked)'}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {showRemove && onRemove && (
          <ContextMenuItem onClick={onRemove} className="text-destructive">
            Remove Song
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
