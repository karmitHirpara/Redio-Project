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
  onImportFilesToPlaylist: (playlistId: string, files: File[]) => void;
  onQueueTrackFromPlaylist: (track: Track) => void;
  scheduledPlaylists: ScheduledPlaylist[];
  onDeleteSchedule: (scheduleId: string) => void | Promise<void>;
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
    setSelectedPlaylist(playlist);
    setIsEditorOpen(true);
  };

  // Keep selectedPlaylist in sync when playlists change (e.g. add/remove/reorder tracks)
  useEffect(() => {
    if (!selectedPlaylist) return;
    const updated = playlists.find(p => p.id === selectedPlaylist.id) || null;
    setSelectedPlaylist(updated);
  }, [playlists, selectedPlaylist?.id]);

  const handleCloseEditor = () => {
    setIsEditorOpen(false);
    setSelectedPlaylist(null);
  };

  return (
    <div className="h-full flex bg-background">
      {/* Left Subpanel - Playlist Navigator */}
      <div className={`${isEditorOpen ? 'w-72' : 'flex-1'} transition-all duration-300 border-r border-border`}>
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
              onImportFiles={(files) => onImportFilesToPlaylist(selectedPlaylist.id, files)}
              onQueueTrack={onQueueTrackFromPlaylist}
              scheduledStartTime={selectedPlaylistStartTime}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
