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
    'group flex items-center gap-2 w-full transition-all duration-200 ease-out outline-none',
    'px-2 py-1 rounded-sm hover:shadow-md',
    isSelected
      ? 'bg-sky-200 text-sky-950 dark:bg-sky-700/70 dark:text-white shadow-sm border border-sky-300/50 dark:border-sky-600/50'
      : isFocused
        ? 'bg-sky-100 text-foreground dark:bg-sky-800/50 dark:text-foreground shadow-sm border border-sky-200/50 dark:border-sky-700/30'
        : 'bg-transparent hover:bg-sky-200/55 text-foreground dark:hover:bg-sky-700/35 dark:text-foreground hover:border-sky-300/35 dark:hover:border-sky-500/25 border border-transparent hover:shadow-sm',
    isRecentlyMoved && !isSelected && 'bg-sky-50 dark:bg-sky-800/30 border border-sky-200/40 dark:border-sky-700/25'
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
          onPointerDown={(e) => {
            if (onSelect) {
              // If modifier key is pressed, or if item is NOT selected, select immediately.
              // This allows "Range Select" or "Toggle" or "Select New" to happen on mouse down.
              // If item IS selected and no modifier, we wait for Click (MouseUp) to clear others,
              // so that Dragging the selection doesn't clear it.
              if (e.metaKey || e.ctrlKey || e.shiftKey || !isSelected) {
                onSelect(track.id, e);
              }
            }
          }}
          onClick={(e) => {
            // If we clicked a selected item without modifiers (and didn't drag, implicit by onClick),
            // we now clear the other selections.
            if (isSelected && !e.metaKey && !e.ctrlKey && !e.shiftKey && onSelect) {
              onSelect(track.id, e);
            }
          }}
          onFocus={() => onFocusRow && onFocusRow()}
          onBlur={() => { }}
          onKeyDown={onKeyDown}
        >
          <Music className="w-3.5 h-3.5 text-current opacity-70 flex-shrink-0" />

          <div className="flex-1 min-w-0 grid grid-cols-[minmax(0,1fr)_56px_80px] items-center gap-1.5 select-text">
            <div className="truncate text-current text-xs font-medium">{track.name}</div>
            <div className="text-[10px] text-current text-right tabular-nums opacity-90">
              {formatDuration(track.duration)}
            </div>
            <div className="text-[10px] text-current text-right tabular-nums opacity-80">
              {startTimeLabel ? startTimeLabel : formatFileSize(track.size)}
            </div>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddToQueue(track);
            }}
            className="p-1 hover:bg-accent rounded-sm opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all duration-200 ease-out hover:scale-105 active:scale-95"
            aria-label={`Add ${track.name} to queue`}
          >
            <Plus className="w-4 h-4 transition-transform duration-150" />
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
