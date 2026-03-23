// TrackRow.tsx (modified)
import { memo, useState } from 'react';
import { Music, Plus } from 'lucide-react';
import { Track, Playlist } from '../types';
import { formatDuration, formatFileSize, cn } from '../lib/utils';
import { SegueEditorDialog } from './SegueEditorDialog';
import { RenameTrackDialog } from './RenameTrackDialog';
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
  onTrackUpdated?: (track: Track) => void;
  onRenameTrack?: (track: Track) => void;
  playlistContext?: { playlistId: string; position: number };
  currentTrackId?: string | null;
  queuedTrackIds?: Set<string> | null;
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
  onTrackUpdated,
  onRenameTrack,
  playlistContext,
  currentTrackId,
  queuedTrackIds,
}: TrackRowProps) {
  const [editOpen, setEditOpen] = useState(false);
  const isQueued = queuedTrackIds ? queuedTrackIds.has(track.id) : false;
  const isPlaying = Boolean(currentTrackId && track.id === currentTrackId);
  const editDisabled = isQueued || isPlaying;
  const rowClasses = cn(
    'group flex items-center gap-2 w-full transition-all duration-150 ease-out outline-none border border-transparent select-none',
    'px-2 py-0.5 rounded-sm h-8',
    isSelected
      ? 'bg-primary/15 text-foreground dark:bg-primary/20 shadow-[inset_0_0_0_1px_rgba(var(--primary),0.2)]'
      : isFocused
        ? 'bg-accent/50 text-foreground dark:bg-accent/30 shadow-[inset_0_0_0_1px_rgba(var(--primary),0.3)]'
        : 'hover:bg-accent/40 dark:hover:bg-accent/20 hover:shadow-sm'
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
            if (!onSelect) return;
            onSelect(track.id, e);
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
          <Music
            className={cn(
              "w-3.5 h-3.5 flex-shrink-0 transition-colors cursor-pointer",
              isSelected ? "text-primary" : "text-muted-foreground opacity-70"
            )}
          />

          <div className="flex-1 min-w-0 grid grid-cols-[minmax(0,1fr)_48px_72px] items-center gap-2 select-text px-1">
            <div className={cn(
              "truncate text-xs font-medium",
              isSelected ? "text-foreground" : "text-foreground/90"
            )}>
              {track.name}
            </div>
            <div className="text-[10px] text-muted-foreground/80 text-right tabular-nums">
              {formatDuration(track.duration)}
            </div>
            <div className="text-[10px] text-muted-foreground/70 text-right tabular-nums overflow-hidden text-ellipsis">
              {startTimeLabel ? startTimeLabel : formatFileSize(track.size)}
            </div>
          </div>

          <button
            onPointerDown={(e) => e.stopPropagation()}
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

        <ContextMenuItem
          disabled={editDisabled}
          onClick={() => {
            if (editDisabled) return;
            setEditOpen(true);
          }}
        >
          Segue Editor
        </ContextMenuItem>

        <ContextMenuItem
          disabled={isPlaying}
          onClick={() => {
            if (isPlaying) return;
            if (onRenameTrack) onRenameTrack(track);
          }}
        >
          Rename
        </ContextMenuItem>

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

      <SegueEditorDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        track={track}
        onTrackUpdated={onTrackUpdated}
        playlistContext={playlistContext}
      />
    </ContextMenu>
  );
});
