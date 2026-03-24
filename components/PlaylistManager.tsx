import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { Playlist, Track, QueueItem, ScheduledPlaylist } from '../types';
import { PlaylistNavigator } from './PlaylistNavigator';
import { PlaylistEditor } from './PlaylistEditor';
import { motion, AnimatePresence } from 'framer-motion';
import { ResizeHandle } from './ResizeHandle';
import { useResizable } from '../hooks/useResizable';

interface PlaylistManagerProps {
  playlists: Playlist[];
  recentPlaylistAdd?: { playlistId: string; trackId: string; createdAt: number } | null;
  importProgress?: { percent: number; label: string; playlistId: string } | null;
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
  onTrackUpdated?: (track: Track) => void;
  scheduledPlaylists: ScheduledPlaylist[];
  onDeleteSchedule: (scheduleId: string) => void | Promise<void>;
  onDropTrackOnPlaylistHeader: (playlistId: string, trackIds: string[]) => void;
  onDropFolderOnPlaylistHeader: (playlistId: string, folderIds: string[]) => void;
  onDropFilesOnPlaylistHeader: (playlistId: string, files: File[], suppressDuplicateDialog?: boolean) => void;
  onDropTrackOnPlaylistPanel: (playlistId: string, trackIds: string[], insertIndex: number) => void;
  onDropFolderOnPlaylistPanel: (playlistId: string, folderIds: string[], insertIndex: number) => void;
  onDropFolderOnEmptyArea?: (playlistName: string, files: File[]) => void;
}

export const PlaylistManager = memo(function PlaylistManager({
  playlists,
  recentPlaylistAdd,
  importProgress,
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
  onTrackUpdated,
  scheduledPlaylists,
  onDeleteSchedule,
  onDropTrackOnPlaylistHeader,
  onDropFolderOnPlaylistHeader,
  onDropFilesOnPlaylistHeader,
  onDropTrackOnPlaylistPanel,
  onDropFolderOnPlaylistPanel,
  onDropFolderOnEmptyArea,
}: PlaylistManagerProps) {
  const EDITOR_OPEN_KEY = 'redio.playlists.editor.open';
  const SELECTED_PLAYLIST_ID_KEY = 'redio.playlists.selected.id';

  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(() => {
    try {
      return window.localStorage.getItem(EDITOR_OPEN_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(EDITOR_OPEN_KEY, String(isEditorOpen));
    } catch { }
  }, [isEditorOpen]);

  // Restore selected playlist from local storage once playlists are loaded
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (!hasRestoredRef.current && playlists.length > 0) {
      try {
        const id = window.localStorage.getItem(SELECTED_PLAYLIST_ID_KEY);
        if (id) {
          const p = playlists.find((x) => x.id === id);
          if (p) {
            setSelectedPlaylist(p);
            hasRestoredRef.current = true;
          }
        }
      } catch { }
    }
  }, [playlists]);

  useEffect(() => {
    if (selectedPlaylist) {
      try {
        window.localStorage.setItem(SELECTED_PLAYLIST_ID_KEY, selectedPlaylist.id);
      } catch { }
    }
  }, [selectedPlaylist]);

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
  const scopedImportProgress =
    selectedPlaylistId && importProgress?.playlistId === selectedPlaylistId
      ? { percent: importProgress.percent, label: importProgress.label }
      : null;

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

  const onDropFolderOnPlaylistPanelCb = useCallback(
    (folderIds: string[], insertIndex: number) => {
      if (!selectedPlaylistId) return;
      onDropFolderOnPlaylistPanel(selectedPlaylistId, folderIds, insertIndex);
    },
    [onDropFolderOnPlaylistPanel, selectedPlaylistId]
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
        onDropFolderOnPlaylistHeader={onDropFolderOnPlaylistHeader}
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
    if (!isEditorOpen || !selectedPlaylist) return null;
    return (
      <PlaylistEditor
        playlist={selectedPlaylist}
        onClose={() => setIsEditorOpen(false)}
        onPlayPlaylistNow={onPlayPlaylistNowCb}
        onQueuePlaylist={onQueuePlaylistCb}
        onAddSongs={onAddSongsCb}
        onRemoveTrack={onRemoveTrackCb}
        onReorderTracks={onReorderTracksCb}
        onImportFiles={onImportFilesCb}
        importProgress={scopedImportProgress}
        onQueueTrack={onQueueTrackFromPlaylist}
        onTrackUpdated={onTrackUpdated}
        scheduledStartTime={selectedPlaylistStartTime}
        onDropTrackOnPlaylistPanel={onDropTrackOnPlaylistPanelCb}
        onDropFolderOnPlaylistPanel={onDropFolderOnPlaylistPanelCb}
      />
    );
  }, [
    isEditorOpen,
    scopedImportProgress,
    selectedPlaylist,
    selectedPlaylistStartTime,
    onPlayPlaylistNowCb,
    onQueuePlaylistCb,
    onAddSongsCb,
    onRemoveTrackCb,
    onReorderTracksCb,
    onImportFilesCb,
    onQueueTrackFromPlaylist,
    onDropTrackOnPlaylistPanelCb,
  ]);

  const handleEmptyAreaDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      if (!onDropFolderOnEmptyArea) return;

      const types = Array.from(e.dataTransfer.types);
      const hasFiles = types.includes('Files');
      const hasTrackId = types.includes('application/x-track-id');
      const hasTracks = types.includes('application/x-redio-tracks');
      if (!hasFiles || hasTrackId || hasTracks) return;

      e.preventDefault();
      e.stopPropagation();

      const items = Array.from(e.dataTransfer.items || []);

      const isDirectoryEntry = (it: DataTransferItem) => {
        try {
          const entry = (it as any).webkitGetAsEntry?.();
          return Boolean(entry && entry.isDirectory);
        } catch {
          return false;
        }
      };

      const readEntry = async (entry: any, prefix: string = '', includeSelfName: boolean = false): Promise<File[]> => {
        const out: File[] = [];
        if (!entry) return out;

        if (entry.isFile) {
          await new Promise<void>((resolve) => {
            entry.file(
              (file: File) => {
                // Clone the file to prevent the browser from detaching the Blob when DND ends
                const relPath = `${prefix}${file.name}`;
                const f = new File([file], file.name, {
                  type: file.type,
                  lastModified: file.lastModified,
                });
                try {
                  Object.defineProperty(f, 'webkitRelativePath', { value: relPath, configurable: true });
                } catch { /* ignore */ }
                
                out.push(f);
                resolve();
              },
              () => resolve(),
            );
          });
          return out;
        }

        if (entry.isDirectory) {
          const reader = entry.createReader();
          const all: any[] = [];
          for (; ;) {
            const batch: any[] = await new Promise((resolve) => {
              reader.readEntries((entries: any[]) => resolve(entries || []));
            });
            if (!batch || batch.length === 0) break;
            all.push(...batch);
          }

          const nextPrefix = includeSelfName ? `${prefix}${entry.name}/` : prefix;
          for (const child of all) {
            const childFiles = await readEntry(child, nextPrefix, true);
            out.push(...childFiles);
          }
        }

        return out;
      };

      const allowed = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);
      const isAllowed = (f: File) => {
        const name = String(f?.name || '').toLowerCase();
        const dot = name.lastIndexOf('.');
        const ext = dot >= 0 ? name.slice(dot) : '';
        return Boolean(ext && allowed.has(ext));
      };

      const hasDirectory = items.some(isDirectoryEntry);

      let folderName = '';
      if (hasDirectory) {
        const firstDir = items.map((it) => (it as any).webkitGetAsEntry?.()).find((e) => e?.isDirectory);
        folderName = String(firstDir?.name || '');
      }

      let files: File[] = [];
      if (hasDirectory) {
        for (const it of items) {
          const entry = (it as any).webkitGetAsEntry?.();
          if (!entry) continue;
          const collected = await readEntry(entry);
          files.push(...collected);
        }
      } else {
        files = Array.from(e.dataTransfer.files || []);
        if (!folderName) {
          const rel = String((files[0] as any)?.webkitRelativePath || '');
          folderName = rel ? rel.split('/').filter(Boolean)[0] || '' : '';
        }
      }

      const audioFiles = files.filter(isAllowed);
      if (audioFiles.length === 0) return;

      onDropFolderOnEmptyArea(folderName || 'Imported Folder', audioFiles);
    },
    [onDropFolderOnEmptyArea],
  );

  if (!isEditorOpen) {
    return (
      <div
        className="h-full flex bg-background"
        onDragOver={(e) => {
          const types = Array.from(e.dataTransfer.types);
          if (types.includes('Files')) e.preventDefault();
        }}
        onDrop={handleEmptyAreaDrop}
      >
        <div className="flex-1 border-r border-border">{playlistNavigatorEl}</div>
      </div>
    );
  }

  return (
    <div
      className="h-full flex bg-background overflow-hidden"
      onDragOver={(e) => {
        const types = Array.from(e.dataTransfer.types);
        if (types.includes('Files')) e.preventDefault();
      }}
      onDrop={handleEmptyAreaDrop}
    >
      <motion.div
        className="border-r border-border relative flex-shrink-0 backdrop-blur-sm bg-background/40"
        initial={false}
        animate={{ width: navPanel.width }}
        transition={{
          type: "spring",
          stiffness: 300,
          damping: 30,
          restDelta: 0.1
        }}
      >
        {playlistNavigatorEl}
      </motion.div>

      <ResizeHandle
        onMouseDown={navPanel.handleMouseDown}
        isResizing={navPanel.isResizing}
        onDoubleClick={() => setIsEditorOpen(false)}
      />

      <AnimatePresence initial={false} mode="popLayout">
        {isEditorOpen && selectedPlaylist && (
          <motion.div
            key="editor"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
            className="flex-1 min-w-0 h-full overflow-hidden bg-background"
          >
            {playlistEditorEl}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
