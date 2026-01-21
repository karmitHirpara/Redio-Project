import { useEffect, useRef, useState } from 'react';
import { X, Search, Plus, GripVertical } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Playlist, Track } from '../types';
import { TrackRow } from './TrackRow';
import { formatDuration } from '../lib/utils';
import { ConfirmDialog } from './ConfirmDialog';

interface PlaylistEditorProps {
  playlist: Playlist;
  highlightTrackId?: string | null;
  onClose: () => void;
  onPlayPlaylistNow: () => void;
  onQueuePlaylist: () => void;
  onAddSongs: (tracks: Track[]) => void;
  onRemoveTrack: (trackId: string) => void;
  onReorderTracks: (tracks: Track[]) => void;
  onImportFiles: (files: File[], insertIndex?: number, suppressDuplicateDialog?: boolean) => void;
  onQueueTrack: (track: Track) => void;
  scheduledStartTime?: Date | null;
  onDropTrackOnPlaylistPanel?: (trackId: string, insertIndex: number) => void;
}

export function PlaylistEditor({
  playlist,
  highlightTrackId,
  onClose,
  onPlayPlaylistNow,
  onQueuePlaylist,
  onAddSongs,
  onRemoveTrack,
  onReorderTracks,
  onImportFiles,
  onQueueTrack,
  scheduledStartTime,
  onDropTrackOnPlaylistPanel,
}: PlaylistEditorProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const [searchQuery, setSearchQuery] = useState('');
  const [queueConfirmOpen, setQueueConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragStartOrderRef = useRef<Track[] | null>(null);
  const [flashTrackId, setFlashTrackId] = useState<string | null>(null);

  useEffect(() => {
    if (!highlightTrackId) return;
    setFlashTrackId(highlightTrackId);
    const t = window.setTimeout(() => setFlashTrackId(null), 900);
    return () => window.clearTimeout(t);
  }, [highlightTrackId]);

  const filteredTracks = playlist.tracks.filter(track =>
    track.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    track.artist.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const canReorder = !playlist.locked && !searchQuery;

  const handleDragStart = (index: number) => {
    if (!canReorder) return;
    setDragIndex(index);
    setDropIndex(index);
    dragStartOrderRef.current = [...filteredTracks];
  };

  const handleDragOverRow = (event: React.DragEvent<HTMLDivElement>, index: number) => {
    const types = Array.from(event.dataTransfer.types);
    const hasFiles = types.includes('Files');
    if (!canReorder && !hasFiles) return;
    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    const halfway = rect.height / 2;

    // If cursor is in the top half of the row, drop before this index;
    // if in the bottom half, drop after it (index + 1). This mimics the
    // insertion bar behavior in native file managers.
    if (offsetY < halfway) {
      setDropIndex(index);
    } else {
      setDropIndex(index + 1);
    }
  };

  const handleDragEnd = () => {
    if (!canReorder || dragIndex === null || dropIndex === null || dragStartOrderRef.current === null) {
      setDragIndex(null);
      setDropIndex(null);
      dragStartOrderRef.current = null;
      return;
    }

    // Work from the original visible order captured at drag start
    const visible = [...dragStartOrderRef.current];
    const from = dragIndex;
    let to = dropIndex;

    // Clamp target into [0, visible.length]
    if (to < 0) to = 0;
    if (to > visible.length) to = visible.length;

    if (from !== to && from >= 0 && from < visible.length && to >= 0 && to <= visible.length) {
      const [moved] = visible.splice(from, 1);
      // If we removed an item before the drop position, adjust the index.
      const insertAt = to > from ? to - 1 : to;
      visible.splice(insertAt, 0, moved);

      // Rebuild full playlist order preserving tracks that are not in the filtered view
      const visibleById = new Map(visible.map(t => [t.id, t] as const));
      const newTracks: Track[] = [];
      let visiblePos = 0;

      for (const t of playlist.tracks) {
        if (visibleById.has(t.id)) {
          newTracks.push(visible[visiblePos++]);
        } else {
          newTracks.push(t);
        }
      }

      onReorderTracks(newTracks);
    }

    setDragIndex(null);
    setDropIndex(null);
    dragStartOrderRef.current = null;
  };

  // Precompute per-track start time labels when a scheduled start time is available
  const startTimeByTrackId: Record<string, string> = {};
  if (scheduledStartTime instanceof Date && !isNaN(scheduledStartTime.getTime())) {
    let cursor = new Date(scheduledStartTime.getTime());
    for (const t of playlist.tracks) {
      const label = cursor.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
      startTimeByTrackId[t.id] = label;
      const durationSec = t.duration || 0;
      cursor = new Date(cursor.getTime() + durationSec * 1000);
    }
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <ConfirmDialog
        open={queueConfirmOpen}
        title="Queue this playlist?"
        description="This will add all tracks from this playlist to the queue."
        confirmLabel="Queue"
        cancelLabel="Cancel"
        onConfirm={() => {
          setQueueConfirmOpen(false);
          onQueuePlaylist();
        }}
        onCancel={() => setQueueConfirmOpen(false)}
      />

      {/* Header */}
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">{playlist.name}</h2>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{playlist.tracks.length} tracks</span>
              <span>{formatDuration(playlist.duration)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={playlist.tracks.length === 0}
              onClick={() => setQueueConfirmOpen(true)}
            >
              Queue
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-muted-foreground" />
            <Input 
              placeholder="Search in playlist..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-slate-900 dark:text-foreground placeholder:text-slate-500 dark:placeholder:text-muted-foreground"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={playlist.locked}
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".mp3,.wav,.ogg,.m4a,.flac"
            className="hidden"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              if (files.length > 0) {
                const insertAt = dropIndex !== null ? dropIndex : undefined;
                onImportFiles(files, insertAt, false);
              }
              e.target.value = '';
            }}
          />
        </div>

        <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
          <span>{playlist.tracks.length} tracks</span>
          <span>{formatDuration(playlist.duration)}</span>
        </div>
      </div>

      {/* Tracks List */}
      <div
        className="flex-1 overflow-y-auto p-2 scroll-thin"
        onDragOver={(e) => {
          const types = Array.from(e.dataTransfer.types);
          const hasTrackId = types.includes('application/x-track-id');
          const hasFiles = types.includes('Files');
          if ((hasTrackId && onDropTrackOnPlaylistPanel) || hasFiles) {
            e.preventDefault();
          }
        }}
        onDrop={(e) => {
          const types = Array.from(e.dataTransfer.types);
          const hasTrackId = types.includes('application/x-track-id');
          const hasFiles = types.includes('Files');
          e.preventDefault();
          e.stopPropagation();

          if (hasTrackId && onDropTrackOnPlaylistPanel) {
            const trackId = e.dataTransfer.getData('application/x-track-id');
            if (!trackId) return;
            const insertAt = dropIndex !== null ? dropIndex : filteredTracks.length;
            onDropTrackOnPlaylistPanel(trackId, insertAt);
            setDropIndex(null);
            return;
          }

          if (hasFiles && onImportFiles) {
            const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
            if (files.length === 0) return;
            const insertAt = dropIndex !== null ? dropIndex : filteredTracks.length;
            // OS drag-and-drop into playlist: suppress duplicate dialog for a
            // smoother flow, always treating duplicates as "Add Copy".
            onImportFiles(files, insertAt, true);
            setDropIndex(null);
            return;
          }
        }}
      >
        {filteredTracks.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            {searchQuery ? 'No tracks found' : 'No tracks in playlist'}
          </div>
        ) : (
          <div className="space-y-1">
            <AnimatePresence mode="popLayout" initial={false}>
              {filteredTracks.map((track, index) => (
                <motion.div
                  key={track.id}
                  layout
                  initial={reduceMotion ? false : { opacity: 0, y: -6 }}
                  animate={
                    reduceMotion
                      ? undefined
                      : flashTrackId === track.id
                        ? {
                            opacity: 1,
                            y: 0,
                            scale: [1, 1.01, 1],
                            backgroundColor: [
                              'rgba(56,189,248,0.08)',
                              'rgba(56,189,248,0.18)',
                              'rgba(56,189,248,0.08)',
                            ],
                          }
                        : { opacity: 1, y: 0, backgroundColor: 'rgba(0,0,0,0)' }
                  }
                  exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
                  whileTap={reduceMotion ? undefined : { scale: 0.99 }}
                  transition={
                    reduceMotion
                      ? undefined
                      : flashTrackId === track.id
                        ? { duration: 0.9, ease: 'easeOut' }
                        : { duration: 0.18, ease: 'easeOut' }
                  }
                  className={`flex items-center gap-2 cursor-default select-none relative hover:bg-accent/10 ${
                    dropIndex === index || dropIndex === index + 1
                      ? 'bg-accent/15 ring-1 ring-accent/60'
                      : ''
                  }`}
                  draggable={canReorder}
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOverRow(e, index)}
                  onDragEnd={handleDragEnd}
                >
                  <AnimatePresence>
                    {dropIndex === index && (
                      <motion.div
                        key="insert-top"
                        className="pointer-events-none absolute left-0 right-0 top-0 h-px bg-accent"
                        initial={reduceMotion ? false : { opacity: 0, scaleX: 0.92 }}
                        animate={reduceMotion ? undefined : { opacity: 1, scaleX: 1 }}
                        exit={reduceMotion ? undefined : { opacity: 0, scaleX: 0.92 }}
                        transition={reduceMotion ? undefined : { duration: 0.12, ease: 'easeOut' }}
                        style={{ transformOrigin: 'center' }}
                      />
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    {dropIndex === index + 1 && (
                      <motion.div
                        key="insert-bottom"
                        className="pointer-events-none absolute left-0 right-0 bottom-0 h-px bg-accent"
                        initial={reduceMotion ? false : { opacity: 0, scaleX: 0.92 }}
                        animate={reduceMotion ? undefined : { opacity: 1, scaleX: 1 }}
                        exit={reduceMotion ? undefined : { opacity: 0, scaleX: 0.92 }}
                        transition={reduceMotion ? undefined : { duration: 0.12, ease: 'easeOut' }}
                        style={{ transformOrigin: 'center' }}
                      />
                    )}
                  </AnimatePresence>

                  <span className="w-6 text-[11px] text-muted-foreground text-right">
                    {index + 1}
                  </span>
                  <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
                  <div className="flex-1">
                    <TrackRow
                      track={track}
                      onAddToQueue={onQueueTrack}
                      onAddToPlaylist={() => {}}
                      playlists={[]}
                      onRemove={onRemoveTrack}
                      showRemove={!playlist.locked}
                      startTimeLabel={startTimeByTrackId[track.id]}
                    />
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
