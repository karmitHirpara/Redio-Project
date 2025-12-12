import { useState, useEffect } from 'react';
import { Playlist, Track, QueueItem, ScheduledPlaylist } from '../types';
import { PlaylistNavigator } from './PlaylistNavigator';
import { PlaylistEditor } from './PlaylistEditor';
import { motion, AnimatePresence } from 'framer-motion';

interface PlaylistManagerProps {
  playlists: Playlist[];
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
  onDropTrackOnPlaylistHeader: (playlistId: string, trackId: string) => void;
  onDropFilesOnPlaylistHeader: (playlistId: string, files: File[], suppressDuplicateDialog?: boolean) => void;
  onDropTrackOnPlaylistPanel: (playlistId: string, trackId: string, insertIndex: number) => void;
}

export function PlaylistManager({
  playlists,
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

  const handleSelectPlaylist = (playlist: Playlist) => {
    // If the user clicks the currently selected playlist while the editor
    // is open, treat it as a toggle to close the editor and let the list
    // expand to full width. Otherwise, open the editor for that playlist.
    if (selectedPlaylist && selectedPlaylist.id === playlist.id && isEditorOpen) {
      setIsEditorOpen(false);
      return;
    }
    setSelectedPlaylist(playlist);
    setIsEditorOpen(true);
  };

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

  // When the editor is closed (or there is no selected playlist), show only
  // the navigator taking the full width so there is no empty panel.
  if (!isEditorOpen || !selectedPlaylist) {
    return (
      <div className="h-full flex bg-background">
        <div className="flex-1 border-r border-border">
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
        </div>
      </div>
    );
  }

  // When the editor is open, show a split view with navigator on the left
  // and the playlist editor sliding in from the right.
  return (
    <div className="h-full flex bg-background">
      {/* Left Subpanel - Playlist Navigator */}
      <div className="w-72 transition-all duration-300 border-r border-border">
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
      </div>

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
            <PlaylistEditor
              playlist={selectedPlaylist}
              onClose={handleCloseEditor}
              onPlayPlaylistNow={() => onPlayPlaylistNow(selectedPlaylist.id)}
              onQueuePlaylist={() => onQueuePlaylist(selectedPlaylist.id)}
              onAddSongs={(tracks) => onAddSongsToPlaylist(selectedPlaylist.id, tracks)}
              onRemoveTrack={(trackId) => onRemoveTrackFromPlaylist(selectedPlaylist.id, trackId)}
              onReorderTracks={(tracks) => onReorderPlaylistTracks(selectedPlaylist.id, tracks)}
              onImportFiles={(files, insertIndex, suppressDuplicateDialog) =>
                onImportFilesToPlaylist(selectedPlaylist.id, files, insertIndex, suppressDuplicateDialog)
              }
              onQueueTrack={onQueueTrackFromPlaylist}
              scheduledStartTime={selectedPlaylistStartTime}
              onDropTrackOnPlaylistPanel={(trackId, insertIndex) =>
                onDropTrackOnPlaylistPanel(selectedPlaylist.id, trackId, insertIndex)
              }
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
