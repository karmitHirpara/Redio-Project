import { useState, useEffect, useCallback, useMemo } from 'react';
import { Playlist, Track, QueueItem, ScheduledPlaylist } from '../types';
import { PlaylistNavigator } from './PlaylistNavigator';
import { PlaylistEditor } from './PlaylistEditor';
import { motion, AnimatePresence } from 'framer-motion';
import { ResizeHandle } from './ResizeHandle';
import { useResizable } from '../hooks/useResizable';

interface PlaylistManagerProps {
  playlists: Playlist[];
  recentPlaylistAdd?: { playlistId: string; trackId: string; createdAt: number } | null;
  onCreatePlaylist: () => void;
  onRenamePlaylist: (playlistId: string) => void;
  onDeletePlaylist: (playlistId: string) => void;
  onToggleLockPlaylist: (playlistId: string) => void;
  onDuplicatePlaylist: (playlistId: string) => void;
  onAddSongsToPlaylist: (playlistId: string, tracks: Track[]) => void;
  onRemoveTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  onReorderPlaylistTracks: (playlistId: string, tracks: Track[]) => void;
  onSchedulePlaylist: (playlistId: string) => void;
  onPlayPlaylistNow: (playlistId: string) => void;
  onQueuePlaylist: (playlistId: string) => void;
  queue: QueueItem[];
  onImportFilesToPlaylist: (playlistId: string, files: File[], insertIndex?: number, suppressDuplicateDialog?: boolean) => void;
  onQueueTrackFromPlaylist: (track: Track) => void;
  scheduledPlaylists: ScheduledPlaylist[];
  onDeleteSchedule: (scheduleId: string) => void | Promise<void>;
  onDropTrackOnPlaylistHeader: (playlistId: string, trackIds: string[]) => void;
  onDropFilesOnPlaylistHeader: (playlistId: string, files: File[], suppressDuplicateDialog?: boolean) => void;
  onDropTrackOnPlaylistPanel: (playlistId: string, trackIds: string[], insertIndex: number) => void;
}

export function PlaylistManager({
  playlists,
  recentPlaylistAdd,
  onCreatePlaylist,
  onRenamePlaylist,
  onDeletePlaylist,
  onToggleLockPlaylist,
  onDuplicatePlaylist,
  onAddSongsToPlaylist,
  onRemoveTrackFromPlaylist,
  onReorderPlaylistTracks,
  onSchedulePlaylist,
  onPlayPlaylistNow,
  onQueuePlaylist,
  queue,
  onImportFilesToPlaylist,
  onQueueTrackFromPlaylist,
  scheduledPlaylists,
  onDeleteSchedule,
  onDropTrackOnPlaylistHeader,
  onDropFilesOnPlaylistHeader,
  onDropTrackOnPlaylistPanel,
}: PlaylistManagerProps) {
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  const NAV_WIDTH_KEY = 'redio.playlists.nav.width';
  const initialNavWidth = (() => {
    try {
      const raw = window.localStorage.getItem(NAV_WIDTH_KEY);
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n)) {
        return Math.min(Math.max(n, 240), 460);
      }
    } catch {
      // ignore
    }
    return 288;
  })();
  const navPanel = useResizable({ initialWidth: initialNavWidth, minWidth: 240, maxWidth: 460 });

  useEffect(() => {
    try {
      window.localStorage.setItem(NAV_WIDTH_KEY, String(Math.round(navPanel.width)));
    } catch {
      // ignore
    }
  }, [navPanel.width]);

  const selectedPlaylistStartTime = (() => {
    if (!selectedPlaylist) return null;
    const candidates = scheduledPlaylists.filter((s) =>
      s.playlistId === selectedPlaylist.id &&
      s.type === 'datetime' &&
      s.status === 'pending' &&
      s.dateTime
    );
    if (candidates.length === 0) return null;
    const earliest = candidates.reduce((min, s) => {
      const t = s.dateTime ? s.dateTime.getTime() : Number.MAX_SAFE_INTEGER;
      return t < min ? t : min;
    }, Number.MAX_SAFE_INTEGER);
    if (!isFinite(earliest)) return null;
    return new Date(earliest);
  })();

  const handleSelectPlaylist = useCallback((playlist: Playlist) => {
    // If the user clicks the currently selected playlist while the editor
    // is open, treat it as a toggle to close the editor and let the list
    // expand to full width. Otherwise, open the editor for that playlist.
    if (selectedPlaylist && selectedPlaylist.id === playlist.id && isEditorOpen) {
      setIsEditorOpen(false);
      return;
    }
    setSelectedPlaylist(playlist);
    setIsEditorOpen(true);
  }, [isEditorOpen, selectedPlaylist]);

  // Keep selectedPlaylist in sync when playlists change (e.g. add/remove/reorder tracks)
  useEffect(() => {
    if (!selectedPlaylist) return;
    const updated = playlists.find(p => p.id === selectedPlaylist.id) || null;
    setSelectedPlaylist(updated);
    // If the selected playlist was deleted or is otherwise missing,
    // also close the editor so the navigator can reclaim the space.
    if (!updated) {
      setIsEditorOpen(false);
    }
  }, [playlists, selectedPlaylist?.id]);

  const handleCloseEditor = () => {
    setIsEditorOpen(false);
    setSelectedPlaylist(null);
  };

  const selectedPlaylistId = selectedPlaylist?.id ?? null;

  const onPlayPlaylistNowCb = useCallback(() => {
    if (!selectedPlaylistId) return;
    onPlayPlaylistNow(selectedPlaylistId);
  }, [onPlayPlaylistNow, selectedPlaylistId]);

  const onQueuePlaylistCb = useCallback(() => {
    if (!selectedPlaylistId) return;
    onQueuePlaylist(selectedPlaylistId);
  }, [onQueuePlaylist, selectedPlaylistId]);

  const onAddSongsCb = useCallback(
    (tracks: Track[]) => {
      if (!selectedPlaylistId) return;
      onAddSongsToPlaylist(selectedPlaylistId, tracks);
    },
    [onAddSongsToPlaylist, selectedPlaylistId]
  );

  const onRemoveTrackCb = useCallback(
    (trackId: string) => {
      if (!selectedPlaylistId) return;
      onRemoveTrackFromPlaylist(selectedPlaylistId, trackId);
    },
    [onRemoveTrackFromPlaylist, selectedPlaylistId]
  );

  const onReorderTracksCb = useCallback(
    (tracks: Track[]) => {
      if (!selectedPlaylistId) return;
      onReorderPlaylistTracks(selectedPlaylistId, tracks);
    },
    [onReorderPlaylistTracks, selectedPlaylistId]
  );

  const onImportFilesCb = useCallback(
    (files: File[], insertIndex?: number, suppressDuplicateDialog?: boolean) => {
      if (!selectedPlaylistId) return;
      onImportFilesToPlaylist(selectedPlaylistId, files, insertIndex, suppressDuplicateDialog);
    },
    [onImportFilesToPlaylist, selectedPlaylistId]
  );

  const onDropTrackOnPlaylistPanelCb = useCallback(
    (trackIds: string[], insertIndex: number) => {
      if (!selectedPlaylistId) return;
      onDropTrackOnPlaylistPanel(selectedPlaylistId, trackIds, insertIndex);
    },
    [onDropTrackOnPlaylistPanel, selectedPlaylistId]
  );

  const playlistNavigatorEl = useMemo(() => {
    return (
      <PlaylistNavigator
        playlists={playlists}
        selectedPlaylist={selectedPlaylist}
        onSelectPlaylist={handleSelectPlaylist}
        onCreatePlaylist={onCreatePlaylist}
        onRenamePlaylist={onRenamePlaylist}
        onDeletePlaylist={onDeletePlaylist}
        onToggleLockPlaylist={onToggleLockPlaylist}
        onDuplicatePlaylist={onDuplicatePlaylist}
        onSchedulePlaylist={onSchedulePlaylist}
        scheduledPlaylists={scheduledPlaylists}
        onDeleteSchedule={onDeleteSchedule}
        onDropTrackOnPlaylistHeader={onDropTrackOnPlaylistHeader}
        onDropFilesOnPlaylistHeader={onDropFilesOnPlaylistHeader}
      />
    );
  }, [
    playlists,
    selectedPlaylist,
    handleSelectPlaylist,
    onCreatePlaylist,
    onRenamePlaylist,
    onDeletePlaylist,
    onToggleLockPlaylist,
    onDuplicatePlaylist,
    onSchedulePlaylist,
    scheduledPlaylists,
    onDeleteSchedule,
    onDropTrackOnPlaylistHeader,
    onDropFilesOnPlaylistHeader,
  ]);

  const playlistEditorEl = useMemo(() => {
    if (!selectedPlaylist) return null;
    return (
      <PlaylistEditor
        playlist={selectedPlaylist}
        highlightTrackId={
          recentPlaylistAdd && recentPlaylistAdd.playlistId === selectedPlaylist.id
            ? recentPlaylistAdd.trackId
            : null
        }
        onClose={handleCloseEditor}
        onPlayPlaylistNow={onPlayPlaylistNowCb}
        onQueuePlaylist={onQueuePlaylistCb}
        onAddSongs={onAddSongsCb}
        onRemoveTrack={onRemoveTrackCb}
        onReorderTracks={onReorderTracksCb}
        onImportFiles={onImportFilesCb}
        onQueueTrack={onQueueTrackFromPlaylist}
        scheduledStartTime={selectedPlaylistStartTime}
        onDropTrackOnPlaylistPanel={onDropTrackOnPlaylistPanelCb}
      />
    );
  }, [
    selectedPlaylist,
    recentPlaylistAdd,
    handleCloseEditor,
    onPlayPlaylistNowCb,
    onQueuePlaylistCb,
    onAddSongsCb,
    onRemoveTrackCb,
    onReorderTracksCb,
    onImportFilesCb,
    onQueueTrackFromPlaylist,
    selectedPlaylistStartTime,
    onDropTrackOnPlaylistPanelCb,
  ]);

  // When the editor is closed (or there is no selected playlist), show only
  // the navigator taking the full width so there is no empty panel.
  if (!isEditorOpen || !selectedPlaylist) {
    return (
      <div className="h-full flex bg-background">
        <div className="flex-1 border-r border-border">
          {playlistNavigatorEl}
        </div>
      </div>
    );
  }

  // When the editor is open, show a split view with navigator on the left
  // and the playlist editor sliding in from the right.
  return (
    <div className="h-full flex bg-background">
      {/* Left Subpanel - Playlist Navigator */}
      <div
        className="transition-all duration-200 border-r border-border relative flex-shrink-0"
        style={{ width: navPanel.width }}
      >
        {playlistNavigatorEl}
      </div>

      <ResizeHandle onMouseDown={navPanel.handleMouseDown} isResizing={navPanel.isResizing} />

      {/* Right Subpanel - Playlist Editor */}
      <AnimatePresence mode="wait">
        {isEditorOpen && selectedPlaylist && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'auto', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="flex-1 overflow-hidden"
          >
            {playlistEditorEl}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
