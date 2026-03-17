import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LibraryPanel } from './components/LibraryPanel';
import { PlaylistManager } from './components/PlaylistManager';
import { QueuePanel } from './components/QueuePanel';
import { PlaybackBar } from './components/PlaybackBar';
// import { ThemeToggle } from './components/ThemeToggle';
import { ResizeHandle } from './components/ResizeHandle';
import { FloatingQueueDialog, FloatingDialogRect } from './components/FloatingQueueDialog';
import { SchedulePlaylistDialog, ScheduleConfig } from './components/SchedulePlaylistDialog';
import { HistoryDialog } from './components/HistoryDialog';
import { SimpleBackupDialog } from './components/SimpleBackupDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Clock, ListMusic, ListOrdered, Music2, Speaker, Database, Settings, Shield, Sun, Moon, Folder } from 'lucide-react';
import { Button } from './components/ui/button';
import { useTheme } from './hooks/useTheme';
import { useResizable } from './hooks/useResizable';
import { useQueueTiming } from './hooks/useQueueTiming';
import { useAudioDevices } from './hooks/useAudioDevices';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import { useTrackOperations } from './hooks/useTrackOperations';
import { usePlaylistOperations } from './hooks/usePlaylistOperations';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from './components/ui/dropdown-menu';
import { Track, Playlist, QueueItem, ScheduledPlaylist } from './types';
import { generateId } from './lib/utils';
import { toast, Toaster } from 'sonner';
import {
  apiClient,
  foldersAPI,
  historyAPI,
  playlistsAPI,
  queueAPI,
  resolveUploadsUrl,
  schedulesAPI,
  tracksAPI,
  settingsAPI,
} from './services/api';
import { Input } from './components/ui/input';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const reduceMotion = useReducedMotion() ?? false;
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentQueueItemId, setCurrentQueueItemId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLive] = useState(true); // setIsLive removed, so it's effectively a constant
  const [scheduledPlaylists, setScheduledPlaylists] = useState<ScheduledPlaylist[]>([]);
  const [transitionMode, setTransitionMode] = useState<'gap' | 'crossfade'>('gap');
  const [gapSeconds, setGapSeconds] = useState(2);
  const [crossfadeSeconds, setCrossfadeSeconds] = useState(2);
  const effectiveTransitionSeconds = transitionMode === 'gap' ? gapSeconds : crossfadeSeconds;
  const [nowPlayingStart, setNowPlayingStart] = useState<Date | null>(null);
  const [seekAnchor, setSeekAnchor] = useState<{ seconds: number; at: Date } | null>(null);
  const [restoreSeekSeconds, setRestoreSeekSeconds] = useState<number | null>(null);
  const [gapState, setGapState] = useState<{ isInGap: boolean; gapRemainingSeconds: number }>(() => ({
    isInGap: false,
    gapRemainingSeconds: 0,
  }));
  const [scheduledGapOverride, setScheduledGapOverride] = useState<
    { nextTrack: Track; remainingSeconds: number } | null
  >(null);
  const playbackPositionSecondsRef = useRef(0);
  const historyEntryIdRef = useRef<string | null>(null);
  const historyEntryTrackIdRef = useRef<string | null>(null);
  const historyEntryPlayedAtIsoRef = useRef<string | null>(null);
  const historyEntryCreateTokenRef = useRef<number>(0);
  const historyEntryCreatePromiseRef = useRef<Promise<any> | null>(null);
  const historyLastPlayheadSecondsRef = useRef(0);
  const datetimeWarnedRef = useRef<Set<string>>(new Set());
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showBackupDialog, setShowBackupDialog] = useState(false);
  const [showFactoryResetDialog, setShowFactoryResetDialog] = useState(false);

  const [libraryImportProgress, setLibraryImportProgress] = useState<{ percent: number; label: string } | null>(null);
  const [playlistImportProgress, setPlaylistImportProgress] = useState<
    { percent: number; label: string; playlistId: string } | null
  >(null);
  const [selectedPlaylistForSchedule, setSelectedPlaylistForSchedule] = useState<Playlist | null>(null);
  const [tracksToRemove, setTracksToRemove] = useState<Set<string> | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    fileName: string;
    existingId: string;
  } | null>(null);
  const [folderDuplicatePrompt, setFolderDuplicatePrompt] = useState<{
    baseName: string;
    fileName: string;
  } | null>(null);
  const duplicateDecisionResolver = useRef<((choice: 'skip' | 'cancel' | 'add' | 'addAll') => void) | null>(null);
  const folderDuplicateDecisionResolver = useRef<((choice: 'skip' | 'cancel' | 'add' | 'addAll') => void) | null>(null);
  const [dismissedScheduleIds, setDismissedScheduleIds] = useState<string[]>([]);
  const [nowIst, setNowIst] = useState<Date | null>(null);

  const [queueDialogOpen, setQueueDialogOpen] = useState(false);
  const [queueDialogLocked, setQueueDialogLocked] = useState(false);
  const [selectedQueueItemId, setSelectedQueueItemId] = useState<string | null>(null);
  const [queueDialogRect, setQueueDialogRect] = useState<FloatingDialogRect>({
    x: 80,
    y: 80,
    width: 420,
    height: 520,
  });

  const [removePlayingTrackConfirm, setRemovePlayingTrackConfirm] = useState<string | null>(null);

  const toggleQueueDialog = () => setQueueDialogOpen((prev) => !prev);

  const [playlistNameDialog, setPlaylistNameDialog] = useState<null | {
    mode: 'create' | 'rename';
    playlistId?: string;
    name: string;
  }>(null);

  const [deletePlaylistConfirm, setDeletePlaylistConfirm] = useState<null | {
    playlistId: string;
    name: string;
    trackCount: number;
    mediaCount: number;
    scheduledCount: number;
  }>(null);

  const [recentPlaylistAdd, setRecentPlaylistAdd] = useState<
    | { playlistId: string; trackId: string; createdAt: number }
    | null
  >(null);

  // Single shared Audio Guard state for the entire app: header Output control
  // and the playback engine both use this instance.
  const audioDevices = useAudioDevices();
  const {
    devices: headerOutputDevices,
    selectedDeviceId: headerSelectedDeviceId,
    setSelectedDeviceId: setHeaderSelectedDeviceId,
    supportsOutputSelection: headerSupportsOutputSelection,
    error: headerOutputError,
    fallbackToDefault: headerFallbackToDefault,
  } = audioDevices;

  const formatIstTime = (date: Date | null) => {
    if (!date) return '--:--:-- --';
    return date
      .toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      })
      .toUpperCase();
  };

  const normalizeServerTrack = useCallback((t: any): Track => {
    return {
      id: String(t.id),
      name: String(t.name || ''),
      artist: String(t.artist || ''),
      duration: Number(t.duration || 0),
      size: Number(t.size || 0),
      filePath: resolveUploadsUrl(t.filePath || t.file_path),
      hash: String(t.hash || ''),
      dateAdded: t.date_added ? new Date(t.date_added) : new Date(),
    };
  }, []);

  const handleTrackUpdated = useCallback(
    (updatedAny: any) => {
      const updated = normalizeServerTrack(updatedAny);

      setTracks((prev) => prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));

      setPlaylists((prev) =>
        prev.map((p) => ({
          ...p,
          tracks: (p.tracks || []).map((t) => (t.id === updated.id ? { ...t, ...updated } : t)),
          duration: p.duration,
        })),
      );

      setQueue((prev) =>
        prev.map((item) =>
          item?.track?.id === updated.id
            ? {
              ...item,
              track: { ...item.track, ...updated },
            }
            : item,
        ),
      );
    },
    [normalizeServerTrack],
  );

  // useTrackOperations handles isValidUploadFile

  const getAudioDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
      try {
        const audio = new Audio();
        const url = URL.createObjectURL(file);
        audio.src = url;
        audio.addEventListener('loadedmetadata', () => {
          URL.revokeObjectURL(url);
          const d = Number(audio.duration);
          resolve(Number.isFinite(d) && d > 0 ? d : 0);
        });
        audio.addEventListener('error', () => {
          URL.revokeObjectURL(url);
          resolve(0);
        });
      } catch {
        resolve(0);
      }
    });
  };

  const hydrateTrackDurationInLibrary = (trackId: string, filePath: string) => {
    try {
      const audio = new Audio(resolveUploadsUrl(filePath));
      audio.addEventListener('loadedmetadata', () => {
        if (!isNaN(audio.duration) && audio.duration > 0) {
          setTracks((prev) =>
            prev.map((t) => (t.id === trackId ? { ...t, duration: Math.round(audio.duration) } : t))
          );
        }
      });
    } catch {
      // ignore
    }
  };

  const {
    isValidUploadFile,
    handleImportTracks,
    handleImportFolder,
  } = useTrackOperations(setTracks, setLibraryImportProgress, resolveUploadsUrl, hydrateTrackDurationInLibrary);

  const {
    handleCreatePlaylist,
    handleRenamePlaylist,
    handleDeletePlaylist,
    confirmDeletePlaylist,
    handleToggleLockPlaylist,
    setPlaylistLocked,
    handleDuplicatePlaylist,
  } = usePlaylistOperations(
    playlists,
    setPlaylists,
    setTracks,
    normalizeServerTrack,
    setPlaylistNameDialog,
    setDeletePlaylistConfirm
  );

  const handleDropTrackOnPlaylistPanel = async (playlistId: string, trackIds: string[], insertIndex: number) => {
    const playlist = playlists.find((p) => p.id === playlistId);
    if (!playlist) return;
    if (playlist.locked) {
      toast.error('Playlist is locked');
      return;
    }

    // On initial load, the in-memory `tracks` list may not be hydrated yet
    // (especially for folder-scoped items). If so, fetch missing tracks so
    // drag/drop works without requiring a page refresh.
    const tracksToAttach: Track[] = [];
    const missingIds: string[] = [];
    for (const id of trackIds) {
      const t = tracks.find((x) => x.id === id);
      if (t) {
        tracksToAttach.push(t);
      } else {
        missingIds.push(id);
      }
    }

    if (missingIds.length > 0) {
      try {
        const fetched: Track[] = [];
        for (const id of missingIds) {
          try {
            const serverTrack = await tracksAPI.getById(id);
            const normalized = normalizeServerTrack(serverTrack as any);
            fetched.push(normalized);
            tracksToAttach.push(normalized);
          } catch (err) {
            console.error('Failed to fetch track for drag/drop', id, err);
          }
        }

        if (fetched.length > 0) {
          setTracks((prev) => {
            const byId = new Map(prev.map((t) => [t.id, t] as const));
            for (const t of fetched) byId.set(t.id, t);
            return Array.from(byId.values());
          });
        }
      } catch (err) {
        console.error('Failed to hydrate tracks for drag/drop', err);
      }
    }

    if (tracksToAttach.length === 0) return;

    try {
      const beforeIds = new Set((playlist.tracks || []).map((t) => t.id));

      // Treat library drag/drop like OS file import into a playlist:
      // create playlist-local alias tracks with OS-style sequential naming so
      // same-name drops become: Name, Name (1), Name (2), ...
      const existingNames = (playlist.tracks || []).map((t) => String(t.name || '')).filter(Boolean);
      const aliasIds: string[] = [];
      for (const t of tracksToAttach) {
        const baseName = String(t.name || 'Track');
        const desiredName = getNextSequentialName(baseName, existingNames);
        try {
          const aliased = await tracksAPI.alias(t.id, desiredName);
          if (aliased?.id) {
            aliasIds.push(String(aliased.id));
            existingNames.push(String(aliased.name || desiredName));
          }
        } catch (err) {
          console.error('Failed to create alias for playlist drop', err);
        }
      }

      const idsToAdd = aliasIds.length > 0 ? aliasIds : tracksToAttach.map((t) => t.id);
      await playlistsAPI.addTracks(playlistId, idsToAdd);

      const refreshed = await playlistsAPI.getById(playlistId);
      const refreshedTracks: Track[] = (refreshed?.tracks || []).map((t: any) => normalizeServerTrack(t));

      const newOnes = refreshedTracks.filter((t) => !beforeIds.has(t.id));
      const existing = refreshedTracks.filter((t) => beforeIds.has(t.id));
      const idx = Math.min(Math.max(insertIndex ?? existing.length, 0), existing.length);
      const desiredOrder = [...existing.slice(0, idx), ...newOnes, ...existing.slice(idx)];

      // Persist desired ordering (best-effort), then refresh again.
      if (desiredOrder.length > 0) {
        try {
          await playlistsAPI.reorder(playlistId, desiredOrder.map((t) => t.id));
        } catch (err) {
          console.error('Failed to persist playlist reorder after drop', err);
        }
      }

      const finalPlaylist = await playlistsAPI.getById(playlistId);
      const finalTracks: Track[] = (finalPlaylist?.tracks || []).map((t: any) => normalizeServerTrack(t));

      setPlaylists((prev) =>
        prev.map((p) => {
          if (p.id !== playlistId) return p;
          const duration = finalTracks.reduce((sum, t) => sum + (t.duration || 0), 0);
          return { ...p, ...finalPlaylist, tracks: finalTracks, duration } as any;
        }),
      );

      setTracks((prev) => {
        const byId = new Map(prev.map((t) => [t.id, t] as const));
        for (const t of finalTracks) byId.set(t.id, t);
        return Array.from(byId.values());
      });
    } catch (err: any) {
      console.error('Failed to drop tracks on playlist panel', err);
      toast.error(err?.message || 'Failed to update playlist');
    }
  };

  const handleDuplicateDecision = (choice: 'skip' | 'cancel' | 'add' | 'addAll') => {
    const r = duplicateDecisionResolver.current;
    duplicateDecisionResolver.current = null;
    setDuplicatePrompt(null);
    if (r) r(choice);
  };

  const handleFolderDuplicateDecision = (choice: 'skip' | 'cancel' | 'add' | 'addAll') => {
    const r = folderDuplicateDecisionResolver.current;
    folderDuplicateDecisionResolver.current = null;
    setFolderDuplicatePrompt(null);
    if (r) r(choice);
  };

  const submitPlaylistNameDialog = async () => {
    const dialog = playlistNameDialog;
    if (!dialog) return;
    const name = String(dialog.name || '').trim();
    if (!name) return;

    try {
      if (dialog.mode === 'create') {
        const created = await playlistsAPI.create(name);
        setPlaylists((prev) => [...prev, created as any]);
      } else {
        if (!dialog.playlistId) return;
        const updated = await playlistsAPI.update(dialog.playlistId, { name });
        setPlaylists((prev) => prev.map((p) => (p.id === dialog.playlistId ? { ...p, name: updated.name } : p)));
      }
      setPlaylistNameDialog(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save playlist');
    }
  };

  // useTrackOperations handles handleImportTracks and handleImportFolder

  // usePlaylistOperations handles playlist actions

  const handleAddSongsToPlaylist = async (playlistId: string, tracksToAdd: Track[]) => {
    const playlist = playlists.find((p) => p.id === playlistId);
    if (!playlist) return;
    if (playlist.locked) {
      toast.error('Playlist is locked');
      return;
    }

    try {
      await playlistsAPI.addTracks(playlistId, tracksToAdd.map((t) => t.id));

      const refreshed = await playlistsAPI.getById(playlistId);
      const refreshedTracks: Track[] = (refreshed?.tracks || []).map((t: any) => normalizeServerTrack(t));
      const duration = refreshedTracks.reduce((sum, t) => sum + (t.duration || 0), 0);
      setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? ({ ...p, ...refreshed, tracks: refreshedTracks, duration } as any) : p)));

      setTracks((prev) => {
        const byId = new Map(prev.map((t) => [t.id, t] as const));
        for (const t of refreshedTracks) byId.set(t.id, t);
        return Array.from(byId.values());
      });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add songs');
    }
  };

  const handleDropFolderOnPlaylistHeader = async (playlistId: string, folderIds: string[]) => {
    const safeFolderIds = Array.isArray(folderIds) ? folderIds : [];
    if (safeFolderIds.length === 0) return;

    try {
      const results = await Promise.all(safeFolderIds.map((id) => foldersAPI.getTracks(String(id))));
      const rawTracks = results.flat().filter(Boolean) as any[];
      const normalized: Track[] = rawTracks
        .map((t: any) => ({
          id: String(t?.id || ''),
          name: String(t?.name || ''),
          artist: String(t?.artist || ''),
          duration: Number(t?.duration || 0),
          size: Number(t?.size || 0),
          filePath: resolveUploadsUrl(t?.filePath || t?.file_path),
          hash: t?.hash,
          dateAdded: t?.date_added ? new Date(t.date_added) : new Date(),
        }))
        .filter((t) => Boolean(t.id));

      // De-dupe within the dropped folder(s) so optimistic UI does not show duplicates.
      const uniqueNormalized: Track[] = Array.from(new Map(normalized.map((t) => [t.id, t] as const)).values());

      const trackIds = uniqueNormalized.map((t) => t.id);
      if (trackIds.length === 0) return;

      // Merge any missing tracks into the global library cache so downstream
      // playlist operations can resolve Track objects immediately.
      setTracks((prev) => {
        const byId = new Map(prev.map((t) => [t.id, t] as const));
        for (const t of uniqueNormalized) {
          if (!byId.has(t.id)) byId.set(t.id, t);
        }
        return Array.from(byId.values());
      });

      await playlistsAPI.addTracks(playlistId, trackIds);

      const refreshed = await playlistsAPI.getById(playlistId);
      const refreshedTracks: Track[] = (refreshed?.tracks || []).map((t: any) => normalizeServerTrack(t));
      const duration = refreshedTracks.reduce((sum, t) => sum + (t.duration || 0), 0);
      setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? ({ ...p, ...refreshed, tracks: refreshedTracks, duration } as any) : p)));

      setTracks((prev) => {
        const byId = new Map(prev.map((t) => [t.id, t] as const));
        for (const t of refreshedTracks) byId.set(t.id, t);
        return Array.from(byId.values());
      });
    } catch (err) {
      console.error('Failed to drop folder on playlist header', err);
      toast.error('Failed to add folder tracks to playlist');
    }
  };

  const handleDropFolderOnPlaylistPanel = async (playlistId: string, folderIds: string[], insertIndex: number) => {
    const safeFolderIds = Array.isArray(folderIds) ? folderIds : [];
    if (safeFolderIds.length === 0) return;

    try {
      const results = await Promise.all(safeFolderIds.map((id) => foldersAPI.getTracks(String(id))));
      const rawTracks = results.flat().filter(Boolean) as any[];
      const normalized: Track[] = rawTracks
        .map((t: any) => ({
          id: String(t?.id || ''),
          name: String(t?.name || ''),
          artist: String(t?.artist || ''),
          duration: Number(t?.duration || 0),
          size: Number(t?.size || 0),
          filePath: resolveUploadsUrl(t?.filePath || t?.file_path),
          hash: t?.hash,
          dateAdded: t?.date_added ? new Date(t.date_added) : new Date(),
        }))
        .filter((t) => Boolean(t.id));

      // De-dupe within the dropped folder(s) so optimistic UI does not show duplicates.
      const uniqueNormalized: Track[] = Array.from(new Map(normalized.map((t) => [t.id, t] as const)).values());

      const trackIds = uniqueNormalized.map((t) => t.id);
      if (trackIds.length === 0) return;

      setTracks((prev) => {
        const byId = new Map(prev.map((t) => [t.id, t] as const));
        for (const t of uniqueNormalized) {
          if (!byId.has(t.id)) byId.set(t.id, t);
        }
        return Array.from(byId.values());
      });

      const playlist = playlists.find((p) => p.id === playlistId);
      const beforeIds = new Set((playlist?.tracks || []).map((t) => t.id));

      await playlistsAPI.addTracks(playlistId, trackIds);

      const refreshed = await playlistsAPI.getById(playlistId);
      const refreshedTracks: Track[] = (refreshed?.tracks || []).map((t: any) => normalizeServerTrack(t));

      const newOnes = refreshedTracks.filter((t) => !beforeIds.has(t.id));
      const existing = refreshedTracks.filter((t) => beforeIds.has(t.id));
      const idx = Math.min(Math.max(insertIndex ?? existing.length, 0), existing.length);
      const desiredOrder = [...existing.slice(0, idx), ...newOnes, ...existing.slice(idx)];

      try {
        if (desiredOrder.length > 0) {
          await playlistsAPI.reorder(playlistId, desiredOrder.map((t) => t.id));
        }
      } catch {
        // ignore reorder errors
      }

      const finalPlaylist = await playlistsAPI.getById(playlistId);
      const finalTracks: Track[] = (finalPlaylist?.tracks || []).map((t: any) => normalizeServerTrack(t));
      const duration = finalTracks.reduce((sum, t) => sum + (t.duration || 0), 0);

      setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? ({ ...p, ...finalPlaylist, tracks: finalTracks, duration } as any) : p)));

      setTracks((prev) => {
        const byId = new Map(prev.map((t) => [t.id, t] as const));
        for (const t of finalTracks) byId.set(t.id, t);
        return Array.from(byId.values());
      });
    } catch (err) {
      console.error('Failed to drop folder on playlist panel', err);
      toast.error('Failed to add folder tracks to playlist');
    }
  };

  const handleRemoveFromQueue = async (id: string) => {
    // If trying to remove the currently playing track, show confirmation
    if (id === currentQueueItemId) {
      setRemovePlayingTrackConfirm(id);
      return;
    }

    // Optimistic UI update: remove immediately without waiting for API
    setQueue((prev) => prev.filter((q) => q.id !== id));

    // Update current item if needed
    if (currentQueueItemId === id) {
      const remaining = queue.filter((q) => q.id !== id);
      setCurrentQueueItemId(remaining[0]?.id ?? null);
    }

    // Fire-and-forget API call in background
    queueAPI.remove(id).catch(() => {
      // Silently ignore API errors; UI already reflects the change
    });
  };

  const confirmRemovePlayingTrack = async () => {
    const id = removePlayingTrackConfirm;
    if (!id) return;
    setRemovePlayingTrackConfirm(null);

    // Optimistic UI update: remove immediately
    setQueue((prev) => prev.filter((q) => q.id !== id));
    const remaining = queue.filter((q) => q.id !== id);
    setCurrentQueueItemId(remaining[0]?.id ?? null);

    // Fire-and-forget API call
    queueAPI.remove(id).catch(() => {
      // Silently ignore API errors
    });
  };

  const handleReorderQueue = async (items: QueueItem[]) => {
    setQueue(items);
    try {
      await queueAPI.reorder(items.map((i) => i.id));
    } catch (err) {
      console.error('Failed to reorder queue', err);
    }
  };

  const handleAddQueueItemToPlaylist = async (item: QueueItem, playlistId: string) => {
    if (!item?.track) return;
    await handleAddToPlaylist(item.track, playlistId, true);
  };

  const prevQueueLengthRef = useRef(0);

  const handleSeekWithTiming = (seconds: number) => {
    if (!currentTrack) return;
    setSeekAnchor({ seconds, at: new Date() });
  };

  const handlePlaybackProgress = (seconds: number) => {
    playbackPositionSecondsRef.current = seconds;
    // Keep a monotonic playhead snapshot for history logging.
    // The audio engine resets the UI time to 0 at ended while waiting for the
    // next track; we must not overwrite the final playhead with 0.
    if (Number.isFinite(seconds) && seconds > historyLastPlayheadSecondsRef.current) {
      historyLastPlayheadSecondsRef.current = seconds;
    }
  };

  const PLAYBACK_SNAPSHOT_KEY = 'redio.playback.snapshot.v1';
  const hasRestoredPlaybackSnapshotRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const id = window.setInterval(() => {
      try {
        const snapshot = {
          v: 1,
          at: Date.now(),
          currentQueueItemId,
          isPlaying,
          positionSeconds: Number(playbackPositionSecondsRef.current) || 0,
        };
        window.localStorage.setItem(PLAYBACK_SNAPSHOT_KEY, JSON.stringify(snapshot));
      } catch {
        // ignore
      }
    }, 1000);

    return () => {
      window.clearInterval(id);
    };
  }, [currentQueueItemId, isPlaying]);

  const finalizePlaybackHistory = useCallback(
    async (
      track: Track,
      options?: {
        completed?: boolean;
        source?: string;
        playedAtOverride?: string;
        endTimestampOverride?: Date;
      },
    ) => {
      const source = options?.source ?? 'queue';
      const completed = options?.completed ?? true;

      // Use the top-center clock for end time, or override if provided
      const endTimestamp = options?.endTimestampOverride ?? (nowIst ?? new Date());

      // Get the original start timestamp from when we created the history entry
      const baseStart = options?.playedAtOverride
        ? new Date(options.playedAtOverride)
        : historyEntryPlayedAtIsoRef.current
          ? new Date(historyEntryPlayedAtIsoRef.current)
          : nowPlayingStart ?? endTimestamp;

      // Calculate elapsed time based on the actual elapsed time from the top-center clock
      const elapsedMs = endTimestamp.getTime() - baseStart.getTime();
      const elapsedSeconds = Math.max(0, Math.round(elapsedMs / 1000));

      // Prefer playhead seconds if available, but ensure it's not greater than elapsed time.
      // NOTE: For naturally completed tracks we intentionally include the configured
      // Gap (silence) time before advancing, so history reflects the broadcast clock.
      const playheadSeconds = Math.max(
        0,
        Math.min(
          elapsedSeconds,
          historyLastPlayheadSecondsRef.current || playbackPositionSecondsRef.current || 0,
        ),
      );

      const positionEnd = Math.max(1, completed ? elapsedSeconds : playheadSeconds || elapsedSeconds);

      // If the row creation is still in-flight for this track, wait for it so we can UPDATE
      // instead of leaving position_end at 0 (which renders as '-').
      if (!historyEntryIdRef.current && historyEntryCreatePromiseRef.current && historyEntryTrackIdRef.current === track.id) {
        try {
          const entry = await historyEntryCreatePromiseRef.current;
          historyEntryIdRef.current = entry?.id ?? null;
        } catch {
          // ignore: we'll fall back to create below
        } finally {
          historyEntryCreatePromiseRef.current = null;
        }
      }

      const historyId = historyEntryIdRef.current;

      // Clear refs so the next track starts a new row.
      historyEntryIdRef.current = null;
      historyEntryTrackIdRef.current = null;
      historyEntryPlayedAtIsoRef.current = null;
      historyLastPlayheadSecondsRef.current = 0;
      historyEntryCreatePromiseRef.current = null;
      historyEntryCreateTokenRef.current += 1;

      try {
        if (historyId) {
          // Update with the precise end timestamp from top-center clock
          await historyAPI.update(historyId, { positionEnd, completed });
          console.log(`History updated: track ${track.name}, end time: ${endTimestamp.toISOString()}, position: ${positionEnd}s`);
          window.dispatchEvent(new Event('redio:history-changed'));
          return;
        }

        // Fallback: if we never got an ID (network error), write a standalone row.
        await historyAPI.create({
          trackId: track.id,
          playedAt: baseStart.toISOString(),
          positionStart: 0,
          positionEnd,
          completed,
          source,
          fileStatus: 'ok',
        });
        console.log(`History created: track ${track.name}, start: ${baseStart.toISOString()}, end: ${endTimestamp.toISOString()}, position: ${positionEnd}s`);
        window.dispatchEvent(new Event('redio:history-changed'));
      } catch (error) {
        console.error('Failed to finalize playback history', error);
      }
    },
    [nowIst, nowPlayingStart],
  );

  const leftPanel = useResizable({ initialWidth: 420, minWidth: 320, maxWidth: 640 });
  const rightPanel = useResizable({ initialWidth: 320, minWidth: 250, maxWidth: 500, direction: 'rtl' }); // rightPanel is unused

  const LIBRARY_RAIL_WIDTH = 52;
  const [isLibraryPanelOpen, setIsLibraryPanelOpen] = useState(true);

  const toggleLibraryPanel = useCallback(() => {
    setIsLibraryPanelOpen((prev) => !prev);
  }, []);

  const currentQueueItem = currentQueueItemId
    ? queue.find((item) => item.id === currentQueueItemId) || null
    : null;
  const currentTrack = currentQueueItem?.track || null;
  const currentTrackId = currentTrack?.id ?? null;
  const currentTrackRef = useRef<Track | null>(null);
  const currentTrackIdRef = useRef<string | null>(null);
  const currentQueueItemIdRef = useRef<string | null>(null);
  const nowPlayingStartRef = useRef<Date | null>(null);
  const transitionModeRef = useRef<'gap' | 'crossfade'>('gap');
  const gapSecondsRef = useRef<number>(2);
  const preemptTokenRef = useRef(0);
  const preemptTimerRef = useRef<number | null>(null);
  const scheduledGapTimerRef = useRef<number | null>(null);
  const hasLiveQueueRef = useRef(false);
  const pinnedQueueItemIdRef = useRef<string | null>(null); // pinnedQueueItemIdRef is unused

  // Determine the next track in the queue for crossfade/preview logic.
  const currentIndex = currentQueueItemId
    ? queue.findIndex((item) => item.id === currentQueueItemId)
    : -1;
  const nextTrack = (() => {
    if (queue.length === 0) return null;
    if (currentIndex >= 0 && currentIndex < queue.length - 1) {
      return queue[currentIndex + 1].track;
    }
    return null;
  })();

  const pendingNextQueueItemId =
    gapState.isInGap && currentIndex >= 0 && currentIndex < queue.length - 1
      ? queue[currentIndex + 1].id
      : null;

  // Keep a single authoritative notion of "what is the current queue item".
  // This guarantees that when the queue transitions from empty -> non-empty
  // (e.g. a track is added), the Playback Bar updates immediately.
  useEffect(() => {
    setCurrentQueueItemId((prev) => {
      if (queue.length === 0) return null;
      const headId = queue[0]?.id ?? null;
      if (!prev) return headId;
      return queue.some((q) => q.id === prev) ? prev : headId;
    });
  }, [queue]);

  useEffect(() => {
    setRestoreSeekSeconds(null);
  }, [currentTrackId]);

  const timing = useQueueTiming({
    queue,
    currentTrack,
    currentQueueItemId,
    isPlaying,
    nowPlayingStart,
    transitionMode,
    gapSeconds,
    crossfadeSeconds: effectiveTransitionSeconds,
    seekAnchor,
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const payload = await settingsAPI.getAll();
        if (cancelled) return;

        const modeRaw = String(payload?.settings?.['playback.transition_mode'] || 'gap');
        const mode = modeRaw === 'crossfade' ? 'crossfade' : 'gap';

        const gapRaw = Number(payload?.settings?.['playback.gap_seconds'] ?? 2);
        const cfRaw = Number(payload?.settings?.['playback.crossfade_seconds'] ?? 2);

        setTransitionMode(mode);
        setGapSeconds(Number.isFinite(gapRaw) ? Math.min(12, Math.max(0, Math.round(gapRaw))) : 2);
        setCrossfadeSeconds(Number.isFinite(cfRaw) ? Math.min(12, Math.max(0, Math.round(cfRaw))) : 2);
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const settingsSaveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (settingsSaveTimerRef.current != null) {
      window.clearTimeout(settingsSaveTimerRef.current);
    }

    settingsSaveTimerRef.current = window.setTimeout(() => {
      settingsSaveTimerRef.current = null;
      void settingsAPI.update({
        'playback.transition_mode': transitionMode,
        'playback.gap_seconds': gapSeconds,
        'playback.crossfade_seconds': crossfadeSeconds,
      });
    }, 400);

    return () => {
      if (settingsSaveTimerRef.current != null) {
        window.clearTimeout(settingsSaveTimerRef.current);
        settingsSaveTimerRef.current = null;
      }
    };
  }, [transitionMode, gapSeconds, crossfadeSeconds]);

  const handleDropTrackOnPlaylistHeader = async (playlistId: string, trackIds: string[]) => {
    for (const trackId of trackIds) {
      const track = tracks.find((t) => t.id === trackId);
      if (track) {
        await handleAddToPlaylist(track, playlistId, true);
      }
    }
  };

  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const getNextSequentialName = (baseName: string, existingNames: string[]): string => {
    const pattern = new RegExp(`^${escapeRegExp(baseName)}(?: \\((\\d+)\\))?$`);
    const used = new Set<number>();
    let baseTaken = false;

    for (const name of existingNames) {
      const m = name.match(pattern);
      if (!m) continue;
      if (!m[1]) {
        baseTaken = true;
        continue;
      }
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 1) used.add(n);
    }

    if (!baseTaken) return baseName;
    let i = 1;
    while (used.has(i)) i += 1;
    return `${baseName} (${i})`;
  };

  const handleAddToPlaylist = async (track: Track, playlistId: string, fromDragDrop = false) => {
    const playlist = playlists.find((p) => p.id === playlistId);
    if (!playlist) return;
    if (playlist.locked) {
      toast.error('Playlist is locked');
      return;
    }

    try {
      await playlistsAPI.addTracks(playlistId, [track.id]);

      // Refresh playlist from server so we pick up the playlist-owned track copies
      // (new IDs + file paths) created by the backend.
      const refreshed = await playlistsAPI.getById(playlistId);
      const refreshedTracks: Track[] = (refreshed?.tracks || []).map((t: any) => normalizeServerTrack(t));

      setPlaylists((prev) =>
        prev.map((p) => {
          if (p.id !== playlistId) return p;
          const duration = refreshedTracks.reduce((sum, t) => sum + (t.duration || 0), 0);
          return { ...p, ...refreshed, tracks: refreshedTracks, duration } as any;
        }),
      );

      // Merge any newly created playlist-owned tracks into the global cache.
      setTracks((prev) => {
        const byId = new Map(prev.map((t) => [t.id, t] as const));
        for (const t of refreshedTracks) byId.set(t.id, t);
        return Array.from(byId.values());
      });

      if (fromDragDrop) {
        const lastAdded = refreshedTracks[refreshedTracks.length - 1];
        if (lastAdded) {
          setRecentPlaylistAdd({ playlistId, trackId: lastAdded.id, createdAt: Date.now() });
        }
      }

      toast.success(`Added to "${playlist.name}"`);
    } catch (error: any) {
      console.error('Failed to add track to playlist', error);
      toast.error(error?.message || 'Failed to add track to playlist');
    }
  };

  // Finalize history when user closes the browser to ensure accurate end time
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location?.protocol === 'file:') return;

    const finalizeHistoryOnUnload = () => {
      if (historyEntryIdRef.current && currentTrackRef.current) {
        // Use the finalizePlaybackHistory function for consistent end timestamp handling
        const endTime = new Date();
        void finalizePlaybackHistory(currentTrackRef.current, {
          completed: false,
          source: 'queue',
          endTimestampOverride: endTime,
        }).catch(() => {
          // Ignore errors during unload
        });
      }
    };

    const handler = (e: BeforeUnloadEvent) => {
      finalizeHistoryOnUnload();
      e.preventDefault();
      e.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handler);

    const onKeyDown = (e: KeyboardEvent) => {
      const key = String(e.key || '').toLowerCase();
      const isReload = key === 'f5' || ((e.metaKey || e.ctrlKey) && key === 'r');
      if (!isReload) return;
      e.preventDefault();
      const ok = window.confirm('Reloading or closing will interrupt playback. Continue?');
      if (ok) {
        window.location.reload();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    // Also handle pagehide event for better mobile support
    const handlePageHide = () => {
      finalizeHistoryOnUnload();
    };
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.removeEventListener('beforeunload', handler);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [finalizePlaybackHistory]);

  // Keep a lightweight clock for display in the top bar
  useEffect(() => {
    const update = () => {
      setNowIst(new Date());
    };

    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Auto-dismiss the Scheduled panel a few seconds after there are no
  // visible schedules left, so the UI does not stay cluttered.
  useEffect(() => {
    const pendingCount = scheduledPlaylists.filter((s) => s.status === 'pending').length;

    // Only auto-hide once there are schedules in history but none pending.
    if (scheduledPlaylists.length === 0 || pendingCount > 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDismissedScheduleIds((prev) => {
        const allIds = scheduledPlaylists.map((s) => s.id);
        const merged = Array.from(new Set([...prev, ...allIds]));
        return merged;
      });
    }, 1000);

    return () => window.clearTimeout(timeoutId);
  }, [scheduledPlaylists]);

  const resyncAll = async () => {
    try {
      const serverTracks = await tracksAPI.getAll();
      const mapped: Track[] = (serverTracks as any[]).map((t: any) => ({
        id: t.id,
        name: t.name,
        artist: t.artist,
        duration: t.duration,
        size: t.size,
        filePath: resolveUploadsUrl(t.filePath || t.file_path),
        hash: t.hash,
        dateAdded: t.date_added ? new Date(t.date_added) : new Date(),
      }));
      setTracks(mapped);
    } catch (error: any) {
      console.error('Failed to resync tracks', error);
    }

    try {
      const serverPlaylists = await playlistsAPI.getAll();
      const mapped: Playlist[] = (serverPlaylists as any[]).map((p: any) => {
        const mappedTracks: Track[] = (p.tracks || []).map((t: any) => ({
          id: t.id,
          name: t.name,
          artist: t.artist,
          duration: t.duration,
          size: t.size,
          filePath: resolveUploadsUrl(t.filePath || t.file_path),
          hash: t.hash,
          dateAdded: t.date_added
            ? new Date(t.date_added)
            : t.created_at
              ? new Date(t.created_at)
              : new Date(),
        }));

        return {
          id: p.id,
          name: p.name,
          tracks: mappedTracks,
          locked: Boolean(p.locked),
          createdAt: p.created_at ? new Date(p.created_at) : new Date(),
          duration: p.duration ?? mappedTracks.reduce((sum, t) => sum + t.duration, 0),
        } as Playlist;
      });
      setPlaylists(mapped);
    } catch (error: any) {
      console.error('Failed to resync playlists', error);
    }

    try {
      const serverQueue = await queueAPI.get();
      const normalized: QueueItem[] = (serverQueue as any[]).map((item) => {
        const track = item?.track;
        if (!track) return item;
        return {
          ...item,
          track: {
            ...track,
            filePath: resolveUploadsUrl(track.filePath || track.file_path),
          },
        };
      });
      setQueue(normalized);

      const headId = normalized[0]?.id ?? null;

      // Restore playback state once on app load, prioritizing backend settings over localStorage.
      if (!hasRestoredPlaybackSnapshotRef.current) {
        hasRestoredPlaybackSnapshotRef.current = true;

        try {
          const settingsPayload = await settingsAPI.getAll();
          const backendId = settingsPayload?.settings?.['playback.current_item_id'];
          const backendIsPlaying = settingsPayload?.settings?.['playback.is_playing'] === 'true';
          const backendPos = Number(settingsPayload?.settings?.['playback.position_seconds'] || 0);

          const raw = window.localStorage.getItem(PLAYBACK_SNAPSHOT_KEY);
          const parsed = raw ? JSON.parse(raw) : null;

          const desiredId = backendId || (typeof parsed?.currentQueueItemId === 'string' ? parsed.currentQueueItemId : null);
          const desiredIsPlaying = backendId ? backendIsPlaying : Boolean(parsed?.isPlaying);
          const desiredPos = backendId ? backendPos : Number(parsed?.positionSeconds || 0);

          if (desiredId && normalized.some((q) => q.id === desiredId)) {
            setCurrentQueueItemId(desiredId);
            setIsPlaying(desiredIsPlaying);
            setRestoreSeekSeconds(Number.isFinite(desiredPos) ? Math.max(0, desiredPos) : null);
            setSeekAnchor(
              Number.isFinite(desiredPos) && desiredPos > 0 ? { seconds: Math.max(0, desiredPos), at: new Date() } : null,
            );
          } else {
            setCurrentQueueItemId(headId);
            setIsPlaying(false);
          }
        } catch (err) {
          console.error('Failed to restore playback state from backend', err);
          setCurrentQueueItemId(headId);
          setIsPlaying(false);
        }
      } else {
        setCurrentQueueItemId((prev) => {
          if (!prev) return headId;
          return normalized.some((q) => q.id === prev) ? prev : headId;
        });
      }
    } catch (error) {
      console.error('Failed to resync queue', error);
    }

    try {
      const serverSchedules = await schedulesAPI.getAll();
      const mapped: ScheduledPlaylist[] = (serverSchedules as any[]).map((s: any) => ({
        id: s.id,
        playlistId: s.playlist_id ?? s.playlistId,
        playlistName: String(s.playlist_name ?? s.playlistName ?? ''),
        type: s.type,
        dateTime: s.date_time ? new Date(s.date_time) : s.dateTime ? new Date(s.dateTime) : undefined,
        queueSongId: s.queue_song_id ?? s.queueSongId ?? undefined,
        triggerPosition: (s.trigger_position ?? s.triggerPosition) as any,
        lockPlaylist: Boolean(s.lock_playlist ?? s.lockPlaylist),
        status: s.status as ScheduledPlaylist['status'],
      }));
      setScheduledPlaylists(mapped);
    } catch (error) {
      console.error('Failed to resync schedules', error);
    }
  };

  // Load tracks from backend so library reflects database
  useEffect(() => {
    void resyncAll();
  }, []);

  // Allow other components to request a resync (e.g. after restore)
  useEffect(() => {
    const onResync = () => void resyncAll();
    window.addEventListener('redio:resync', onResync);
    return () => window.removeEventListener('redio:resync', onResync);
  }, []);

  // Keep refs in sync with the latest current track so the WebSocket
  // handlers can safely reason about preemption.
  useEffect(() => {
    currentTrackRef.current = currentTrack;
    currentTrackIdRef.current = currentTrackId;
    currentQueueItemIdRef.current = currentQueueItemId;
    nowPlayingStartRef.current = nowPlayingStart;
    transitionModeRef.current = transitionMode;
    gapSecondsRef.current = gapSeconds;
  }, [currentTrack, currentTrackId, currentQueueItemId, nowPlayingStart]);

  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const pendingRestoreResyncRef = useRef(false);
  useEffect(() => {
    if (isPlaying) return;
    if (!pendingRestoreResyncRef.current) return;
    pendingRestoreResyncRef.current = false;
    void resyncAll();
    window.dispatchEvent(new Event('redio:library-resync'));
  }, [isPlaying]);

  // Sync playback state TO backend when it changes locally
  const lastPushedPlaybackStateRef = useRef<{ id: string | null; playing: boolean }>({ id: null, playing: false });
  useEffect(() => {
    if (!hasRestoredPlaybackSnapshotRef.current) return;

    if (
      lastPushedPlaybackStateRef.current.id === currentQueueItemId &&
      lastPushedPlaybackStateRef.current.playing === isPlaying
    ) {
      return;
    }

    lastPushedPlaybackStateRef.current = { id: currentQueueItemId, playing: isPlaying };

    const updates: Record<string, string> = {
      'playback.current_item_id': currentQueueItemId || '',
      'playback.is_playing': String(isPlaying),
    };

    // Also include position if we're pausing, to ensure resume works well
    if (!isPlaying) {
      updates['playback.position_seconds'] = String(Math.floor(playbackPositionSecondsRef.current || 0));
    }

    void settingsAPI.update(updates).catch(err => {
      console.error('Failed to push playback state to backend', err);
    });
  }, [currentQueueItemId, isPlaying]);

  // WebSocket connection for real-time events.
  // If VITE_WS_URL is not set, default to the local backend WS endpoint
  // so that scheduler-driven queue updates still reach the frontend.
  useEffect(() => {
    const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
    const wsUrl = envUrl || 'ws://127.0.0.1:3001/ws';

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;
    let stopped = false;

    const resync = async () => {
      try {
        const serverQueue = await queueAPI.get();
        const normalized: QueueItem[] = (serverQueue as any[]).map((item) => {
          const track = item?.track;
          if (!track) return item;
          return {
            ...item,
            track: {
              ...track,
              filePath: resolveUploadsUrl(track.filePath || track.file_path),
            },
          };
        });
        setQueue(normalized);

        const headId = normalized[0]?.id ?? null;
        setCurrentQueueItemId((prev) => {
          if (!prev) return headId;
          return normalized.some((q) => q.id === prev) ? prev : headId;
        });
      } catch (error) {
        console.error('Failed to resync queue', error);
      }

      try {
        const serverSchedules = await schedulesAPI.getAll();
        const mapped: ScheduledPlaylist[] = (serverSchedules as any[]).map((s: any) => ({
          id: s.id,
          playlistId: s.playlist_id ?? s.playlistId,
          playlistName: s.playlist_name ?? s.playlistName,
          type: s.type as ScheduledPlaylist['type'],
          dateTime: s.date_time ? new Date(s.date_time) : s.dateTime ? new Date(s.dateTime) : undefined,
          queueSongId: s.queue_song_id ?? s.queueSongId ?? undefined,
          triggerPosition: s.trigger_position ?? s.triggerPosition ?? undefined,
          lockPlaylist: Boolean(s.lock_playlist ?? s.lockPlaylist),
          status: s.status as ScheduledPlaylist['status'],
        }));
        setScheduledPlaylists(mapped);
      } catch (error) {
        console.error('Failed to resync schedules', error);
      }
    };

    const scheduleReconnect = () => {
      if (stopped) return;
      if (reconnectTimer != null) return;
      const delay = Math.min(10000, 500 * Math.pow(2, reconnectAttempt));
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        reconnectAttempt = Math.min(reconnectAttempt + 1, 6);
        connect();
      }, delay);
    };

    const connect = () => {
      if (stopped) return;
      try {
        socket?.close();
      } catch {
        // ignore
      }

      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        reconnectAttempt = 0;
        console.log('WebSocket connected:', wsUrl);
        hasLiveQueueRef.current = true;
        void resync();
      };

      socket.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'database-restored') {
            if (isPlayingRef.current) {
              pendingRestoreResyncRef.current = true;
              return;
            }
            void resyncAll();
            window.dispatchEvent(new Event('redio:library-resync'));
            return;
          }
          if (data.type === 'library-updated') {
            window.dispatchEvent(new Event('redio:library-resync'));
            return;
          }
          if (data.type === 'playlist-locked' && data.playlistId) {
            const locked = Boolean(data.locked);
            setPlaylists((prev) =>
              prev.map((p) => (p.id === data.playlistId ? { ...p, locked } : p)),
            );
            return;
          }
          if (data.type === 'tracksDeleted' && Array.isArray(data.trackIds)) {
            const idsToRemove = new Set(data.trackIds);

            // Remove from main library
            setTracks((prev) => prev.filter((t) => !idsToRemove.has(t.id)));

            // Remove from playlists (queue cascade happens server-side and broadcasts 'queue-updated')
            setPlaylists((prev) =>
              prev.map((p) => {
                const newTracks = (p.tracks || []).filter((t) => !idsToRemove.has(t.id));
                return {
                  ...p,
                  tracks: newTracks,
                  duration: newTracks.reduce((sum, t) => sum + (t.duration || 0), 0),
                };
              })
            );
            return;
          }
          if (data.type === 'playlistsUpdated') {
            void resyncAll();
            // Also refresh schedules to clear any fired/deleted schedules from UI
            void (async () => {
              try {
                const serverSchedules = await schedulesAPI.getAll();
                const mapped: ScheduledPlaylist[] = (serverSchedules as any[]).map((s: any) => ({
                  id: s.id,
                  playlistId: s.playlist_id ?? s.playlistId,
                  playlistName: s.playlist_name ?? s.playlistName,
                  type: s.type as ScheduledPlaylist['type'],
                  dateTime: s.date_time ? new Date(s.date_time) : s.dateTime ? new Date(s.dateTime) : undefined,
                  queueSongId: s.queue_song_id ?? s.queueSongId ?? undefined,
                  triggerPosition: s.trigger_position ?? s.triggerPosition ?? undefined,
                  lockPlaylist: Boolean(s.lock_playlist ?? s.lockPlaylist),
                  status: s.status as ScheduledPlaylist['status'],
                }));
                setScheduledPlaylists(mapped);
              } catch (error) {
                console.error('Failed to refresh schedules on playlistsUpdated', error);
              }
            })();
            return;
          }
          if (data.type === 'schedule-deleted') {
            const deletedId = data.scheduleId;
            setScheduledPlaylists((prev) => prev.filter((s) => s.id !== deletedId));
            return;
          }
          if (data.type === 'schedule-pre-fire') {
            console.log('[Scheduler] Received schedule-pre-fire event');

            // 1. Force state cleanup
            setRestoreSeekSeconds(null);
            setSeekAnchor(null);

            if (isPlayingRef.current && currentTrackRef.current) {
              const track = currentTrackRef.current;
              console.log(`[Scheduler] Overriding current track: ${track.name}`);
              // 2. Finalize history for the current track
              void finalizePlaybackHistory(track, { completed: false });
              // 3. Stop playback immediately to allow for the 2s gap
              setIsPlaying(false);
              setCurrentQueueItemId(null);
            } else {
              // Even if not playing, ensure we are ready for the new tracks
              setIsPlaying(false);
              setCurrentQueueItemId(null);
            }
            return;
          }
          if (data.type === 'playback-state-updated' && data.settings) {
            const backendId = data.settings['playback.current_item_id'];
            const backendIsPlaying = data.settings['playback.is_playing'] === 'true';
            const backendPos = data.settings['playback.position_seconds'];

            if (backendId !== undefined && backendId !== currentQueueItemIdRef.current) {
              setCurrentQueueItemId(backendId);
            }
            if (backendIsPlaying !== undefined && backendIsPlaying !== isPlayingRef.current) {
              setIsPlaying(backendIsPlaying);
            }
            if (backendPos !== undefined) {
              const seconds = Number(backendPos);
              if (Number.isFinite(seconds)) {
                setRestoreSeekSeconds(seconds);
                setSeekAnchor({ seconds, at: new Date() });
              }
            }
            return;
          }
          if (data.type === 'queue-updated' && Array.isArray(data.queue)) {
            const newQueue: QueueItem[] = (data.queue as any[]).map((item) => {
              const track = item?.track;
              if (!track) return item;
              return {
                ...item,
                track: {
                  ...track,
                  filePath: resolveUploadsUrl(track.filePath || track.file_path),
                },
              };
            });

            const previousCurrentId = currentQueueItemIdRef.current;
            // const wasCurrentStillPresent = previousCurrentId // wasCurrentStillPresent is unused
            //   ? newQueue.some((item) => item.id === previousCurrentId)
            //   : false;

            setQueue(newQueue);

            const firstQueueItemId = newQueue[0]?.id ?? null;

            if (data.reason === 'schedule-preempt' && firstQueueItemId) {
              // Cancel any in-flight preempt timers.
              if (preemptTimerRef.current != null) {
                window.clearTimeout(preemptTimerRef.current);
                preemptTimerRef.current = null;
              }
              if (scheduledGapTimerRef.current != null) {
                window.clearInterval(scheduledGapTimerRef.current);
                scheduledGapTimerRef.current = null;
              }
              setScheduledGapOverride(null);
              // const preemptToken = ++preemptTokenRef.current; // preemptToken is unused

              // Force the new first item to be current and start playing.
              setCurrentQueueItemId(firstQueueItemId);
              setIsPlaying(true);

              // Refresh schedules immediately to clear the UI state
              void (async () => {
                try {
                  const serverSchedules = await schedulesAPI.getAll();
                  const mapped: ScheduledPlaylist[] = (serverSchedules as any[]).map((s: any) => ({
                    id: s.id,
                    playlistId: s.playlist_id ?? s.playlistId,
                    playlistName: s.playlist_name ?? s.playlistName,
                    type: s.type as ScheduledPlaylist['type'],
                    dateTime: s.date_time ? new Date(s.date_time) : s.dateTime ? new Date(s.dateTime) : undefined,
                    queueSongId: s.queue_song_id ?? s.queueSongId ?? undefined,
                    triggerPosition: s.trigger_position ?? s.triggerPosition ?? undefined,
                    lockPlaylist: Boolean(s.lock_playlist ?? s.lockPlaylist),
                    status: s.status as ScheduledPlaylist['status'],
                  }));
                  setScheduledPlaylists(mapped);
                } catch (error) {
                  console.error('Failed to refresh schedules on schedule-preempt', error);
                }
              })();
              return;
            }

            // If we just received a standard queue update and the first item is new (scheduled),
            // ensure it starts playing if we were previously in a pre-fire pause.
            if (firstQueueItemId && !isPlayingRef.current && !currentQueueItemIdRef.current) {
              setCurrentQueueItemId(firstQueueItemId);
              setIsPlaying(true);
            }
          }
        } catch (error) {
          console.error('Failed to handle WebSocket message', error);
        }
      };

      socket.onclose = () => {
        console.log('WebSocket disconnected:', wsUrl);
        hasLiveQueueRef.current = false;
        scheduleReconnect();
      };

      socket.onerror = (event) => {
        console.error('WebSocket error:', event);
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      stopped = true;
      socket?.close();
    };
  }, []);

  // Load tracks from backend so library reflects database
  useEffect(() => {
    void resyncAll();
  }, []);

  // Allow other components to request a resync (e.g. after restore)
  useEffect(() => {
    const onResync = () => void resyncAll();
    window.addEventListener('redio:resync', onResync);
    return () => window.removeEventListener('redio:resync', onResync);
  }, []);

  // Keep refs in sync with the latest current track so the WebSocket
  // handlers can safely reason about preemption.
  useEffect(() => {
    currentTrackRef.current = currentTrack;
    currentTrackIdRef.current = currentTrackId;
    currentQueueItemIdRef.current = currentQueueItemId;
    nowPlayingStartRef.current = nowPlayingStart;
  }, [currentTrack, currentTrackId, currentQueueItemId, nowPlayingStart]);

  const handleRemoveTrackFromPlaylist = async (playlistId: string, trackId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist || playlist.locked) return;

    const previousPlaylists = playlists;

    // Optimistically remove track from playlist in UI
    setPlaylists(prev => prev.map(p => {
      if (p.id === playlistId) {
        const newTracks = p.tracks.filter(t => t.id !== trackId);
        return {
          ...p,
          tracks: newTracks,
          duration: newTracks.reduce((sum, t) => sum + t.duration, 0),
        };
      }
      return p;
    }));

    try {
      await playlistsAPI.removeTrack(playlistId, trackId);
    } catch (error: any) {
      console.error('Failed to remove track from playlist', error);
      // Roll back optimistic removal
      setPlaylists(previousPlaylists);
      toast.error(error.message || 'Failed to remove track from playlist');
    }
  };

  const handleReorderPlaylistTracks = async (playlistId: string, newTracks: Track[]) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;

    const previousPlaylists = playlists;

    // Optimistically update local order
    setPlaylists(prev => prev.map(p =>
      p.id === playlistId ? { ...p, tracks: newTracks } : p
    ));

    try {
      const trackIds = newTracks.map(t => t.id);
      await playlistsAPI.reorder(playlistId, trackIds);
      // No further state update needed; UI already matches desired order
    } catch (error: any) {
      console.error('Failed to reorder playlist', error);
      // Roll back to previous order
      setPlaylists(previousPlaylists);
      toast.error(error.message || 'Failed to reorder playlist');
    }
  };

  const handlePlayPlaylistNow = (playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist || playlist.tracks.length === 0) return;

    const insertItems: QueueItem[] = playlist.tracks.map((track, index) => ({
      id: generateId(),
      track,
      fromPlaylist: playlist.name,
      order: index,
    }));

    // If there is a current track in the queue, insert right after it.
    if (currentQueueItemId) {
      const currentIndex = queue.findIndex(item => item.id === currentQueueItemId);
      if (currentIndex !== -1) {
        const before = queue.slice(0, currentIndex + 1);
        const after = queue.slice(currentIndex + 1);
        setQueue([...before, ...insertItems, ...after]);
        return;
      }
    }

    // Otherwise, insert playlist at the top and make its first track current.
    setQueue([...insertItems, ...queue]);
    setCurrentQueueItemId(insertItems[0]?.id ?? null);
    // Do not toggle isPlaying; user presses play.
  };

  const handleQueuePlaylist = async (playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist || playlist.tracks.length === 0) return;

    const wasEmpty = queue.length === 0;
    const createdItems: QueueItem[] = [];

    try {
      // Queue all tracks from the playlist, allowing duplicates in the queue
      for (const track of playlist.tracks) {
        const item = await queueAPI.add(track.id, playlist.name);
        const normalized: QueueItem = item?.track
          ? {
            ...item,
            track: {
              ...item.track,
              filePath: resolveUploadsUrl(item.track.filePath || (item.track as any).file_path),
            },
          }
          : (item as any);
        createdItems.push(normalized);
      }

      if (createdItems.length > 0) {
        // Avoid double-adding when WebSocket is live; rely on backend
        // queue-updated broadcast. Fall back to optimistic local update
        // only when WS is not connected.
        if (!hasLiveQueueRef.current) {
          setQueue(prev => [...prev, ...createdItems]);
          if (wasEmpty && !currentQueueItemId) {
            setCurrentQueueItemId(createdItems[0].id);
          }
        }
        toast.success(`Queued playlist "${playlist.name}"`, {
          description: `${createdItems.length} tracks added to queue`,
        });
      } else {
        toast.info('No tracks were added from this playlist');
      }
    } catch (error: any) {
      console.error('Failed to queue playlist', error);
      toast.error(error.message || 'Failed to queue playlist');
    }
  };

  const handleAddToQueue = async (track: Track) => {
    if (!track?.id) return;
    const wasEmpty = queue.length === 0;

    try {
      const item = await queueAPI.add(track.id);
      const normalized: QueueItem = item?.track
        ? {
          ...item,
          track: {
            ...item.track,
            filePath: resolveUploadsUrl(item.track.filePath || (item.track as any).file_path),
          },
        }
        : (item as any);

      // If the queue was empty, we must show the newly queued item immediately
      // so the Playback Bar reflects it without waiting for WebSocket delivery.
      if (wasEmpty) {
        setQueue([normalized]);
        setCurrentQueueItemId(normalized.id);
        toast.success('Added to queue');
        return;
      }

      // When WS is not connected, apply an optimistic update. When WS is live,
      // rely on the backend queue-updated broadcast to be the authoritative source.
      if (!hasLiveQueueRef.current) {
        setQueue((prev) => [...prev, normalized]);
      }
      toast.success('Added to queue');
    } catch (error: any) {
      console.error('Failed to add track to queue', error);
      toast.error(error.message || 'Failed to add track to queue');
    }
  };

  const handleImportFilesToPlaylist = async (
    playlistId: string,
    files: File[],
    insertIndex?: number,
    _suppressDuplicateDialog?: boolean, // suppressDuplicateDialog is unused
  ) => {
    if (!playlistId) {
      throw new Error('Playlist ID is required');
    }

    let playlist: Playlist | undefined;
    // const playlistWasMissing = !playlists.find(p => p.id === playlistId); // playlistWasMissing is unused
    if (!playlist) {
      try {
        playlist = await playlistsAPI.getById(playlistId);
      } catch {
        // proceed with safe defaults; backend will still accept addTracks
        playlist = undefined;
      }
    }
    if (playlist?.locked) {
      toast.error('Playlist is locked');
      return;
    }

    // let importedTracks: Track[] = []; // importedTracks is unused
    // let duplicates = 0; // duplicates is unused
    let failed = 0;

    // Track existing names in this playlist so we can apply OS-style,
    // gap-filling naming (Name, Name (1), Name (2), reusing gaps) when
    // importing files directly into the playlist.
    let existingNames: string[] = (playlist?.tracks || [])
      .map(t => String(t.name || ''))
      .filter(Boolean);

    const totalFiles = files.length;
    if (totalFiles > 0) {
      setPlaylistImportProgress({ percent: 0, label: `Adding to playlist… 0/${totalFiles}`, playlistId });
    }

    const normalizedItems: { trackId: string; fileName: string | null }[] = [];
    for (const file of files) {
      const validation = isValidUploadFile(file);
      if (!validation.ok) {
        failed += 1;
        toast.error(`${validation.reason}: ${file?.name || 'file'}`);
        continue;
      }

      const dotIndex = file.name.lastIndexOf('.');
      const baseName = dotIndex > 0 ? file.name.slice(0, dotIndex) : file.name;
      const desiredName = getNextSequentialName(baseName, existingNames);

      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('name', desiredName);
        const detectedDuration = files.length > 120 ? 0 : await getAudioDuration(file);
        if (detectedDuration > 0) formData.append('duration', String(detectedDuration));

        const uploadData = await apiClient.request<any>('/tracks/upload', {
          method: 'POST',
          body: formData,
          allowedStatuses: [409],
        });

        const trackIdToAttach = uploadData?.existingTrack?.id || uploadData?.id;
        if (trackIdToAttach) {
          normalizedItems.push({ trackId: trackIdToAttach, fileName: file.name });
          existingNames.push(desiredName);
        } else {
          failed += 1;
        }
      } catch (err) {
        console.error('Failed to upload for playlist', err);
        failed += 1;
      }
    }

    if (normalizedItems.length === 0) {
      setPlaylistImportProgress(null);
      return;
    }

    try {
      // const result = await playlistsAPI.addTracks(playlistId, normalizedItems); // result is unused
      await playlistsAPI.addTracks(playlistId, normalizedItems);
      const refreshed = await playlistsAPI.getById(playlistId);
      const refreshedTracks: Track[] = (refreshed?.tracks || []).map((t: any) => normalizeServerTrack(t));
      const beforeIds = new Set((playlist?.tracks || []).map((t) => t.id));
      const newOnes = refreshedTracks.filter((t) => !beforeIds.has(t.id));
      const existing = refreshedTracks.filter((t) => beforeIds.has(t.id));

      if (insertIndex != null) {
        const idx = Math.min(Math.max(insertIndex ?? existing.length, 0), existing.length);
        const desiredOrder = [...existing.slice(0, idx), ...newOnes, ...existing.slice(idx)];
        if (desiredOrder.length > 0) {
          await playlistsAPI.reorder(playlistId, desiredOrder.map((t) => t.id));
        }
      }

      const finalPlaylist = await playlistsAPI.getById(playlistId);
      const finalTracks: Track[] = (finalPlaylist?.tracks || []).map((t: any) => normalizeServerTrack(t));
      const duration = finalTracks.reduce((sum, t) => sum + (t.duration || 0), 0);

      setPlaylists((prev) => {
        const idx = prev.findIndex((p) => p.id === playlistId);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { ...prev[idx], ...(finalPlaylist as any), tracks: finalTracks, duration };
        return next;
      });

      setTracks((prev) => {
        const byId = new Map(prev.map((t) => [t.id, t] as const));
        for (const t of finalTracks) byId.set(t.id, t);
        return Array.from(byId.values());
      });

      toast.success('Playlist updated', {
        description: `${newOnes.length} tracks added to playlist storage`,
      });
    } catch (error: any) {
      console.error('Failed to attach tracks to playlist', error);
      toast.error(error.message || 'Failed to update playlist');
    } finally {
      setPlaylistImportProgress(null);
    }
  };

  const handleDropFolderOnPlaylistEmptyArea = async (playlistName: string, files: File[]) => {
    const name = String(playlistName || '').trim() || 'Imported Folder';
    const safeFiles = Array.isArray(files) ? files : [];
    if (safeFiles.length === 0) return;

    const audioFiles = safeFiles.filter((f) => isValidUploadFile(f).ok);
    if (audioFiles.length === 0) return;

    try {
      setPlaylistImportProgress({ percent: 0, label: 'Creating playlist…', playlistId: '__creating__' });
      const created = await playlistsAPI.create(name);
      setPlaylists((prev) => [...prev, created as any]);
      // Move progress to the created playlist so only that right panel shows it.
      setPlaylistImportProgress({ percent: 0, label: 'Adding to playlist… 0/0', playlistId: created.id });
      await handleImportFilesToPlaylist(created.id, audioFiles, undefined, true);
    } catch (err: any) {
      console.error('Failed to import folder into new playlist', err);
      toast.error(err?.message || 'Failed to import folder into playlist');
      setPlaylistImportProgress(null);
    }
  };

  // For OS drag-and-drop onto playlist headers we always suppress the
  // duplicate dialog and let the playlist-level OS-style naming logic
  // create copies as needed. Inserts always append at the end.
  const handleOsDropFilesOnPlaylistHeader = (
    playlistId: string,
    files: File[],
    _suppressDuplicateDialog?: boolean,
  ): void => {
    void handleImportFilesToPlaylist(playlistId, files, undefined, true);
  };

  const handleSchedulePlaylist = (playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;

    setSelectedPlaylistForSchedule(playlist);
    setScheduleDialogOpen(true);
  };

  useEffect(() => {
    (async () => {
      try {
        const serverSchedules = await schedulesAPI.getAll();
        const mapped: ScheduledPlaylist[] = (serverSchedules as any[]).map((s: any) => ({
          id: s.id,
          playlistId: s.playlist_id ?? s.playlistId,
          playlistName: s.playlist_name ?? s.playlistName,
          type: s.type as ScheduledPlaylist['type'],
          dateTime: s.date_time ? new Date(s.date_time) : s.dateTime ? new Date(s.dateTime) : undefined,
          queueSongId: s.queue_song_id ?? s.queueSongId ?? undefined,
          triggerPosition: s.trigger_position ?? s.triggerPosition ?? undefined,
          lockPlaylist: Boolean(s.lock_playlist ?? s.lockPlaylist),
          status: s.status as ScheduledPlaylist['status'],
        }));
        setScheduledPlaylists(mapped);
      } catch (error: any) {
        console.error('Failed to load schedules', error);
        toast.error(error.message || 'Failed to load schedules');
      }
    })();
  }, []);

  const handleScheduleConfirm = async (config: ScheduleConfig) => {
    if (!selectedPlaylistForSchedule) return;

    // If the user enabled auto-lock, use the exact same lock mechanism as the
    // right-click context menu (PUT /api/playlists/:id + optimistic UI).
    if (config.lockPlaylist && !selectedPlaylistForSchedule.locked) {
      const lockedOk = await setPlaylistLocked(selectedPlaylistForSchedule.id, true);
      if (!lockedOk) {
        return;
      }
    }

    try {
      const payload = {
        playlistId: selectedPlaylistForSchedule.id,
        type: config.mode,
        dateTime: config.mode === 'datetime' && config.dateTime ? config.dateTime.toISOString() : undefined,
        queueSongId: config.queueSongId,
        triggerPosition: config.triggerPosition,
        lockPlaylist: Boolean(config.lockPlaylist),
      };

      const created = await schedulesAPI.create(payload as any);
      const createdAny: any = created;
      const mapped: ScheduledPlaylist = {
        id: createdAny.id,
        playlistId: createdAny.playlist_id ?? createdAny.playlistId,
        playlistName: createdAny.playlist_name ?? createdAny.playlistName,
        type: createdAny.type as ScheduledPlaylist['type'],
        dateTime: createdAny.date_time
          ? new Date(createdAny.date_time)
          : createdAny.dateTime
            ? new Date(createdAny.dateTime)
            : undefined,
        queueSongId: createdAny.queue_song_id ?? createdAny.queueSongId ?? undefined,
        triggerPosition: createdAny.trigger_position ?? createdAny.triggerPosition ?? undefined,
        lockPlaylist: Boolean(createdAny.lock_playlist ?? createdAny.lockPlaylist),
        status: createdAny.status as ScheduledPlaylist['status'],
      };

      setScheduledPlaylists(prev => [...prev, mapped]);

      if (config.mode === 'datetime') {
        toast.success(`Playlist "${selectedPlaylistForSchedule.name}" scheduled`, {
          description: config.dateTime ? `Will start at ${config.dateTime.toLocaleString()}` : undefined,
          duration: 3000,
        });
      } else {
        const queueItem = queue.find(q => q.id === config.queueSongId);
        const position = config.triggerPosition === 'after' ? 'after' : 'before';
        toast.success(`Playlist "${selectedPlaylistForSchedule.name}" scheduled`, {
          description: `Will start ${position} "${queueItem?.track.name}"`,
          duration: 3000,
        });
      }
    } catch (error: any) {
      const status = error?.status ?? error?.response?.status;
      if (status === 409) {
        toast.error('Already scheduled', {
          description: 'This playlist already has a pending schedule. Cancel it or wait until it triggers.',
          duration: 3500,
        });
        return;
      }
      console.error('Failed to create schedule', error);
      toast.error(error.message || 'Failed to create schedule');
    }
  };

  const handleScheduleDialogOpenChange = (open: boolean) => {
    setScheduleDialogOpen(open);
    if (!open) {
      setSelectedPlaylistForSchedule(null);
    }
  };

  const handleFactoryReset = async () => {
    try {
      await settingsAPI.factoryReset();
      // Clear all local state
      setTracks([]);
      setPlaylists([]);
      setQueue([]);
      setCurrentQueueItemId(null);
      setHistoryOpen(false);
      setScheduleDialogOpen(false);
      setShowBackupDialog(false);

      // Show success message briefly before reload
      setTimeout(() => {
        // Reload the application to clean state
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('Factory reset failed:', error);
      // Keep dialog open on error so user can try again
    }
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    const schedule = scheduledPlaylists.find((s) => s.id === scheduleId);
    if (!schedule) return;

    const playlist = playlists.find((p) => p.id === schedule.playlistId);
    if (playlist?.locked) {
      toast.error('Unlock playlist to remove this schedule');
      return;
    }

    try {
      await schedulesAPI.delete(scheduleId);
      setScheduledPlaylists(prev => prev.filter((s) => s.id !== scheduleId));
      setDismissedScheduleIds(prev => prev.filter((id) => id !== scheduleId));
      toast.success('Schedule removed');
    } catch (error: any) {
      console.error('Failed to remove schedule', error);
      toast.error(error.message || 'Failed to remove schedule');
    }
  };

  useEffect(() => {
    // Drive datetime schedules off the same 1s clock used for the top bar.
    // The backend scheduler is responsible for actually firing the playlists;
    // this effect only shows a 1-minute warning toast.
    if (!nowIst) return;

    const now = nowIst;

    setScheduledPlaylists(prev => {
      // 1-minute warning for upcoming datetime schedules
      prev.forEach((schedule) => {
        if (
          schedule.type === 'datetime' &&
          schedule.status === 'pending' &&
          schedule.dateTime
        ) {
          const msUntil = schedule.dateTime.getTime() - now.getTime();
          if (msUntil <= 60_000 && msUntil > 0 && !datetimeWarnedRef.current.has(schedule.id)) {
            datetimeWarnedRef.current.add(schedule.id);
            toast.info('Scheduled playlist starting soon', {
              description: `"${schedule.playlistName}" will start in about 1 minute`,
            });
          }
        }
      });

      return prev;
    });
  }, [nowIst]);

  const handleRemoveTrack = (trackId: string) => {
    setTracksToRemove(new Set([trackId]));
  };

  const handleRemoveTracks = (trackIds: string[]) => {
    if (trackIds.length > 0) {
      setTracksToRemove(new Set(trackIds));
    }
  };

  const confirmRemoveTracks = async () => {
    if (!tracksToRemove || tracksToRemove.size === 0) return;
    const ids = Array.from(tracksToRemove);
    setTracksToRemove(null);

    // Optimistic update
    const previousTracks = tracks;
    setTracks(prev => prev.filter(t => !tracksToRemove.has(t.id)));

    let failedCount = 0;
    try {
      // Process in batches or parallel? Parallel is fine for reasonable numbers
      await Promise.all(ids.map(id => tracksAPI.delete(id).catch(err => {
        console.error(`Failed to delete track ${id}`, err);
        failedCount++;
        return null; // Don't throw to stop others
      })));

      if (failedCount > 0) {
        toast.warning(`Deleted ${ids.length - failedCount} tracks. Failed to delete ${failedCount} tracks.`);
        // If some failed, we might want to re-fetch or revert.
        // Re-fetching is safer than complex logic to revert specific ones.
        void resyncAll();
      } else {
        toast.success(ids.length === 1 ? 'Track removed' : `${ids.length} tracks removed`);
      }
    } catch (error) {
      console.error(error);
      setTracks(previousTracks);
      toast.error('Failed to remove tracks');
    }
  };

  const handlePlayPause = () => {
    if (!currentQueueItemId && queue.length > 0) {
      setCurrentQueueItemId(queue[0].id);
      setIsPlaying(true);
      setNowPlayingStart(nowIst ?? new Date());
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  const handleNext = () => {
    if (queue.length === 0) return;

    const currentIndex = currentQueueItemId
      ? queue.findIndex(item => item.id === currentQueueItemId)
      : -1;

    // If nothing is currently playing, just start the first item without removing it yet
    if (currentIndex === -1) {
      setCurrentQueueItemId(queue[0].id);
      setIsPlaying(true);
      return;
    }

    const finishedItem = queue[currentIndex];

    // Log history entry for the track we are leaving with precise end time
    const completionTime = nowIst ?? new Date();
    void finalizePlaybackHistory(finishedItem.track, {
      completed: true,
      source: 'queue',
      endTimestampOverride: completionTime,
    });

    // Base queue after removing the finished track
    let baseQueue = queue.filter((_, index) => index !== currentIndex);

    // Apply any song-trigger schedules whose queueSongId matches this finished queue item
    const triggered = scheduledPlaylists.filter(
      (s) => s.type === 'song-trigger' && s.status === 'pending' && s.queueSongId === finishedItem.id
    );

    if (triggered.length > 0) {
      triggered.forEach((schedule) => {
        const playlist = playlists.find((p) => p.id === schedule.playlistId);
        if (!playlist || playlist.tracks.length === 0) {
          return;
        }

        // Notify user just before the scheduled playlist starts (song-trigger)
        toast.info('Scheduled playlist starting', {
          description: `"${playlist.name}" is starting now (after song)`,
        });

        // Insert scheduled playlist tracks before the rest of the queue,
        // so queue resumes after the playlist completes
        const startOrder = 0;
        const playlistItems: QueueItem[] = playlist.tracks.map((track, index) => ({
          id: generateId(),
          track,
          fromPlaylist: playlist.name,
          order: startOrder + index,
        }));

        baseQueue = [...playlistItems, ...baseQueue.map((item, idx) => ({
          ...item,
          order: playlistItems.length + idx,
        }))];

        schedulesAPI.updateStatus(schedule.id, 'completed').catch((error) => {
          console.error('Failed to update schedule status', error);
        });
      });

      setScheduledPlaylists((prev) =>
        prev.map((s) =>
          triggered.some((t) => t.id === s.id)
            ? { ...s, status: 'completed' as ScheduledPlaylist['status'] }
            : s
        )
      );
    }

    setQueue(baseQueue);

    // Also remove the finished queue item on the backend so that all
    // connected clients (and future sessions) see a consistent queue
    // state. Treat 404 as success because the scheduler or another
    // client may already have removed it.
    apiClient
      .request<void>(`/queue/${finishedItem.id}`, {
        method: 'DELETE',
        responseType: 'none',
        allowedStatuses: [404],
      })
      .catch((err) => {
        console.error('Error calling DELETE /api/queue for finished item', err);
      });

    if (baseQueue.length > 0) {
      setCurrentQueueItemId(baseQueue[0].id);
      setIsPlaying(true);
      setNowPlayingStart(nowIst ?? new Date());
    } else {
      setCurrentQueueItemId(null);
      setIsPlaying(false);
      setNowPlayingStart(null);
    }
  };

  const handlePrevious = () => {
    if (queue.length > 0) {
      const currentIndex = currentQueueItemId
        ? queue.findIndex((item) => item.id === currentQueueItemId)
        : -1;
      if (currentIndex > 0) {
        setCurrentQueueItemId(queue[currentIndex - 1].id);
      }
    }
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/70 bg-background/70 backdrop-blur text-[11px] text-muted-foreground">
        {/* Left: Project statistics */}
        <div className="flex items-center gap-2 flex-none">
          <div className="flex items-center gap-3 px-3 py-1.5 rounded-md border border-border/70 bg-muted/20 text-foreground/80">
            <div className="flex items-center gap-1">
              <Music2 className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-medium">{tracks.length}</span>
              <span className="text-muted-foreground">Tracks</span>
            </div>
            <div className="w-px h-4 bg-border/70" />
            <div className="flex items-center gap-1">
              <ListMusic className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-medium">{playlists.length}</span>
              <span className="text-muted-foreground">Playlists</span>
            </div>
            <div className="w-px h-4 bg-border/70" />
            <div className="flex items-center gap-1">
              <ListOrdered className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-medium">{queue.length}</span>
              <span className="text-muted-foreground">Queue</span>
            </div>
          </div>
        </div>

        {/* Center: Clock */}
        <div className="flex-1 flex justify-center">
          <div className="px-3 py-1.5 rounded-md border border-border/70 bg-muted/10 font-mono text-[11px] tracking-wide text-foreground/80">
            {formatIstTime(nowIst)}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 flex-none">
          {headerSupportsOutputSelection && (
            <div className="hidden sm:flex flex-col items-end gap-0.5 px-2 py-1 rounded-md border border-border/70 bg-muted/10">
              <div className="flex items-center gap-2">
                <div className="h-8 px-2 rounded-md bg-muted/10 flex items-center gap-1 text-[11px] leading-none text-muted-foreground whitespace-nowrap">
                  <Speaker className="w-4 h-4" />
                  <span>Output</span>
                </div>
                <Select value={headerSelectedDeviceId} onValueChange={(value) => setHeaderSelectedDeviceId(value)}>
                  <SelectTrigger
                    size="sm"
                    className="h-8 w-[7.5rem] text-[11px] truncate leading-none bg-muted/20 hover:bg-muted/30 border border-border/70"
                  >
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">System default (OS)</SelectItem>
                    {headerOutputDevices.map((d) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label || 'Audio output'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {headerSelectedDeviceId !== 'default' && (headerOutputError || headerFallbackToDefault) && (
                <div className="text-[10px] leading-tight text-muted-foreground max-w-[10.5rem] text-right truncate">
                  {headerOutputError
                    ? headerOutputError
                    : headerFallbackToDefault
                      ? 'Output device missing; using default'
                      : ''}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 px-2 py-1 rounded-md border border-border/70 bg-muted/10">
            <Button
              variant={queueDialogOpen ? 'default' : 'ghost'}
              size="sm"
              className={
                queueDialogOpen
                  ? 'gap-2 text-xs'
                  : 'gap-2 text-xs bg-muted/10 hover:bg-muted/20 text-foreground/80 hover:text-foreground border border-transparent hover:border-border/60'
              }
              onClick={toggleQueueDialog}
              title="Queue (Q)"
            >
              <ListOrdered className="w-4 h-4" />
              <span>Queue</span>
            </Button>
            {/* Settings Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 text-xs bg-muted/10 hover:bg-muted/20 text-foreground/80 hover:text-foreground border border-transparent hover:border-border/60"
                  title="Settings"
                >
                  <Settings className="w-4 h-4" />
                  <span className="hidden sm:inline">Settings</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>System</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
                  <Clock className="w-4 h-4 mr-2" />
                  History
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowBackupDialog(true)}>
                  <Shield className="w-4 h-4 mr-2" />
                  Backup & Restore
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setShowFactoryResetDialog(true)}
                  className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                >
                  <Database className="w-4 h-4 mr-2" />
                  Factory Reset
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Appearance</DropdownMenuLabel>
                <DropdownMenuItem onClick={toggleTheme}>
                  {theme === 'default' ? (
                    <>
                      <Sun className="w-4 h-4 mr-2" />
                      Switch to Light Mode
                    </>
                  ) : (
                    <>
                      <Moon className="w-4 h-4 mr-2" />
                      Switch to Dark Mode
                    </>
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>


          </div>
        </div>
      </div>

      {/* Main two-panel layout: Library | Playlists */}
      <div className="flex flex-1 min-h-0 pb-20">
        {/* Library rail + panel (VS Code style) */}
        <div
          className="flex h-full flex-shrink-0 border-r border-border/70 bg-background/70 transition-[width] duration-200 ease-out"
          style={{ width: LIBRARY_RAIL_WIDTH + (isLibraryPanelOpen ? leftPanel.width : 0) }}
        >
          {/* Rail */}
          <div
            className="h-full flex flex-col items-center py-2"
            style={{ width: LIBRARY_RAIL_WIDTH }}
          >
            <Button
              variant={isLibraryPanelOpen ? 'secondary' : 'ghost'}
              size="icon"
              onClick={toggleLibraryPanel}
              title={isLibraryPanelOpen ? 'Collapse Library' : 'Expand Library'}
              className="h-9 w-9"
            >
              <Folder className="h-5 w-5" />
            </Button>
          </div>

          {/* Panel */}
          <div
            className="h-full overflow-hidden transition-[width] duration-200 ease-out"
            style={{ width: isLibraryPanelOpen ? leftPanel.width : 0 }}
          >
            <div className="h-full" style={{ width: leftPanel.width }}>
              <ErrorBoundary
                title="Library"
                resetKeys={[tracks.length, playlists.length]}
                onError={(error) => {
                  console.error('Library panel crashed', error);
                  toast.error('Library panel crashed');
                }}
              >
                <LibraryPanel
                  tracks={tracks}
                  playlists={playlists}
                  queue={queue}
                  currentTrackId={currentTrackId}
                  onAddToQueue={handleAddToQueue}
                  onAddToPlaylist={handleAddToPlaylist}
                  onSelectPlaylist={() => { }}
                  onCreatePlaylist={handleCreatePlaylist}
                  onRenamePlaylist={handleRenamePlaylist}
                  onDeletePlaylist={handleDeletePlaylist}
                  onToggleLockPlaylist={handleToggleLockPlaylist}
                  onRemoveTrack={handleRemoveTrack}

                  onRemoveTracks={handleRemoveTracks}
                  onImportTracks={handleImportTracks}
                  onImportFolder={handleImportFolder}
                  importProgress={libraryImportProgress}
                  onTrackUpdated={handleTrackUpdated}
                />
              </ErrorBoundary>
            </div>
          </div>
        </div>

        {/* Resize handle between Library and Playlists */}
        {isLibraryPanelOpen && (
          <ResizeHandle
            onMouseDown={leftPanel.handleMouseDown}
            isResizing={leftPanel.isResizing}
          />
        )}

        {/* Playlists (center) */}
        <div className="flex-1 min-w-0 h-full">
          <ErrorBoundary
            title="Playlists"
            resetKeys={[playlists.length, scheduledPlaylists.length, queue.length]}
            onError={(error) => {
              console.error('Playlists panel crashed', error);
              toast.error('Playlists panel crashed');
            }}
          >
            <PlaylistManager
              playlists={playlists}
              recentPlaylistAdd={recentPlaylistAdd}
              onCreatePlaylist={handleCreatePlaylist}
              onRenamePlaylist={handleRenamePlaylist}
              onDeletePlaylist={handleDeletePlaylist}
              onToggleLockPlaylist={handleToggleLockPlaylist}
              onDuplicatePlaylist={handleDuplicatePlaylist}
              onAddSongsToPlaylist={handleAddSongsToPlaylist}
              onRemoveTrackFromPlaylist={handleRemoveTrackFromPlaylist}
              onReorderPlaylistTracks={handleReorderPlaylistTracks}
              onSchedulePlaylist={handleSchedulePlaylist}
              onPlayPlaylistNow={handlePlayPlaylistNow}
              onQueuePlaylist={handleQueuePlaylist}
              queue={queue}
              onImportFilesToPlaylist={handleImportFilesToPlaylist}
              onQueueTrackFromPlaylist={handleAddToQueue}
              onTrackUpdated={handleTrackUpdated}
              scheduledPlaylists={scheduledPlaylists}
              onDeleteSchedule={handleDeleteSchedule}
              onDropTrackOnPlaylistHeader={handleDropTrackOnPlaylistHeader}
              onDropFolderOnPlaylistHeader={handleDropFolderOnPlaylistHeader}
              onDropFilesOnPlaylistHeader={handleOsDropFilesOnPlaylistHeader}
              onDropTrackOnPlaylistPanel={handleDropTrackOnPlaylistPanel}
              onDropFolderOnPlaylistPanel={handleDropFolderOnPlaylistPanel}
              onDropFolderOnEmptyArea={handleDropFolderOnPlaylistEmptyArea}
              importProgress={playlistImportProgress ?? null}
            />
          </ErrorBoundary>
        </div>
      </div>

      <FloatingQueueDialog
        open={queueDialogOpen}
        title="Queue"
        subtitle={`${queue.length} tracks`}
        rect={queueDialogRect}
        minWidth={320}
        minHeight={360}
        locked={queueDialogLocked}
        onClose={() => setQueueDialogOpen(false)}
        onToggleLocked={() => setQueueDialogLocked((prev) => !prev)}
        onRectChange={setQueueDialogRect}
      >
        <ErrorBoundary
          title="Queue"
          resetKeys={[queue.length, currentQueueItemId, queueDialogLocked]}
          onError={(error) => {
            console.error('Queue panel crashed', error);
            toast.error('Queue panel crashed');
          }}
        >
          <QueuePanel
            queue={queue}
            currentQueueItemId={currentQueueItemId}
            onRemoveFromQueue={handleRemoveFromQueue}
            onReorderQueue={handleReorderQueue}
            timing={timing}
            now={nowIst}
            playlists={playlists}
            onAddQueueItemToPlaylist={handleAddQueueItemToPlaylist}
            locked={queueDialogLocked}
            selectedQueueItemId={selectedQueueItemId}
            onSelectQueueItem={setSelectedQueueItemId}
            pendingNextQueueItemId={pendingNextQueueItemId}
            gapRemainingSeconds={gapState.gapRemainingSeconds}
            showHeader={false}
          />
        </ErrorBoundary>
      </FloatingQueueDialog>

      {/* Bottom Playback Bar */}
      <div className="fixed left-0 right-0 bottom-0 z-50">
        <PlaybackBar
          currentTrack={currentTrack}
          nextTrack={nextTrack}
          scheduledGapOverride={scheduledGapOverride}
          isPlaying={isPlaying}
          onPlayPause={handlePlayPause}
          onNext={handleNext}
          onPrevious={handlePrevious}
          isLive={isLive}
          transitionMode={transitionMode}
          onTransitionModeChange={setTransitionMode}
          gapSeconds={gapSeconds}
          onGapSecondsChange={setGapSeconds}
          crossfadeSeconds={crossfadeSeconds}
          onCrossfadeSecondsChange={setCrossfadeSeconds}
          audioDevices={audioDevices}
          onSeek={handleSeekWithTiming}
          onProgress={handlePlaybackProgress}
          restoreSeekSeconds={restoreSeekSeconds}
          onGapStateChange={setGapState}
        />
      </div>

      <Toaster position="bottom-right" />

      {scheduleDialogOpen && selectedPlaylistForSchedule && (
        <SchedulePlaylistDialog
          open={scheduleDialogOpen}
          onOpenChange={handleScheduleDialogOpenChange}
          playlistName={selectedPlaylistForSchedule.name}
          queue={queue}
          existingSchedule={
            scheduledPlaylists.find((s) => s.playlistId === selectedPlaylistForSchedule.id) ?? null
          }
          onSchedule={handleScheduleConfirm}
        />
      )}

      <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />

      <SimpleBackupDialog open={showBackupDialog} onOpenChange={setShowBackupDialog} />

      <ConfirmDialog
        open={showFactoryResetDialog}
        title="Factory Reset"
        description="This will completely erase all data including library, playlists, queue, history, and settings. The app will automatically restart to a clean state. This action cannot be undone."
        confirmLabel="Factory Reset"
        cancelLabel="Cancel"
        onConfirm={handleFactoryReset}
        onCancel={() => setShowFactoryResetDialog(false)}
      />

      <ConfirmDialog
        open={tracksToRemove !== null}
        title={tracksToRemove && tracksToRemove.size > 1 ? `Remove ${tracksToRemove.size} tracks?` : "Remove track from library?"}
        description="This will delete the selected tracks from your library. Playlists that use them may be affected."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        onConfirm={confirmRemoveTracks}
        onCancel={() => setTracksToRemove(null)}
      />

      <ConfirmDialog
        open={removePlayingTrackConfirm !== null}
        title="Remove currently playing track?"
        description="This will stop playback and remove the current track from the queue."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        onConfirm={confirmRemovePlayingTrack}
        onCancel={() => setRemovePlayingTrackConfirm(null)}
      />

      <ConfirmDialog
        open={deletePlaylistConfirm !== null}
        title={deletePlaylistConfirm ? `Delete playlist "${deletePlaylistConfirm.name}"?` : 'Delete playlist?'}
        description={
          deletePlaylistConfirm
            ? `${deletePlaylistConfirm.trackCount} track records will be removed.\n\n${deletePlaylistConfirm.mediaCount} media files will be removed from storage.${deletePlaylistConfirm.scheduledCount > 0
              ? `\n\nWARNING: This playlist is currently scheduled.`
              : ''
            }`
            : undefined
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => deletePlaylistConfirm && confirmDeletePlaylist(deletePlaylistConfirm)}
        onCancel={() => setDeletePlaylistConfirm(null)}
      />

      <AnimatePresence>
        {duplicatePrompt && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={reduceMotion ? undefined : { opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={reduceMotion ? undefined : { duration: 0.16, ease: 'easeOut' }}
          >
            <motion.div
              className="bg-background border border-border rounded-md shadow-lg p-4 w-full max-w-sm"
              initial={reduceMotion ? false : { opacity: 0, scale: 0.98, y: 6 }}
              animate={reduceMotion ? undefined : { opacity: 1, scale: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98, y: 6 }}
              transition={reduceMotion ? undefined : { duration: 0.18, ease: 'easeOut' }}
            >
              <div className="mb-3">
                <h2 className="text-sm font-semibold mb-1">Duplicate file detected</h2>
                <p className="text-xs text-muted-foreground">
                  Track already exists in your library.
                </p>
                <p className="text-[11px] text-muted-foreground mt-1 break-all">
                  Importing file: <span className="font-mono">{duplicatePrompt.fileName}</span>
                </p>
              </div>
              <div className="flex justify-end gap-2 mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDuplicateDecision('skip')}
                >
                  Skip
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDuplicateDecision('cancel')}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={() => handleDuplicateDecision('add')}>
                  Add Copy
                </Button>
                <Button size="sm" onClick={() => handleDuplicateDecision('addAll')}>
                  Add All
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {folderDuplicatePrompt && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={reduceMotion ? undefined : { opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={reduceMotion ? undefined : { duration: 0.16, ease: 'easeOut' }}
          >
            <motion.div
              className="bg-background border border-border rounded-md shadow-lg p-5 w-full max-w-md"
              initial={reduceMotion ? false : { opacity: 0, scale: 0.98, y: 6 }}
              animate={reduceMotion ? undefined : { opacity: 1, scale: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98, y: 6 }}
              transition={reduceMotion ? undefined : { duration: 0.18, ease: 'easeOut' }}
            >
              <div className="mb-4">
                <h2 className="text-base font-semibold mb-1">File already exists in this folder</h2>
                <p className="text-xs text-muted-foreground">
                  A track named "{folderDuplicatePrompt.baseName}" already exists.
                </p>
                <p className="text-[11px] text-muted-foreground mt-2 break-all">
                  Importing: <span className="font-mono">{folderDuplicatePrompt.fileName}</span>
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Button size="sm" variant="outline" onClick={() => handleFolderDuplicateDecision('skip')}>
                  Skip this file
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleFolderDuplicateDecision('cancel')}>
                  Cancel import
                </Button>
                <div className="flex justify-end gap-2 mt-2">
                  <Button size="sm" variant="outline" onClick={() => handleFolderDuplicateDecision('add')}>
                    Add copy
                  </Button>
                  <Button size="sm" onClick={() => handleFolderDuplicateDecision('addAll')}>
                    Add all copies
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {playlistNameDialog && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => setPlaylistNameDialog(null)}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={reduceMotion ? undefined : { opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={reduceMotion ? undefined : { duration: 0.16, ease: 'easeOut' }}
          >
            <motion.div
              className="w-full max-w-lg rounded-xl border border-border/60 bg-background text-foreground shadow-2xl p-6"
              onClick={(e) => e.stopPropagation()}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.98, y: 6 }}
              animate={reduceMotion ? undefined : { opacity: 1, scale: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98, y: 6 }}
              transition={reduceMotion ? undefined : { duration: 0.18, ease: 'easeOut' }}
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitPlaylistNameDialog();
                }}
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold tracking-tight text-foreground">
                    {playlistNameDialog.mode === 'create' ? 'New Playlist' : 'Rename Playlist'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setPlaylistNameDialog(null)}
                    className="text-muted-foreground hover:text-foreground text-lg leading-none px-2"
                  >
                    ×
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">

                  </div>
                  <Input
                    autoFocus
                    value={playlistNameDialog.name}
                    placeholder={playlistNameDialog.mode === 'create' ? 'Playlist name' : 'New name'}
                    className="bg-white text-slate-900 placeholder:text-slate-500 border-slate-300 focus-visible:ring-primary/30 focus-visible:border-primary dark:bg-input/40 dark:text-foreground dark:placeholder:text-muted-foreground/80 dark:border-input"
                    onChange={(e) =>
                      setPlaylistNameDialog((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setPlaylistNameDialog(null);
                      }
                    }}
                  />
                </div>

                <div className="flex justify-end gap-3 mt-6">
                  <Button size="sm" variant="outline" type="button" onClick={() => setPlaylistNameDialog(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" type="submit" disabled={!playlistNameDialog.name.trim()}>
                    Save
                  </Button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}