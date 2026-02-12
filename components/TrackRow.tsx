// TrackRow.tsx (modified)
import { memo } from 'react';
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
  onRemove?: (trackId: string) => void;
  showRemove?: boolean;
  isLibrary?: boolean;
  isSelected?: boolean;         
  isFocused?: boolean;          
  isRecentlyMoved?: boolean;
  onSelect?: (trackId: string, e: React.MouseEvent) => void;
  onFocusRow?: () => void;      
  onKeyDown?: (e: React.KeyboardEvent) => void; 
  getDragPayload?: () => { trackIds: string[]; sourceFolderId?: string };
  startTimeLabel?: string; // optional: scheduled start time for this track
}

export const TrackRow = memo(function TrackRow({
  track,
  onAddToQueue,
  onAddToPlaylist,
  playlists,
  onRemove,
  showRemove = false,
  isLibrary = false,
  isSelected = false,
  isFocused = false,
  isRecentlyMoved = false,
  onSelect,
  onFocusRow,
  onKeyDown,
  getDragPayload,
  startTimeLabel,
}: TrackRowProps) {
  const rowClasses = cn(
    'group flex items-center gap-2 w-full transition-colors duration-150 ease-out outline-none',
    'px-2 py-1 rounded-sm',
    isSelected
      ? 'bg-[#094771] dark:bg-[#1a3b5c] text-white'
      : isFocused
        ? 'bg-[#2a2d2e] dark:bg-[#37373d] text-foreground'
        : 'bg-transparent hover:bg-[#2a2d2e] dark:hover:bg-[#37373d] text-foreground',
    isRecentlyMoved && !isSelected && 'bg-[#2a2d2e] dark:bg-[#37373d]'
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          role="option"
          aria-selected={isSelected}
          tabIndex={0} // focusable
          className={rowClasses}
          draggable={isLibrary}
          onDragStart={(e) => {
            if (!isLibrary) return;
            try {
              const payload = getDragPayload ? getDragPayload() : { trackIds: [track.id] };
              e.dataTransfer.setData('application/x-redio-tracks', JSON.stringify(payload));
              e.dataTransfer.setData('application/x-track-id', track.id);
              e.dataTransfer.effectAllowed = 'move';

              // Responsive drag preview: create a small drag image with count
              const count = (payload as any).count || payload.trackIds.length;
              if (count > 1) {
                const dragEl = document.createElement('div');
                dragEl.textContent = `${count} items`;
                dragEl.style.cssText = `
                  position: fixed;
                  top: -1000px;
                  left: -1000px;
                  background: var(--background);
                  color: var(--foreground);
                  border: 1px solid var(--border);
                  border-radius: 6px;
                  padding: 4px 8px;
                  font-size: 12px;
                  font-weight: 500;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                  pointer-events: none;
                  z-index: 9999;
                `;
                document.body.appendChild(dragEl);
                e.dataTransfer.setDragImage(dragEl, 0, 0);
                // Clean up after a short delay
                setTimeout(() => dragEl.remove(), 10);
              }
            } catch {
              // dataTransfer may not be available in some environments; ignore.
            }
          }}
          onClick={(e) => {
            if (onSelect) onSelect(track.id, e);
          }}
          onFocus={() => onFocusRow && onFocusRow()}
          onBlur={() => {}}
          onKeyDown={onKeyDown}
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
          <ContextMenuItem onClick={() => onRemove(track.id)} className="text-destructive">
            Remove Song
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
});
