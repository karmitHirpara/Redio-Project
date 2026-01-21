import { useState, useEffect, useRef } from 'react';
import type React from 'react';
import { LibraryPanel } from './components/LibraryPanel';
import { PlaylistManager } from './components/PlaylistManager';
import { QueuePanel } from './components/QueuePanel';
import { PlaybackBar } from './components/PlaybackBar';
import { ThemeToggle } from './components/ThemeToggle';
import { ResizeHandle } from './components/ResizeHandle';
import { FloatingQueueDialog, FloatingDialogRect } from './components/FloatingQueueDialog';
import { SchedulePlaylistDialog, ScheduleConfig } from './components/SchedulePlaylistDialog';
import { HistoryDialog } from './components/HistoryDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Clock, ListMusic, ListOrdered, Music2, Speaker } from 'lucide-react';
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
import { Track, Playlist, QueueItem, ScheduledPlaylist } from './types';
import { formatDuration, generateId } from './lib/utils';
import { toast, Toaster } from 'sonner';
import {
  ApiError,
  apiClient,
  foldersAPI,
  historyAPI,
  playlistsAPI,
  queueAPI,
  resolveUploadsUrl,
  schedulesAPI,
  tracksAPI,
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
  const [isLive, setIsLive] = useState(true);
  const [scheduledPlaylists, setScheduledPlaylists] = useState<ScheduledPlaylist[]>([]);
  const [crossfadeSeconds, setCrossfadeSeconds] = useState(2);
  const [nowPlayingStart, setNowPlayingStart] = useState<Date | null>(null);
  const [seekAnchor, setSeekAnchor] = useState<{ seconds: number; at: Date } | null>(null);
  const playbackPositionSecondsRef = useRef(0);
  const pauseStartedAtRef = useRef<Date | null>(null);
  const playbackStartedQueueItemIdRef = useRef<string | null>(null);
  const datetimeWarnedRef = useRef<Set<string>>(new Set());
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedPlaylistForSchedule, setSelectedPlaylistForSchedule] = useState<Playlist | null>(null);
  const [trackToRemove, setTrackToRemove] = useState<string | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    existingName: string;
    fileName: string;
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

  const toggleQueueDialog = () => setQueueDialogOpen((prev) => !prev);

  const [playlistNameDialog, setPlaylistNameDialog] = useState<
    | { mode: 'create'; name: string }
    | { mode: 'rename'; playlistId: string; name: string }
    | null
  >(null);

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

  const prevQueueLengthRef = useRef(0);

  const handleSeekWithTiming = (seconds: number) => {
    if (!currentTrack) return;
    setSeekAnchor({ seconds, at: new Date() });
  };

  const handlePlaybackProgress = (seconds: number) => {
    playbackPositionSecondsRef.current = seconds;
  };

  const leftPanel = useResizable({ initialWidth: 320, minWidth: 250, maxWidth: 500 });
  const rightPanel = useResizable({ initialWidth: 320, minWidth: 250, maxWidth: 500, direction: 'rtl' });

  const currentQueueItem = currentQueueItemId
    ? queue.find((item) => item.id === currentQueueItemId) || null
    : null;
  const currentTrack = currentQueueItem?.track || null;
  const currentTrackId = currentTrack?.id ?? null;
  const currentTrackRef = useRef<Track | null>(null);
  const currentTrackIdRef = useRef<string | null>(null);
  const currentQueueItemIdRef = useRef<string | null>(null);
  const nowPlayingStartRef = useRef<Date | null>(null);
  const hasLiveQueueRef = useRef(false);
  const pinnedQueueItemIdRef = useRef<string | null>(null);

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

  const timing = useQueueTiming({
    queue,
    currentTrack,
    currentQueueItemId,
    isPlaying,
    nowPlayingStart,
    crossfadeSeconds,
    seekAnchor,
  });

  const handleDropTrackOnPlaylistHeader = async (playlistId: string, trackId: string) => {
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;
    await handleAddToPlaylist(track, playlistId, true);
  };

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
    }, 3000);

    return () => window.clearTimeout(timeoutId);
  }, [scheduledPlaylists]);

  // Load tracks from backend so library reflects database
  useEffect(() => {
    (async () => {
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
        console.error('Failed to load tracks', error);
        toast.error(error.message || 'Failed to load tracks');
      }
    })();
  }, []);


  // Keep refs in sync with the latest current track so the WebSocket
  // handlers can safely reason about preemption.
  useEffect(() => {
    currentTrackRef.current = currentTrack;
    currentTrackIdRef.current = currentTrackId;
    currentQueueItemIdRef.current = currentQueueItemId;
    nowPlayingStartRef.current = nowPlayingStart;
  }, [currentTrack, currentTrackId, currentQueueItemId, nowPlayingStart]);

  // WebSocket connection for real-time events.
  // If VITE_WS_URL is not set, default to the local backend WS endpoint
  // so that scheduler-driven queue updates still reach the frontend.
  useEffect(() => {
    const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
    const wsUrl = envUrl || 'ws://localhost:3001/ws';

    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('WebSocket connected:', wsUrl);
      hasLiveQueueRef.current = true;
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'playlist-locked' && data.playlistId) {
          const locked = Boolean(data.locked);
          setPlaylists((prev) =>
            prev.map((p) => (p.id === data.playlistId ? { ...p, locked } : p)),
          );
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
          const wasCurrentStillPresent = previousCurrentId
            ? newQueue.some((item) => item.id === previousCurrentId)
            : false;

          setQueue(newQueue);

          const firstQueueItemId = newQueue[0]?.id ?? null;

          if (data.reason === 'schedule-preempt' && firstQueueItemId) {
            const interruptedTrack = currentTrackRef.current;
            if (interruptedTrack) {
              const now = Date.now();
              const wallClockStart = nowPlayingStartRef.current;
              const wallClockElapsedSeconds = wallClockStart
                ? Math.max(0, Math.round((now - wallClockStart.getTime()) / 1000))
                : 0;
              const playheadSeconds = Math.max(0, Math.round(playbackPositionSecondsRef.current || 0));
              const interruptedSeconds = Math.max(playheadSeconds, wallClockElapsedSeconds);
              const playedAtOverride = new Date(Date.now() - interruptedSeconds * 1000).toISOString();
              logPlaybackHistory(interruptedTrack, {
                completed: false,
                source: 'queue',
                playedAtOverride,
                positionEndOverrideSeconds: interruptedSeconds,
              });
            }

            // Mark any due pending datetime schedules as completed and
            // dismiss them from the Scheduled panel so the notification
            // auto-closes once the schedule time is reached.
            const now = new Date();
            const completedIds: string[] = [];
            setScheduledPlaylists((prev) =>
              prev.map((s) => {
                if (
                  s.type === 'datetime' &&
                  s.status === 'pending' &&
                  s.dateTime &&
                  s.dateTime.getTime() <= now.getTime()
                ) {
                  completedIds.push(s.id);
                  return { ...s, status: 'completed' };
                }
                return s;
              }),
            );

            if (completedIds.length > 0) {
              setDismissedScheduleIds((prev) =>
                Array.from(new Set([...prev, ...completedIds])),
              );
            }

            setCurrentQueueItemId(firstQueueItemId);
            setIsPlaying(true);
            setNowPlayingStart(new Date());
            return;
          }

          // Generic preemption detection: previously playing track has
          // disappeared from the queue but there is still a head item.
          if (previousCurrentId && !wasCurrentStillPresent && firstQueueItemId) {
            const interruptedTrack = currentTrackRef.current;
            if (interruptedTrack) {
              logPlaybackHistory(interruptedTrack, { completed: false, source: 'queue' });
            }
            setCurrentQueueItemId(firstQueueItemId);
            setIsPlaying(true);
            setNowPlayingStart(new Date());
          } else {
            // If nothing is currently selected, select the first track for
            // playback context (non-preemption updates).
            setCurrentQueueItemId((prev: string | null) => prev ?? firstQueueItemId);
          }
        }
      } catch (err) {
        console.error('Error parsing WebSocket message', err);
      }
    };

    socket.onclose = () => {
      console.log('WebSocket disconnected');
      hasLiveQueueRef.current = false;
    };

    socket.onerror = (err) => {
      console.error('WebSocket error', err);
    };

    return () => {
      socket.close();
    };
  }, []);

  // Load queue from backend so it persists across refreshes
  useEffect(() => {
    (async () => {
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
      } catch (error: any) {
        console.error('Failed to load queue', error);
        toast.error(error.message || 'Failed to load queue');
      }
    })();
  }, []);

  // Load playlists from backend so created playlists persist
  useEffect(() => {
    (async () => {
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
        console.error('Failed to load playlists', error);
        toast.error(error.message || 'Failed to load playlists');
      }
    })();
  }, []);

  // Track Management
  const getAudioDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
      const audio = new Audio();
      const url = URL.createObjectURL(file);
      audio.src = url;
      audio.addEventListener('loadedmetadata', () => {
        if (!isNaN(audio.duration) && audio.duration > 0) {
          resolve(Math.round(audio.duration));
        } else {
          resolve(0);
        }
        URL.revokeObjectURL(url);
      });
      audio.addEventListener('error', () => {
        resolve(0);
        URL.revokeObjectURL(url);
      });
    });
  };

  const askDuplicateDecision = (
    existingName: string,
    fileName: string,
  ): Promise<'skip' | 'cancel' | 'add' | 'addAll'> => {
    return new Promise((resolve) => {
      duplicateDecisionResolver.current = resolve;
      setDuplicatePrompt({ existingName, fileName });
    });
  };

  const handleDuplicateDecision = (choice: 'skip' | 'cancel' | 'add' | 'addAll') => {
    if (duplicateDecisionResolver.current) {
      duplicateDecisionResolver.current(choice);
      duplicateDecisionResolver.current = null;
    }
    setDuplicatePrompt(null);
  };

  const askFolderDuplicateDecision = (
    baseName: string,
    fileName: string,
  ): Promise<'skip' | 'cancel' | 'add' | 'addAll'> => {
    return new Promise((resolve) => {
      folderDuplicateDecisionResolver.current = resolve;
      setFolderDuplicatePrompt({ baseName, fileName });
    });
  };

  const handleFolderDuplicateDecision = (choice: 'skip' | 'cancel' | 'add' | 'addAll') => {
    if (folderDuplicateDecisionResolver.current) {
      folderDuplicateDecisionResolver.current(choice);
      folderDuplicateDecisionResolver.current = null;
    }
    setFolderDuplicatePrompt(null);
  };

  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Given a base name and the list of existing names in a folder, return the
  // next OS-style name. Rules: use the plain baseName if it is free; otherwise
  // use the smallest positive integer suffix not yet taken.
  // Examples for baseName="Sahiba":
  //  []                                  -> "Sahiba"
  //  ["Sahiba"]                         -> "Sahiba (1)"
  //  ["Sahiba", "Sahiba (1)"]         -> "Sahiba (2)"
  //  ["Sahiba", "Sahiba (2)"]         -> "Sahiba (1)"  (fill the gap)
  //  ["Sahiba (1)", "Sahiba (2)"]     -> "Sahiba"      (base is free again)
  const getNextSequentialName = (baseName: string, existingNames: string[]): string => {
    const pattern = new RegExp(`^${escapeRegExp(baseName)}(?: \\((\\d+)\\))?$`);
    const used = new Set<number>();

    for (const name of existingNames) {
      const match = name.match(pattern);
      if (!match) continue;
      const idx = match[1] ? parseInt(match[1], 10) : 0; // 0 = plain baseName
      if (!Number.isNaN(idx)) {
        used.add(idx);
      }
    }

    // If the plain name is not taken, use it.
    if (!used.has(0)) {
      return baseName;
    }

    // Otherwise, find the smallest positive integer not in the set.
    let suffix = 1;
    while (used.has(suffix)) {
      suffix += 1;
    }
    return `${baseName} (${suffix})`;
  };

  const handleDuplicatePlaylist = async (playlistId: string) => {
    const original = playlists.find(p => p.id === playlistId);
    if (!original) return;

    // Generate a unique copy name
    let baseName = `${original.name} Copy`;
    let name = baseName;
    let suffix = 2;
    while (playlists.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      name = `${baseName} ${suffix++}`;
    }

    try {
      const serverPlaylist: any = await playlistsAPI.create(name);
      const newPlaylistId = serverPlaylist.id as string;
      const trackIds = original.tracks.map(t => t.id);

      if (trackIds.length > 0) {
        await playlistsAPI.addTracks(newPlaylistId, trackIds);
      }

      const newPlaylist: Playlist = {
        id: newPlaylistId,
        name,
        tracks: [...original.tracks],
        locked: false,
        createdAt: serverPlaylist.created_at
          ? new Date(serverPlaylist.created_at)
          : serverPlaylist.createdAt
            ? new Date(serverPlaylist.createdAt)
            : new Date(),
        duration: original.duration,
      };

      setPlaylists(prev => [...prev, newPlaylist]);
      toast.success(`Duplicated playlist as "${name}"`);
    } catch (error: any) {
      console.error('Failed to duplicate playlist', error);
      toast.error(error.message || 'Failed to duplicate playlist');
    }
  };

  const hydrateTrackDurationInLibrary = (trackId: string, filePath: string) => {
    const audio = new Audio(resolveUploadsUrl(filePath));
    audio.addEventListener('loadedmetadata', () => {
      if (!isNaN(audio.duration) && audio.duration > 0) {
        setTracks((prev) =>
          prev.map((t) => (t.id === trackId ? { ...t, duration: Math.round(audio.duration) } : t)),
        );
      }
    });
  };

  const handleAddToQueue = async (track: Track) => {
    try {
      const rawItem = await queueAPI.add(track.id);
      const newItem: QueueItem = rawItem?.track
        ? {
            ...rawItem,
            track: {
              ...rawItem.track,
              filePath: resolveUploadsUrl(rawItem.track.filePath || (rawItem.track as any).file_path),
            },
          }
        : (rawItem as any);

      const wasEmpty = queue.length === 0;

      // If we do not have a live WebSocket connection, optimistically update
      // the local queue. When WS is connected, the backend will broadcast the
      // new queue state, so we avoid double-adding.
      if (!hasLiveQueueRef.current) {
        setQueue(prev => [...prev, newItem]);

        // If this is the first item in the queue, reflect it immediately in the playback bar
        if (wasEmpty && !currentQueueItemId) {
          setCurrentQueueItemId(newItem.id);
        }
      }

      toast.success(`Added "${track.name}" to queue`);
    } catch (error: any) {
      console.error('Failed to add to queue', error);
      toast.error(error.message || 'Failed to add to queue');
    }
  };

  // Whenever the queue goes from empty to non-empty and nothing is selected,
  // reflect the first item in the playback bar without auto-playing.
  useEffect(() => {
    if (prevQueueLengthRef.current === 0 && queue.length > 0 && !currentQueueItemId) {
      setCurrentQueueItemId(queue[0].id);
    }
    prevQueueLengthRef.current = queue.length;
  }, [queue, currentQueueItemId]);

  // Track when playback actually starts (wall-clock). Selection changes
  // while paused should NOT reset start time, otherwise history timestamps
  // drift away from the queue timing display.
  useEffect(() => {
    if (!currentQueueItemId) {
      playbackStartedQueueItemIdRef.current = null;
      setNowPlayingStart(null);
      return;
    }

    if (!isPlaying) {
      return;
    }

    if (playbackStartedQueueItemIdRef.current !== currentQueueItemId) {
      playbackStartedQueueItemIdRef.current = currentQueueItemId;
      setNowPlayingStart(new Date());
    }
  }, [currentQueueItemId, isPlaying]);

  // Clear any seek override when the playing item changes so the next
  // track's timing derives from its own start.
  useEffect(() => {
    setSeekAnchor(null);
  }, [currentQueueItemId]);

  // Adjust start time when pausing/resuming so future timings stay accurate
  useEffect(() => {
    if (!nowPlayingStart) return;

    if (!isPlaying && !pauseStartedAtRef.current) {
      pauseStartedAtRef.current = new Date();
    } else if (isPlaying && pauseStartedAtRef.current) {
      const now = new Date();
      const delta = now.getTime() - pauseStartedAtRef.current.getTime();
      pauseStartedAtRef.current = null;
      setNowPlayingStart(new Date(nowPlayingStart.getTime() + delta));
    }
  }, [isPlaying, nowPlayingStart]);

  const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
  const ALLOWED_UPLOAD_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);
  const ALLOWED_UPLOAD_MIME_TYPES = new Set([
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/ogg',
    'audio/flac',
    'audio/x-flac',
    'audio/mp4',
    'audio/aac',
    'video/mp4',
    'application/ogg',
  ]);

  const isValidUploadFile = (file: File) => {
    if (!file) return { ok: false as const, reason: 'Invalid file' };
    if (file.size > MAX_UPLOAD_BYTES) return { ok: false as const, reason: 'File too large' };
    const lower = String(file.name || '').toLowerCase();
    const dot = lower.lastIndexOf('.');
    const ext = dot >= 0 ? lower.slice(dot) : '';
    if (!ext || !ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
      return { ok: false as const, reason: 'Invalid file type' };
    }
    const mime = String((file as any).type || '').toLowerCase();
    if (mime && !mime.startsWith('audio/') && !ALLOWED_UPLOAD_MIME_TYPES.has(mime)) {
      return { ok: false as const, reason: 'Invalid file type' };
    }
    return { ok: true as const, reason: '' };
  };

  const handleImportTracks = async (files: File[], folderId?: string) => {
    let imported = 0;
    let duplicates = 0;
    let failed = 0;
    let folderDuplicateMode: 'ask' | 'addAll' = 'ask';
    let libraryDuplicateMode: 'ask' | 'addAll' = 'ask';
    let canceledImport = false;
    let existingFolderNames: string[] = [];

    if (folderId) {
      try {
        const raw = await foldersAPI.getTracks(folderId);
        existingFolderNames = (raw || []).map((t: any) => String(t.name || '')).filter(Boolean);
      } catch (err) {
        console.error('Failed to load existing folder tracks for duplicate detection', err);
      }
    }
    const importedIds: string[] = [];

    for (const file of files) {
      if (canceledImport) break;

      const validation = isValidUploadFile(file);
      if (!validation.ok) {
        failed += 1;
        toast.error(`${validation.reason}: ${file?.name || 'file'}`);
        continue;
      }

      const detectedDuration = await getAudioDuration(file);

      const formData = new FormData();

      // For folder imports, if a file with the same base name already exists
      // in that folder, ask the operator whether to Skip (this file only),
      // Cancel (stop the whole batch), Add (with a new numbered name), or
      // Add All Copy for remaining duplicates.
      if (folderId) {
        const dotIndex = file.name.lastIndexOf('.');
        const baseName = dotIndex > 0 ? file.name.slice(0, dotIndex) : file.name;

        const namePattern = new RegExp(`^${escapeRegExp(baseName)}(?: \\((\\d+)\\))?$`);
        const hasSameBase = existingFolderNames.some((name) => namePattern.test(name));
        if (hasSameBase) {
          let decision: 'skip' | 'cancel' | 'add' | 'addAll' = 'add';
          if (folderDuplicateMode === 'addAll') {
            decision = 'addAll';
          } else {
            decision = await askFolderDuplicateDecision(baseName, file.name);
          }

          if (decision === 'skip') {
            duplicates += 1;
            continue;
          }

          if (decision === 'cancel') {
            canceledImport = true;
            break;
          }

          const newName = getNextSequentialName(baseName, existingFolderNames);
          existingFolderNames.push(newName);
          formData.append('name', newName);

          if (decision === 'addAll') {
            folderDuplicateMode = 'addAll';
          }
        }
      }

      formData.append('file', file);
      if (detectedDuration > 0) {
        formData.append('duration', String(detectedDuration));
      }

      try {
        const uploadData = await apiClient.request<any>('/tracks/upload', {
          method: 'POST',
          body: formData,
          allowedStatuses: [409],
        });

        if (uploadData?.existingTrack) {
          // Duplicate audio file based on hash.
          const existingTrack = uploadData?.existingTrack;

          if (!existingTrack) {
            duplicates += 1;
            continue;
          }

          // For folder imports, generate a folder-level OS-style name so
          // duplicates show as Sahiba, Sahiba (1), Sahiba (2) inside that
          // folder, and persist that name via aliasName on the backend.
          let aliasName: string | undefined;
          if (folderId) {
            const dotIndex = file.name.lastIndexOf('.');
            const baseName = dotIndex > 0 ? file.name.slice(0, dotIndex) : file.name;
            aliasName = getNextSequentialName(baseName, existingFolderNames);
            // We will push the final alias name into existingFolderNames only
            // after the alias has been created successfully.
          } else {
            // Library-level duplicate: do not show a dialog. Always create
            // an alias using OS-style gap-filling naming across the entire
            // library so repeated imports of the same file produce
            // Sahiba, Sahiba (1), Sahiba (2), ...
            const allNames: string[] = tracks
              .map(t => String(t.name || ''))
              .filter(Boolean);
            const baseName = String(existingTrack.name || '').replace(/ \((\d+)\)$/, '');
            aliasName = getNextSequentialName(baseName, allNames);
          }

          // Create an alias track that reuses the same file but with an
          // auto-renamed title (either global OS-style or folder-specific).
          const fallbackName = String(existingTrack.name || file.name || '');
          const t = await tracksAPI.alias(existingTrack.id, aliasName || fallbackName);
          const mapped: Track = {
            id: t.id,
            name: t.name,
            artist: t.artist,
            duration: t.duration && t.duration > 0 ? t.duration : detectedDuration,
            size: t.size,
            filePath: resolveUploadsUrl((t as any).filePath || (t as any).file_path),
            hash: t.hash,
            dateAdded: (t as any).date_added ? new Date((t as any).date_added) : new Date(),
          };
          setTracks(prev => [mapped, ...prev]);
          importedIds.push(mapped.id);
          if (folderId) {
            existingFolderNames.push(mapped.name);
          }
          if ((!t.duration || t.duration === 0) && mapped.filePath) {
            hydrateTrackDurationInLibrary(mapped.id, mapped.filePath);
          }
          imported += 1;
          continue;
        }

        // Successful upload
        const t = uploadData;
        if (!t?.id) {
          failed += 1;
          continue;
        }
        const mapped: Track = {
          id: t.id,
          name: t.name,
          artist: t.artist,
          duration: t.duration && t.duration > 0 ? t.duration : detectedDuration,
          size: t.size,
          filePath: resolveUploadsUrl(t.filePath || t.file_path),
          hash: t.hash,
          dateAdded: t.date_added ? new Date(t.date_added) : new Date(),
        };
        setTracks(prev => [mapped, ...prev]);
        importedIds.push(mapped.id);
        if (folderId) {
          existingFolderNames.push(mapped.name);
        }
        if ((!t.duration || t.duration === 0) && mapped.filePath) {
          hydrateTrackDurationInLibrary(mapped.id, mapped.filePath);
        }
        imported += 1;
      } catch (error) {
        console.error('Failed to import track', error);
        failed += 1;
      }
    }

    // If files were added for a specific library folder, associate them
    if (folderId && importedIds.length > 0) {
      try {
        await foldersAPI.attachTracks(folderId, importedIds);
      } catch (err) {
        console.error('Failed to link imported tracks to folder', err);
      }
    }

    toast.success('Import summary', {
      description: `${imported} imported, ${duplicates} duplicates skipped, ${failed} failed`,
    });
  };

  const handleRemoveFromQueue = async (id: string) => {
    const target = queue.find(item => item.id === id);
    const isCurrent = Boolean(target && currentQueueItemId && target.id === currentQueueItemId);

    if (isCurrent) {
      const ok = confirm('This track is currently playing. Skip and remove it from the queue?');
      if (!ok) return;
      // Advance playback first so audio keeps flowing
      handleNext();
    }

    const previousQueue = queue;

    // Optimistically update local queue for non-current items
    if (!isCurrent) {
      setQueue(queue.filter(item => item.id !== id));
    }

    // Check if removed song had any scheduled playlists
    setScheduledPlaylists(prev => 
      prev.filter(schedule => schedule.queueSongId !== id)
    );

    try {
      await queueAPI.remove(id);
    } catch (error: any) {
      if (error instanceof ApiError && error.status === 404) {
        toast.info('Queue item was already removed');
        return;
      }
      console.error('Failed to remove from queue', error);
      if (!isCurrent) {
        setQueue(previousQueue);
      }
      toast.error(error.message || 'Failed to remove from queue');
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTypingTarget =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          (target as any).isContentEditable);

      if (isTypingTarget) return;

      if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        toggleQueueDialog();
        return;
      }
      if (e.key === 'Escape') {
        setQueueDialogOpen(false);
      }

      if (!queueDialogOpen) return;
      if (queueDialogLocked) return;
      if (!selectedQueueItemId) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleRemoveFromQueue(selectedQueueItemId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [queueDialogLocked, queueDialogOpen, selectedQueueItemId, toggleQueueDialog, handleRemoveFromQueue]);

  const handleReorderQueue = async (items: QueueItem[]) => {
    const previousQueue = queue;

    // Optimistically update queue order
    setQueue(items);

    try {
      const queueIds = items.map(i => i.id);
      await queueAPI.reorder(queueIds);
    } catch (error: any) {
      console.error('Failed to reorder queue', error);
      // Roll back to previous order
      setQueue(previousQueue);
      toast.error(error.message || 'Failed to reorder queue');
    }
  };

  // Keep the currently playing item pinned to the top of the queue.
  // This also persists the order so the position remains stable across
  // refresh/reconnect.
  useEffect(() => {
    if (!currentQueueItemId) return;
    if (queue.length === 0) return;
    if (queue[0]?.id === currentQueueItemId) {
      pinnedQueueItemIdRef.current = currentQueueItemId;
      return;
    }

    // Avoid re-sending reorder for the same playing item if we're already
    // waiting for the queue state to reflect it.
    if (pinnedQueueItemIdRef.current === currentQueueItemId) return;

    const idx = queue.findIndex((q) => q.id === currentQueueItemId);
    if (idx < 0) return;

    pinnedQueueItemIdRef.current = currentQueueItemId;
    const next = [queue[idx], ...queue.slice(0, idx), ...queue.slice(idx + 1)];
    void handleReorderQueue(next);
  }, [currentQueueItemId, queue]);

  // Playlist Management
  const handleAddToPlaylist = async (track: Track, playlistId: string, fromDragDrop = false) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;
    if (playlist.locked) {
      toast.error('Playlist is locked');
      return;
    }

    try {
      const existingNames: string[] = (playlist.tracks || [])
        .map(t => String(t.name || ''))
        .filter(Boolean);

      const baseName = track.name.replace(/ \((\d+)\)$/, '');
      const desiredName = getNextSequentialName(baseName, existingNames);

      // If the desired name is exactly the same as the current track name
      // and there is no conflicting base in this playlist, we can safely
      // reuse the existing track without creating an alias.
      const namePattern = new RegExp(`^${escapeRegExp(baseName)}(?: \\((\\d+)\\))?$`);
      const hasSameBase = existingNames.some(name => namePattern.test(name));

      let trackToAttach: Track = track;

      if (hasSameBase) {
        const t = await tracksAPI.alias(track.id, desiredName);
        const aliasTrack: Track = {
          id: t.id,
          name: t.name,
          artist: t.artist,
          duration: t.duration && t.duration > 0 ? t.duration : track.duration,
          size: t.size,
          filePath: resolveUploadsUrl((t as any).filePath || (t as any).file_path),
          hash: t.hash,
          dateAdded: (t as any).date_added ? new Date((t as any).date_added) : new Date(),
        };

        setTracks(prev => [aliasTrack, ...prev]);
        trackToAttach = aliasTrack;
      }

      await playlistsAPI.addTracks(playlistId, [trackToAttach.id]);

      setPlaylists(prev => prev.map(p => {
        if (p.id !== playlistId) return p;
        const newTracks = [...p.tracks, trackToAttach];
        return {
          ...p,
          tracks: newTracks,
          duration: newTracks.reduce((sum, t) => sum + t.duration, 0)
        };
      }));

      if (fromDragDrop) {
        setRecentPlaylistAdd({ playlistId, trackId: trackToAttach.id, createdAt: Date.now() });
      }

      toast.success(`Added to "${playlist.name}"`);
    } catch (error: any) {
      console.error('Failed to add track to playlist', error);
      toast.error(error.message || 'Failed to add track to playlist');
    }
  };

  const handleDropTrackOnPlaylistPanel = async (
    playlistId: string,
    trackId: string,
    insertIndex: number,
  ) => {
    const playlist = playlists.find((p) => p.id === playlistId);
    if (!playlist) return;
    if (playlist.locked) {
      toast.error('Playlist is locked');
      return;
    }

    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;

    try {
      const existingNames: string[] = (playlist.tracks || [])
        .map((t) => String(t.name || ''))
        .filter(Boolean);

      const baseName = track.name.replace(/ \((\d+)\)$/,'');
      const desiredName = getNextSequentialName(baseName, existingNames);

      const namePattern = new RegExp(`^${escapeRegExp(baseName)}(?: \\((\\d+)\\))?$`);
      const hasSameBase = existingNames.some((name) => namePattern.test(name));

      let trackToAttach: Track = track;

      if (hasSameBase) {
        const t = await tracksAPI.alias(track.id, desiredName);
        const aliasTrack: Track = {
          id: t.id,
          name: t.name,
          artist: t.artist,
          duration: t.duration && t.duration > 0 ? t.duration : track.duration,
          size: t.size,
          filePath: resolveUploadsUrl((t as any).filePath || (t as any).file_path),
          hash: t.hash,
          dateAdded: (t as any).date_added ? new Date((t as any).date_added) : new Date(),
        };

        setTracks((prev) => [aliasTrack, ...prev]);
        trackToAttach = aliasTrack;
      }

      await playlistsAPI.addTracks(playlistId, [trackToAttach.id]);

      // Compute the new in-memory order with the item inserted at insertIndex
      let newTracks: Track[] = [];
      setPlaylists((prev) =>
        prev.map((p) => {
          if (p.id !== playlistId) return p;

          const clampedIndex = Math.min(Math.max(insertIndex, 0), p.tracks.length);
          const before = p.tracks.slice(0, clampedIndex);
          const after = p.tracks.slice(clampedIndex);
          newTracks = [...before, trackToAttach, ...after];

          return {
            ...p,
            tracks: newTracks,
            duration: newTracks.reduce((sum, t2) => sum + t2.duration, 0),
          };
        }),
      );

      setRecentPlaylistAdd({ playlistId, trackId: trackToAttach.id, createdAt: Date.now() });

      // Persist the new order so the DB matches the visual insertion position
      if (newTracks.length > 0) {
        const trackIds = newTracks.map((t) => t.id);
        try {
          await playlistsAPI.reorder(playlistId, trackIds);
        } catch (err) {
          console.error('Failed to persist playlist reorder', err);
        }
      }

      toast.success(`Added to "${playlist.name}"`);
    } catch (error: any) {
      console.error('Failed to add track to playlist at position', error);
      toast.error(error.message || 'Failed to add track to playlist');
    }
  };

  // When adding a song from the live queue into a playlist, create a real
  // file copy with special naming so edits to that playlist entry do not
  // affect the original. This uses the backend /tracks/copy endpoint.
  const handleAddQueueItemToPlaylist = async (item: QueueItem, playlistId: string) => {
    const playlist = playlists.find((p) => p.id === playlistId);
    if (!playlist) return;
    if (playlist.locked) {
      toast.error('Playlist is locked');
      return;
    }

    try {
      const t = await tracksAPI.copy(item.track.id);
      const newTrack: Track = {
        id: t.id,
        name: t.name,
        artist: t.artist,
        duration: t.duration,
        size: t.size,
        filePath: resolveUploadsUrl((t as any).filePath || (t as any).file_path),
        hash: t.hash,
        dateAdded: (t as any).date_added ? new Date((t as any).date_added) : new Date(),
      };

      setTracks((prev) => [newTrack, ...prev]);

      await playlistsAPI.addTracks(playlistId, [newTrack.id]);

      setPlaylists((prev) =>
        prev.map((p) => {
          if (p.id !== playlistId) return p;
          const newTracks = [...p.tracks, newTrack];
          return {
            ...p,
            tracks: newTracks,
            duration: newTracks.reduce((sum, t2) => sum + t2.duration, 0),
          };
        }),
      );

      toast.success(`Copied to "${playlist.name}" from queue`);
    } catch (error: any) {
      console.error('Failed to copy queue track to playlist', error);
      toast.error(error.message || 'Failed to copy track to playlist');
    }
  };

  const handleCreatePlaylist = () => {
    setPlaylistNameDialog({ mode: 'create', name: '' });
  };

  const handleRenamePlaylist = async (playlistId: string) => {
    const playlist = playlists.find((p) => p.id === playlistId);
    if (!playlist || playlist.locked) return;
    setPlaylistNameDialog({ mode: 'rename', playlistId, name: playlist.name });
  };

  const submitPlaylistNameDialog = async () => {
    if (!playlistNameDialog) return;
    const name = playlistNameDialog.name.trim();
    if (!name) {
      setPlaylistNameDialog(null);
      return;
    }

    if (playlistNameDialog.mode === 'create') {
      const exists = playlists.some((p) => p.name.toLowerCase() === name.toLowerCase());
      if (exists) {
        toast.error('Playlist name already exists');
        return;
      }

      try {
        const serverPlaylist: any = await playlistsAPI.create(name);
        const newPlaylist: Playlist = {
          id: serverPlaylist.id,
          name: serverPlaylist.name,
          tracks: [],
          locked: Boolean(serverPlaylist.locked),
          createdAt: serverPlaylist.created_at
            ? new Date(serverPlaylist.created_at)
            : serverPlaylist.createdAt
              ? new Date(serverPlaylist.createdAt)
              : new Date(),
          duration: serverPlaylist.duration ?? 0,
        };

        setPlaylists((prev) => [...prev, newPlaylist]);
        toast.success(`Created playlist "${name}"`);
        setPlaylistNameDialog(null);
      } catch (error: any) {
        console.error('Failed to create playlist', error);
        toast.error(error.message || 'Failed to create playlist');
      }

      return;
    }

    const playlistId = playlistNameDialog.playlistId;
    const playlist = playlists.find((p) => p.id === playlistId);
    if (!playlist || playlist.locked) {
      setPlaylistNameDialog(null);
      return;
    }

    if (name === playlist.name) {
      setPlaylistNameDialog(null);
      return;
    }

    const exists = playlists.some(
      (p) => p.id !== playlistId && p.name.toLowerCase() === name.toLowerCase(),
    );
    if (exists) {
      toast.error('Playlist name already exists');
      return;
    }

    const previousPlaylists = playlists;
    setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? { ...p, name } : p)));

    try {
      await playlistsAPI.update(playlistId, { name });

      toast.success('Playlist renamed');
      setPlaylistNameDialog(null);
    } catch (error: any) {
      console.error('Failed to rename playlist', error);
      setPlaylists(previousPlaylists);
      toast.error(error.message || 'Failed to rename playlist');
    }
  };

  const handleDeletePlaylist = async (playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist || playlist.locked) return;

    if (!confirm(`Delete playlist "${playlist.name}"?`)) return;

    const previousPlaylists = playlists;

    // Optimistically remove playlist from UI
    setPlaylists(prev => prev.filter(p => p.id !== playlistId));

    try {
      await playlistsAPI.delete(playlistId);
      toast.success('Playlist deleted');
    } catch (error: any) {
      console.error('Failed to delete playlist', error);
      // Roll back optimistic removal
      setPlaylists(previousPlaylists);
      toast.error(error.message || 'Failed to delete playlist');
    }
  };

  const setPlaylistLocked = async (playlistId: string, locked: boolean) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return false;

    const previousPlaylists = playlists;

    // Optimistically update UI (same as right-click Lock)
    setPlaylists(prev => prev.map(p =>
      p.id === playlistId ? { ...p, locked } : p
    ));

    try {
      const updated: any = await playlistsAPI.update(playlistId, { locked });

      // Ensure local state matches backend response
      setPlaylists(prev => prev.map(p =>
        p.id === playlistId ? { ...p, locked: Boolean(updated?.locked) } : p
      ));
      return true;
    } catch (error: any) {
      console.error('Failed to update lock state', error);
      // Roll back optimistic change
      setPlaylists(previousPlaylists);
      toast.error(error.message || 'Failed to update playlist lock state');
      return false;
    }
  };

  const handleToggleLockPlaylist = async (playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;
    await setPlaylistLocked(playlistId, !playlist.locked);
  };

  const handleAddSongsToPlaylist = (playlistId: string, newTracks: Track[]) => {
    setPlaylists(playlists.map(playlist => {
      if (playlist.id === playlistId) {
        const combinedTracks = [...playlist.tracks, ...newTracks];
        return {
          ...playlist,
          tracks: combinedTracks,
          duration: combinedTracks.reduce((sum, t) => sum + t.duration, 0)
        };
      }
      return playlist;
    }));
  };

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

  const handleImportFilesToPlaylist = async (
    playlistId: string,
    files: File[],
    insertIndex?: number,
    suppressDuplicateDialog = false,
  ) => {
    // ...
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;
    if (playlist.locked) {
      toast.error('Playlist is locked');
      return;
    }

    let importedTracks: Track[] = [];
    let duplicates = 0;
    let failed = 0;

    // Track existing names in this playlist so we can apply OS-style,
    // gap-filling naming (Name, Name (1), Name (2), reusing gaps) when
    // importing files directly into the playlist.
    let existingNames: string[] = (playlist.tracks || [])
      .map(t => String(t.name || ''))
      .filter(Boolean);

    for (const file of files) {
      const validation = isValidUploadFile(file);
      if (!validation.ok) {
        failed += 1;
        toast.error(`${validation.reason}: ${file?.name || 'file'}`);
        continue;
      }

      const detectedDuration = await getAudioDuration(file);
      const formData = new FormData();
      formData.append('file', file);

      // Derive a base name from the file name and apply playlist-level
      // OS-style naming so duplicates inside this playlist follow
      // Name, Name (1), Name (2) and fill gaps after deletions.
      const dotIndex = file.name.lastIndexOf('.');
      const baseName = dotIndex > 0 ? file.name.slice(0, dotIndex) : file.name;
      const desiredName = getNextSequentialName(baseName, existingNames);
      formData.append('name', desiredName);

      if (detectedDuration > 0) {
        formData.append('duration', String(detectedDuration));
      }

      try {
        const uploadData = await apiClient.request<any>('/tracks/upload', {
          method: 'POST',
          body: formData,
          allowedStatuses: [409],
        });

        if (uploadData?.existingTrack) {
          // Duplicate audio file. For OS drag-and-drop into playlists we
          // suppress the interactive dialog and always behave like "Add
          // Copy", so large drops remain smooth.
          const existingTrack = uploadData?.existingTrack;

          if (!existingTrack) {
            duplicates += 1;
            continue;
          }

          // If the audio already exists in the library, adding it to a
          // different playlist should not be treated as a warning-worthy
          // duplication. Always create a playlist-local alias copy.
          const decision: 'skip' | 'cancel' | 'add' | 'addAll' = 'add';

          // For duplicate-audio cases, create an alias that also respects the
          // playlist-level OS-style naming. Use desiredName so the alias name
          // in the library matches what we show inside this playlist.
          const t = await tracksAPI.alias(existingTrack.id, desiredName);
          const mapped: Track = {
            id: t.id,
            name: t.name,
            artist: t.artist,
            duration: t.duration && t.duration > 0 ? t.duration : detectedDuration,
            size: t.size,
            filePath: resolveUploadsUrl((t as any).filePath || (t as any).file_path),
            hash: t.hash,
            dateAdded: (t as any).date_added ? new Date((t as any).date_added) : new Date(),
          };
          importedTracks.push(mapped);
          existingNames.push(mapped.name);
          if ((!t.duration || t.duration === 0) && mapped.filePath) {
            hydrateTrackDurationInLibrary(mapped.id, mapped.filePath);
          }
          continue;
        }

        const t = uploadData;
        if (!t?.id) {
          failed += 1;
          continue;
        }
        const mapped: Track = {
          id: t.id,
          name: t.name,
          artist: t.artist,
          duration: t.duration && t.duration > 0 ? t.duration : detectedDuration,
          size: t.size,
          filePath: resolveUploadsUrl(t.filePath || t.file_path),
          hash: t.hash,
          dateAdded: t.date_added ? new Date(t.date_added) : new Date(),
        };
        importedTracks.push(mapped);
        existingNames.push(mapped.name);
        if ((!t.duration || t.duration === 0) && mapped.filePath) {
          hydrateTrackDurationInLibrary(mapped.id, mapped.filePath);
        }
      } catch (error) {
        console.error('Failed to import track for playlist', error);
        failed += 1;
      }
    }

    if (importedTracks.length === 0) {
      toast.error('No new tracks imported for playlist');
      return;
    }

    try {
      const trackIds = importedTracks.map(t => t.id);
      await playlistsAPI.addTracks(playlistId, trackIds);

      // Update playlists state: merge importedTracks into the selected playlist's tracks,
      // either appended or inserted at a specific index when provided.
      let newTracksForReorder: Track[] = [];
      setPlaylists(prev => prev.map(p => {
        if (p.id !== playlistId) return p;

        const current = p.tracks || [];
        const baseLen = current.length;
        const targetIndex =
          insertIndex != null ? Math.min(Math.max(insertIndex, 0), baseLen) : baseLen;
        const before = current.slice(0, targetIndex);
        const after = current.slice(targetIndex);
        const combined = [...before, ...importedTracks, ...after];

        newTracksForReorder = combined;

        return {
          ...p,
          tracks: combined,
          duration: combined.reduce((sum, t) => sum + t.duration, 0),
        };
      }));

      // If we inserted at a specific position, persist the new order so the
      // backend playlist positions match the UI.
      if (insertIndex != null && newTracksForReorder.length > 0) {
        const trackIdsForReorder = newTracksForReorder.map(t => t.id);
        try {
          await playlistsAPI.reorder(playlistId, trackIdsForReorder);
        } catch (err) {
          console.error('Failed to persist playlist reorder after import', err);
        }
      }

      // Reflect the newly imported audio in the queue/playback bar.
      // For OS drag-and-drop into playlists we only update the playlist; we
      // do not automatically enqueue.
      if (!suppressDuplicateDialog && importedTracks.length > 0) {
        handleAddToQueue(importedTracks[0]);
      }

      toast.success('Playlist updated', {
        description: `${importedTracks.length} imported, ${duplicates} duplicates skipped, ${failed} failed`,
      });
    } catch (error: any) {
      console.error('Failed to attach tracks to playlist', error);
      toast.error(error.message || 'Failed to update playlist');
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

  // Playback Controls
  // Record real listening time for tracks by writing a separate history row
  // for each play instance (including duplicates and scheduled plays).
  const logPlaybackHistory = (
    track: Track,
    options?: {
      completed?: boolean;
      source?: string;
      playedAtOverride?: string;
      positionEndOverrideSeconds?: number;
    },
  ) => {
    const source = options?.source ?? 'queue';
    const completed = options?.completed ?? true;

    // Derive how long this track has actually been playing based on
    // nowPlayingStart and the current wall clock. Clamp to at least 1s so
    // very short or immediately-preempted plays (e.g. when a schedule fires
    // mid-track) are still logged.
    const now = new Date();
    const baseStart = options?.playedAtOverride ? new Date(options.playedAtOverride) : nowPlayingStart ?? now;
    const elapsedMs = now.getTime() - baseStart.getTime();
    const elapsedSeconds = Math.max(1, Math.round(elapsedMs / 1000));
    const playheadSeconds = Math.max(0, Math.round(playbackPositionSecondsRef.current || 0));
    const positionEnd =
      typeof options?.positionEndOverrideSeconds === 'number'
        ? Math.max(0, options.positionEndOverrideSeconds)
        : Math.max(elapsedSeconds, playheadSeconds);

    const payload = {
      trackId: track.id,
      playedAt: baseStart.toISOString(),
      positionStart: 0,
      positionEnd,
      completed,
      source,
      fileStatus: 'ok',
    };

    historyAPI
      .create(payload)
      .catch((error) => {
        console.error('Failed to write playback history', error);
      });
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
    setTrackToRemove(trackId);
  };

  const confirmRemoveTrack = async () => {
    if (!trackToRemove) return;
    const id = trackToRemove;
    setTrackToRemove(null);

    try {
      await tracksAPI.delete(id);
      setTracks(prev => prev.filter(track => track.id !== id));
    } catch (error) {
      console.error(error);
      toast.error('Failed to remove track');
    }
  };

  const handlePlayPause = () => {
    if (!currentQueueItemId && queue.length > 0) {
      setCurrentQueueItemId(queue[0].id);
      setIsPlaying(true);
      setNowPlayingStart(new Date());
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

    // Log history entry for the track we are leaving
    logPlaybackHistory(finishedItem.track, { completed: true, source: 'queue' });

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
      setNowPlayingStart(new Date());
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
              variant="ghost"
              size="sm"
              className="gap-2 text-xs bg-muted/10 hover:bg-muted/20 text-foreground/80 hover:text-foreground border border-transparent hover:border-border/60"
              onClick={() => setHistoryOpen(true)}
              title="History"
            >
              <Clock className="w-4 h-4" />
              <span>History</span>
            </Button>

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

            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </div>
      </div>

      {/* Main two-panel layout: Library | Playlists */}
      <div className="flex flex-1 min-h-0 pb-20">
        {/* Library (left) */}
        <div className="flex-shrink-0 h-full" style={{ width: leftPanel.width }}>
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
              onAddToQueue={handleAddToQueue}
              onAddToPlaylist={handleAddToPlaylist}
              onSelectPlaylist={() => {}}
              onCreatePlaylist={handleCreatePlaylist}
              onRenamePlaylist={handleRenamePlaylist}
              onDeletePlaylist={handleDeletePlaylist}
              onToggleLockPlaylist={handleToggleLockPlaylist}
              onRemoveTrack={handleRemoveTrack}
              onImportTracks={handleImportTracks}
            />
          </ErrorBoundary>
        </div>

        {/* Resize handle between Library and Playlists */}
        <ResizeHandle
          onMouseDown={leftPanel.handleMouseDown}
          isResizing={leftPanel.isResizing}
        />

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
              scheduledPlaylists={scheduledPlaylists}
              onDeleteSchedule={handleDeleteSchedule}
              onDropTrackOnPlaylistHeader={handleDropTrackOnPlaylistHeader}
              onDropFilesOnPlaylistHeader={handleOsDropFilesOnPlaylistHeader}
              onDropTrackOnPlaylistPanel={handleDropTrackOnPlaylistPanel}
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
            showHeader={false}
          />
        </ErrorBoundary>
      </FloatingQueueDialog>

      {/* Bottom Playback Bar */}
      <div className="fixed left-0 right-0 bottom-0 z-50">
        <PlaybackBar
          currentTrack={currentTrack}
          nextTrack={nextTrack}
          isPlaying={isPlaying}
          onPlayPause={handlePlayPause}
          onNext={handleNext}
          onPrevious={handlePrevious}
          isLive={isLive}
          crossfadeSeconds={crossfadeSeconds}
          onCrossfadeChange={setCrossfadeSeconds}
          audioDevices={audioDevices}
          onSeek={handleSeekWithTiming}
          onProgress={handlePlaybackProgress}
        />
      </div>

      <Toaster position="bottom-right" />

      {scheduleDialogOpen && selectedPlaylistForSchedule && (
        <SchedulePlaylistDialog
          open={scheduleDialogOpen}
          onOpenChange={handleScheduleDialogOpenChange}
          playlistName={selectedPlaylistForSchedule.name}
          queue={queue}
          onSchedule={handleScheduleConfirm}
        />
      )}

      <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />

      <ConfirmDialog
        open={trackToRemove !== null}
        title="Remove track from library?"
        description="This will delete the track from your library. Playlists that use it may be affected."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        onConfirm={confirmRemoveTrack}
        onCancel={() => setTrackToRemove(null)}
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
                  "{duplicatePrompt.existingName}" is already in your library.
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