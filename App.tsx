import { useState, useEffect, useRef } from 'react';
import { LibraryPanel } from './components/LibraryPanel';
import { PlaylistManager } from './components/PlaylistManager';
import { QueuePanel } from './components/QueuePanel';
import { PlaybackBar } from './components/PlaybackBar';
import { ThemeToggle } from './components/ThemeToggle';
import { ResizeHandle } from './components/ResizeHandle';
import { SchedulePlaylistDialog, ScheduleConfig } from './components/SchedulePlaylistDialog';
import { HistoryDialog } from './components/HistoryDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Clock } from 'lucide-react';
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

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLive, setIsLive] = useState(true);
  const [scheduledPlaylists, setScheduledPlaylists] = useState<ScheduledPlaylist[]>([]);
  const [crossfadeSeconds, setCrossfadeSeconds] = useState(2);
  const [nowPlayingStart, setNowPlayingStart] = useState<Date | null>(null);
  const pauseStartedAtRef = useRef<Date | null>(null);
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

  // Single shared Audio Guard state for the entire app: header Output control
  // and the playback engine both use this instance.
  const audioDevices = useAudioDevices();
  const {
    devices: headerOutputDevices,
    selectedDeviceId: headerSelectedDeviceId,
    setSelectedDeviceId: setHeaderSelectedDeviceId,
    supportsOutputSelection: headerSupportsOutputSelection,
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

    const now = new Date();
    const newStart = new Date(now.getTime() - seconds * 1000);
    setNowPlayingStart(newStart);
  };

  const leftPanel = useResizable({ initialWidth: 320, minWidth: 250, maxWidth: 500 });
  const rightPanel = useResizable({ initialWidth: 320, minWidth: 250, maxWidth: 500 });

  const currentQueueItem = currentTrackId
    ? queue.find((item) => item.track.id === currentTrackId) || null
    : null;
  const currentTrack = currentQueueItem?.track || null;
  const currentTrackRef = useRef<Track | null>(null);
  const currentTrackIdRef = useRef<string | null>(null);
  const currentQueueItemId = currentQueueItem?.id || null;
  const hasLiveQueueRef = useRef(false);

  // Determine the next track in the queue for crossfade/preview logic.
  const currentIndex = currentTrackId
    ? queue.findIndex((item) => item.track.id === currentTrackId)
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
    currentTrackId,
    isPlaying,
    nowPlayingStart,
    crossfadeSeconds,
  });

  const handleDropTrackOnPlaylistHeader = async (playlistId: string, trackId: string) => {
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;
    await handleAddToPlaylist(track, playlistId);
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
    fetch('/api/tracks')
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `Failed to load tracks (${res.status})`);
        }
        return res.json();
      })
      .then((serverTracks) => {
        const mapped: Track[] = serverTracks.map((t: any) => ({
          id: t.id,
          name: t.name,
          artist: t.artist,
          duration: t.duration,
          size: t.size,
          filePath: t.file_path,
          hash: t.hash,
          dateAdded: t.date_added ? new Date(t.date_added) : new Date(),
        }));
        setTracks(mapped);
      })
      .catch((error: any) => {
        console.error('Failed to load tracks', error);
        toast.error(error.message || 'Failed to load tracks');
      });
  }, []);


  // Keep refs in sync with the latest current track so the WebSocket
  // handlers can safely reason about preemption.
  useEffect(() => {
    currentTrackRef.current = currentTrack;
    currentTrackIdRef.current = currentTrackId;
  }, [currentTrack, currentTrackId]);

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
        if (data.type === 'queue-updated' && Array.isArray(data.queue)) {
          const newQueue: QueueItem[] = data.queue;

          const previousCurrentId = currentTrackIdRef.current;
          const wasCurrentStillPresent = previousCurrentId
            ? newQueue.some((item) => item.track.id === previousCurrentId)
            : false;

          setQueue(newQueue);

          const firstTrackId = newQueue[0]?.track?.id ?? null;

          // Explicit scheduler preemption: when the backend marks a
          // datetime schedule as fired it tags this event so we always
          // jump to the new head, even if it happens to be the same
          // track ID as the one that was already playing.
          if (data.reason === 'schedule-preempt' && firstTrackId) {
            const interruptedTrack = currentTrackRef.current;
            if (interruptedTrack) {
              logPlaybackHistory(interruptedTrack, { completed: false, source: 'queue' });
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

            setCurrentTrackId(firstTrackId);
            setIsPlaying(true);
            setNowPlayingStart(new Date());
            return;
          }

          // Generic preemption detection: previously playing track has
          // disappeared from the queue but there is still a head item.
          if (previousCurrentId && !wasCurrentStillPresent && firstTrackId) {
            const interruptedTrack = currentTrackRef.current;
            if (interruptedTrack) {
              logPlaybackHistory(interruptedTrack, { completed: false, source: 'queue' });
            }
            setCurrentTrackId(firstTrackId);
            setIsPlaying(true);
            setNowPlayingStart(new Date());
          } else {
            // If nothing is currently selected, select the first track for
            // playback context (non-preemption updates).
            setCurrentTrackId((prev) => prev ?? firstTrackId);
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
    fetch('/api/queue')
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `Failed to load queue (${res.status})`);
        }
        return res.json();
      })
      .then((serverQueue) => {
        setQueue(serverQueue as QueueItem[]);
      })
      .catch((error: any) => {
        console.error('Failed to load queue', error);
        toast.error(error.message || 'Failed to load queue');
      });
  }, []);

  // Load playlists from backend so created playlists persist
  useEffect(() => {
    fetch('/api/playlists')
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `Failed to load playlists (${res.status})`);
        }
        return res.json();
      })
      .then((serverPlaylists) => {
        const mapped: Playlist[] = serverPlaylists.map((p: any) => {
          const mappedTracks: Track[] = (p.tracks || []).map((t: any) => ({
            id: t.id,
            name: t.name,
            artist: t.artist,
            duration: t.duration,
            size: t.size,
            filePath: t.file_path,
            hash: t.hash,
            dateAdded: t.created_at ? new Date(t.created_at) : new Date(),
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
      })
      .catch((error: any) => {
        console.error('Failed to load playlists', error);
        toast.error(error.message || 'Failed to load playlists');
      });
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
      // Create new playlist
      const createRes = await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (!createRes.ok) {
        const data = await createRes.json().catch(() => null);
        throw new Error(data?.error || `Failed to duplicate playlist (${createRes.status})`);
      }

      const serverPlaylist = await createRes.json();

      const newPlaylistId = serverPlaylist.id as string;
      const trackIds = original.tracks.map(t => t.id);

      if (trackIds.length > 0) {
        const attachRes = await fetch(`/api/playlists/${newPlaylistId}/tracks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackIds }),
        });

        if (!attachRes.ok) {
          const data = await attachRes.json().catch(() => null);
          throw new Error(data?.error || `Failed to copy tracks (${attachRes.status})`);
        }
      }

      const newPlaylist: Playlist = {
        id: newPlaylistId,
        name,
        tracks: [...original.tracks],
        locked: false,
        createdAt: serverPlaylist.created_at ? new Date(serverPlaylist.created_at) : new Date(),
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
    const audio = new Audio(filePath);
    audio.addEventListener('loadedmetadata', () => {
      if (!isNaN(audio.duration) && audio.duration > 0) {
        const seconds = Math.round(audio.duration);
        setTracks(prev => prev.map(t =>
          t.id === trackId ? { ...t, duration: seconds } : t
        ));
      }
    });
  };

  const handleAddToQueue = async (track: Track) => {
    try {
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId: track.id }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Failed to add to queue (${res.status})`);
      }

      const newItem = await res.json();

      const wasEmpty = queue.length === 0;

      // If we do not have a live WebSocket connection, optimistically update
      // the local queue. When WS is connected, the backend will broadcast the
      // new queue state, so we avoid double-adding.
      if (!hasLiveQueueRef.current) {
        setQueue(prev => [...prev, newItem]);

        // If this is the first item in the queue, reflect it immediately in the playback bar
        if (wasEmpty && !currentTrackId) {
          setCurrentTrackId(track.id);
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
    if (prevQueueLengthRef.current === 0 && queue.length > 0 && !currentTrackId) {
      setCurrentTrackId(queue[0].track.id);
    }
    prevQueueLengthRef.current = queue.length;
  }, [queue, currentTrackId]);

  // Track when the current track actually starts (wall-clock). Only reset
  // when the current track changes so seek-based adjustments to
  // nowPlayingStart are preserved.
  useEffect(() => {
    if (currentTrackId) {
      setNowPlayingStart(new Date());
    }
  }, [currentTrackId]);

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
        const res = await fetch(`/api/folders/${folderId}/tracks`);
        if (res.ok) {
          const raw = await res.json();
          existingFolderNames = (raw || []).map((t: any) => String(t.name || '')).filter(Boolean);
        }
      } catch (err) {
        console.error('Failed to load existing folder tracks for duplicate detection', err);
      }
    }
    const importedIds: string[] = [];

    for (const file of files) {
      if (canceledImport) break;
      const detectedDuration = await getAudioDuration(file);

      const formData = new FormData();

      // For folder imports, if a file with the same base name already exists
      // in that folder, ask the operator whether to Skip (this file only),
      // Cancel (stop the whole batch), Add (with a new numbered name), or
      // Add All Copy for remaining duplicates.
      if (folderId) {
        const dotIndex = file.name.lastIndexOf('.');
        const baseName = dotIndex > 0 ? file.name.slice(0, dotIndex) : file.name;

        const hasSameBase = existingFolderNames.includes(baseName);
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
        const res = await fetch('/api/tracks/upload', {
          method: 'POST',
          body: formData,
        });

        if (res.status === 409) {
          // Duplicate audio file based on hash.
          const data = await res.json().catch(() => null);
          const existingTrack = data?.existingTrack;

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
          const aliasRes = await fetch('/api/tracks/alias', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseTrackId: existingTrack.id, aliasName }),
          });

          if (!aliasRes.ok) {
            const errData = await aliasRes.json().catch(() => null);
            console.error('Alias create failed', errData);
            toast.error(errData?.error || 'Failed to import duplicate copy');
            failed += 1;
            continue;
          }

          const t = await aliasRes.json();
          const mapped: Track = {
            id: t.id,
            name: t.name,
            artist: t.artist,
            duration: t.duration && t.duration > 0 ? t.duration : detectedDuration,
            size: t.size,
            filePath: t.file_path,
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
          continue;
        }

        if (!res.ok) {
          failed += 1;
          continue;
        }

        const t = await res.json();
        const mapped: Track = {
          id: t.id,
          name: t.name,
          artist: t.artist,
          duration: t.duration && t.duration > 0 ? t.duration : detectedDuration,
          size: t.size,
          filePath: t.file_path,
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
        await fetch(`/api/folders/${folderId}/tracks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackIds: importedIds }),
        });
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
    const isCurrent = target && target.track.id === currentTrackId;

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
      const res = await fetch(`/api/queue/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        // If the backend reports 404, the item is already gone on the server.
        // Treat this as success and keep the item removed locally to avoid
        // confusing the operator with a hard error.
        if (res.status === 404) {
          toast.info('Queue item was already removed');
          return;
        }

        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Failed to remove from queue (${res.status})`);
      }
    } catch (error: any) {
      console.error('Failed to remove from queue', error);
      if (!isCurrent) {
        setQueue(previousQueue);
      }
      toast.error(error.message || 'Failed to remove from queue');
    }
  };

  const handleReorderQueue = async (items: QueueItem[]) => {
    const previousQueue = queue;

    // Optimistically update queue order
    setQueue(items);

    try {
      const queueIds = items.map(i => i.id);
      const res = await fetch('/api/queue/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueIds }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Failed to reorder queue (${res.status})`);
      }
    } catch (error: any) {
      console.error('Failed to reorder queue', error);
      // Roll back to previous order
      setQueue(previousQueue);
      toast.error(error.message || 'Failed to reorder queue');
    }
  };

  // Playlist Management
  const handleAddToPlaylist = async (track: Track, playlistId: string) => {
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
        const aliasRes = await fetch('/api/tracks/alias', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseTrackId: track.id, aliasName: desiredName }),
        });

        if (!aliasRes.ok) {
          const data = await aliasRes.json().catch(() => null);
          throw new Error(data?.error || data?.message || `Failed to create alias for playlist duplicate (${aliasRes.status})`);
        }

        const t = await aliasRes.json();
        const aliasTrack: Track = {
          id: t.id,
          name: t.name,
          artist: t.artist,
          duration: t.duration && t.duration > 0 ? t.duration : track.duration,
          size: t.size,
          filePath: t.file_path,
          hash: t.hash,
          dateAdded: t.date_added ? new Date(t.date_added) : new Date(),
        };

        setTracks(prev => [aliasTrack, ...prev]);
        trackToAttach = aliasTrack;
      }

      const res = await fetch(`/api/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackIds: [trackToAttach.id] })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Failed to add track to playlist (${res.status})`);
      }

      setPlaylists(prev => prev.map(p => {
        if (p.id !== playlistId) return p;
        const newTracks = [...p.tracks, trackToAttach];
        return {
          ...p,
          tracks: newTracks,
          duration: newTracks.reduce((sum, t) => sum + t.duration, 0)
        };
      }));

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
        const aliasRes = await fetch('/api/tracks/alias', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseTrackId: track.id, aliasName: desiredName }),
        });

        if (!aliasRes.ok) {
          const data = await aliasRes.json().catch(() => null);
          throw new Error(
            data?.error ||
              data?.message ||
              `Failed to create alias for playlist duplicate (${aliasRes.status})`,
          );
        }

        const t = await aliasRes.json();
        const aliasTrack: Track = {
          id: t.id,
          name: t.name,
          artist: t.artist,
          duration: t.duration && t.duration > 0 ? t.duration : track.duration,
          size: t.size,
          filePath: t.file_path,
          hash: t.hash,
          dateAdded: t.date_added ? new Date(t.date_added) : new Date(),
        };

        setTracks((prev) => [aliasTrack, ...prev]);
        trackToAttach = aliasTrack;
      }

      const attachRes = await fetch(`/api/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackIds: [trackToAttach.id] }),
      });

      if (!attachRes.ok) {
        const data = await attachRes.json().catch(() => null);
        throw new Error(data?.error || `Failed to add track to playlist (${attachRes.status})`);
      }

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

      // Persist the new order so the DB matches the visual insertion position
      if (newTracks.length > 0) {
        const trackIds = newTracks.map((t) => t.id);
        const reorderRes = await fetch(`/api/playlists/${playlistId}/reorder`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackIds }),
        });

        if (!reorderRes.ok) {
          const data = await reorderRes.json().catch(() => null);
          console.error('Failed to persist playlist reorder', data);
          // Do not throw hard error here to avoid confusing the operator; UI already updated.
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
      const copyRes = await fetch('/api/tracks/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceTrackId: item.track.id }),
      });

      if (!copyRes.ok) {
        const data = await copyRes.json().catch(() => null);
        throw new Error(data?.error || `Failed to copy track (${copyRes.status})`);
      }

      const t = await copyRes.json();
      const newTrack: Track = {
        id: t.id,
        name: t.name,
        artist: t.artist,
        duration: t.duration,
        size: t.size,
        filePath: t.file_path,
        hash: t.hash,
        dateAdded: t.date_added ? new Date(t.date_added) : new Date(),
      };

      setTracks((prev) => [newTrack, ...prev]);

      const attachRes = await fetch(`/api/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackIds: [newTrack.id] }),
      });

      if (!attachRes.ok) {
        const data = await attachRes.json().catch(() => null);
        throw new Error(
          data?.error || `Failed to add copied track to playlist (${attachRes.status})`,
        );
      }

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
    const name = prompt('Enter playlist name:');
    if (!name) return;

    const exists = playlists.some(p => p.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      toast.error('Playlist name already exists');
      return;
    }

    // Persist playlist to backend
    fetch('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `Failed to create playlist (${res.status})`);
        }
        return res.json();
      })
      .then((serverPlaylist) => {
        const newPlaylist: Playlist = {
          id: serverPlaylist.id,
          name: serverPlaylist.name,
          tracks: [],
          locked: Boolean(serverPlaylist.locked),
          createdAt: serverPlaylist.created_at ? new Date(serverPlaylist.created_at) : new Date(),
          duration: serverPlaylist.duration ?? 0
        };
        setPlaylists([...playlists, newPlaylist]);
        toast.success(`Created playlist "${name}"`);
      })
      .catch((error: any) => {
        console.error('Failed to create playlist', error);
        toast.error(error.message || 'Failed to create playlist');
      });
  };

  const handleRenamePlaylist = async (playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist || playlist.locked) return;

    const newName = prompt('Enter new name:', playlist.name);
    if (!newName || newName === playlist.name) return;

    const exists = playlists.some(p => p.name.toLowerCase() === newName.toLowerCase() && p.id !== playlistId);
    if (exists) {
      toast.error('Playlist name already exists');
      return;
    }

    const previousPlaylists = playlists;

    // Optimistically update UI
    setPlaylists(prev => prev.map(p =>
      p.id === playlistId ? { ...p, name: newName } : p
    ));

    try {
      const res = await fetch(`/api/playlists/${playlistId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Failed to rename playlist (${res.status})`);
      }

      const updated = await res.json();

      // Ensure local state matches backend response
      setPlaylists(prev => prev.map(p =>
        p.id === playlistId ? {
          ...p,
          name: updated.name,
          locked: Boolean(updated.locked),
          duration: updated.duration ?? p.duration,
        } : p
      ));

      toast.success('Playlist renamed');
    } catch (error: any) {
      console.error('Failed to rename playlist', error);
      // Roll back optimistic change
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
      const res = await fetch(`/api/playlists/${playlistId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Failed to delete playlist (${res.status})`);
      }
      toast.success('Playlist deleted');
    } catch (error: any) {
      console.error('Failed to delete playlist', error);
      // Roll back optimistic removal
      setPlaylists(previousPlaylists);
      toast.error(error.message || 'Failed to delete playlist');
    }
  };

  const handleToggleLockPlaylist = async (playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;

    const newLocked = !playlist.locked;
    const previousPlaylists = playlists;

    // Optimistically update UI
    setPlaylists(prev => prev.map(p =>
      p.id === playlistId ? { ...p, locked: newLocked } : p
    ));

    try {
      const res = await fetch(`/api/playlists/${playlistId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locked: newLocked })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Failed to update lock state (${res.status})`);
      }

      const updated = await res.json();

      // Ensure local state matches backend response
      setPlaylists(prev => prev.map(p =>
        p.id === playlistId ? { ...p, locked: Boolean(updated.locked) } : p
      ));
    } catch (error: any) {
      console.error('Failed to toggle lock state', error);
      // Roll back optimistic change
      setPlaylists(previousPlaylists);
      toast.error(error.message || 'Failed to update playlist lock state');
    }
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
      const res = await fetch(`/api/playlists/${playlistId}/tracks/${trackId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Failed to remove track from playlist (${res.status})`);
      }
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
      const res = await fetch(`/api/playlists/${playlistId}/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackIds }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Failed to reorder playlist (${res.status})`);
      }
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
    if (currentTrackId) {
      const currentIndex = queue.findIndex(item => item.track.id === currentTrackId);
      if (currentIndex !== -1) {
        const before = queue.slice(0, currentIndex + 1);
        const after = queue.slice(currentIndex + 1);
        setQueue([...before, ...insertItems, ...after]);
        return;
      }
    }

    // Otherwise, insert playlist at the top and make its first track current.
    setQueue([...insertItems, ...queue]);
    setCurrentTrackId(playlist.tracks[0].id);
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
        const res = await fetch('/api/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackId: track.id, fromPlaylist: playlist.name }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `Failed to add playlist to queue (${res.status})`);
        }

        const item = await res.json();
        createdItems.push(item as QueueItem);
      }

      if (createdItems.length > 0) {
        // Avoid double-adding when WebSocket is live; rely on backend
        // queue-updated broadcast. Fall back to optimistic local update
        // only when WS is not connected.
        if (!hasLiveQueueRef.current) {
          setQueue(prev => [...prev, ...createdItems]);
          if (wasEmpty && !currentTrackId) {
            setCurrentTrackId(createdItems[0].track.id);
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
    suppressDuplicateDialog?: boolean,
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
        const res = await fetch('/api/tracks/upload', {
          method: 'POST',
          body: formData,
        });

        if (res.status === 409) {
          // Duplicate audio file. For OS drag-and-drop into playlists we
          // suppress the interactive dialog and always behave like "Add
          // Copy", so large drops remain smooth.
          const data = await res.json().catch(() => null);
          const existingTrack = data?.existingTrack;

          if (!existingTrack) {
            duplicates += 1;
            continue;
          }

          let decision: 'skip' | 'cancel' | 'add' | 'addAll';
          if (suppressDuplicateDialog) {
            decision = 'add';
          } else {
            decision = await askDuplicateDecision(existingTrack.name, file.name);
          }

          if (decision === 'skip') {
            duplicates += 1;
            continue;
          }

          // For duplicate-audio cases, create an alias that also respects the
          // playlist-level OS-style naming. Use desiredName so the alias name
          // in the library matches what we show inside this playlist.
          const aliasRes = await fetch('/api/tracks/alias', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseTrackId: existingTrack.id, aliasName: desiredName }),
          });

          if (!aliasRes.ok) {
            failed += 1;
            continue;
          }

          const t = await aliasRes.json();
          const mapped: Track = {
            id: t.id,
            name: t.name,
            artist: t.artist,
            duration: t.duration && t.duration > 0 ? t.duration : detectedDuration,
            size: t.size,
            filePath: t.file_path,
            hash: t.hash,
            dateAdded: t.date_added ? new Date(t.date_added) : new Date(),
          };
          importedTracks.push(mapped);
          existingNames.push(mapped.name);
          if ((!t.duration || t.duration === 0) && mapped.filePath) {
            hydrateTrackDurationInLibrary(mapped.id, mapped.filePath);
          }
          continue;
        }

        if (!res.ok) {
          failed += 1;
          continue;
        }

        const t = await res.json();
        const mapped: Track = {
          id: t.id,
          name: t.name,
          artist: t.artist,
          duration: t.duration && t.duration > 0 ? t.duration : detectedDuration,
          size: t.size,
          filePath: t.file_path,
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
      const res = await fetch(`/api/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackIds })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Failed to add tracks to playlist (${res.status})`);
      }

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
        const reorderRes = await fetch(`/api/playlists/${playlistId}/reorder`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackIds: trackIdsForReorder }),
        });

        if (!reorderRes.ok) {
          const data = await reorderRes.json().catch(() => null);
          console.error('Failed to persist playlist reorder after import', data);
        }
      }

      // Reflect the newly imported audio in the queue/playback bar: enqueue first imported track
      if (importedTracks.length > 0) {
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
    fetch('/api/schedules')
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `Failed to load schedules (${res.status})`);
        }
        return res.json();
      })
      .then((serverSchedules) => {
        const mapped: ScheduledPlaylist[] = serverSchedules.map((s: any) => ({
          id: s.id,
          playlistId: s.playlist_id,
          playlistName: s.playlist_name,
          type: s.type as ScheduledPlaylist['type'],
          dateTime: s.date_time ? new Date(s.date_time) : undefined,
          queueSongId: s.queue_song_id || undefined,
          triggerPosition: s.trigger_position || undefined,
          status: s.status as ScheduledPlaylist['status'],
        }));
        setScheduledPlaylists(mapped);
      })
      .catch((error: any) => {
        console.error('Failed to load schedules', error);
        toast.error(error.message || 'Failed to load schedules');
      });
  }, []);

  const handleScheduleConfirm = async (config: ScheduleConfig) => {
    if (!selectedPlaylistForSchedule) return;

    try {
      const payload = {
        playlistId: selectedPlaylistForSchedule.id,
        type: config.mode,
        dateTime: config.mode === 'datetime' && config.dateTime ? config.dateTime.toISOString() : undefined,
        queueSongId: config.queueSongId,
        triggerPosition: config.triggerPosition,
      };

      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Failed to create schedule (${res.status})`);
      }

      const created = await res.json();
      const mapped: ScheduledPlaylist = {
        id: created.id,
        playlistId: created.playlist_id,
        playlistName: created.playlist_name,
        type: created.type as ScheduledPlaylist['type'],
        dateTime: created.date_time ? new Date(created.date_time) : undefined,
        queueSongId: created.queue_song_id || undefined,
        triggerPosition: created.trigger_position || undefined,
        status: created.status as ScheduledPlaylist['status'],
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
      const res = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Failed to delete schedule (${res.status})`);
      }
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
  const logPlaybackHistory = (track: Track, options?: { completed?: boolean; source?: string }) => {
    const source = options?.source ?? 'queue';
    const completed = options?.completed ?? true;

    // Derive how long this track has actually been playing based on
    // nowPlayingStart and the current wall clock. Clamp to at least 1s so
    // very short or immediately-preempted plays (e.g. when a schedule fires
    // mid-track) are still logged.
    const now = new Date();
    const baseStart = nowPlayingStart ?? now;
    const elapsedMs = now.getTime() - baseStart.getTime();
    const elapsedSeconds = Math.max(1, Math.round(elapsedMs / 1000));

    const payload = {
      trackId: track.id,
      playedAt: baseStart.toISOString(),
      positionStart: 0,
      positionEnd: elapsedSeconds,
      completed,
      source,
      fileStatus: 'ok',
    };

    fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `Failed to create history entry (${res.status})`);
        }
        return res.json();
      })
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
      const res = await fetch(`/api/tracks/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error('Failed to remove track');
      }
      setTracks(prev => prev.filter(track => track.id !== id));
    } catch (error) {
      console.error(error);
      toast.error('Failed to remove track');
    }
  };

  const handlePlayPause = () => {
    if (!currentTrackId && queue.length > 0) {
      setCurrentTrackId(queue[0].track.id);
      setIsPlaying(true);
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  const handleNext = () => {
    if (queue.length === 0) return;

    const currentIndex = queue.findIndex(item => item.track.id === currentTrackId);

    // If nothing is currently playing, just start the first item without removing it yet
    if (currentIndex === -1) {
      setCurrentTrackId(queue[0].track.id);
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

        fetch(`/api/schedules/${schedule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' }),
        }).catch((error) => {
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
    fetch(`/api/queue/${finishedItem.id}`, {
      method: 'DELETE',
    }).then((res) => {
      if (!res.ok && res.status !== 404) {
        return res.json().catch(() => null).then((data) => {
          console.error('Failed to delete finished queue item on server', data);
        });
      }
      return undefined;
    }).catch((err) => {
      console.error('Error calling DELETE /api/queue for finished item', err);
    });

    if (baseQueue.length > 0) {
      setCurrentTrackId(baseQueue[0].track.id);
      setIsPlaying(true);
    } else {
      setCurrentTrackId(null);
      setIsPlaying(false);
    }
  };

  const handlePrevious = () => {
    if (queue.length > 0) {
      const currentIndex = queue.findIndex((item) => item.track.id === currentTrackId);
      if (currentIndex > 0) {
        setCurrentTrackId(queue[currentIndex - 1].track.id);
      }
    }
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Top bar */}
      <div className="flex items-center px-4 py-2 border-b border-border text-[11px] text-muted-foreground">
        <div className="flex-none font-medium text-foreground/80">
          {tracks.length} tracks · {playlists.length} playlists · {queue.length} in queue
        </div>
        <div className="flex-1 text-center font-mono text-[11px] tracking-wide text-foreground/80">
          {formatIstTime(nowIst)}
        </div>
        <div className="flex items-center gap-2 flex-none">
          {headerSupportsOutputSelection && (
            <div className="hidden sm:flex items-center gap-1 max-w-[9rem]">
              <span className="text-[11px] text-muted-foreground whitespace-nowrap">Output</span>
              <Select
                value={headerSelectedDeviceId}
                onValueChange={(value) => setHeaderSelectedDeviceId(value)}
              >
                <SelectTrigger
                  size="sm"
                  className="h-7 w-[6.5rem] text-[11px] truncate"
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
          )}
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setHistoryOpen(true)}
            title="History"
          >
            <Clock className="w-4 h-4" />
            <span>History</span>
          </Button>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </div>

      {/* Main three-panel layout: Library | Playlists | Queue */}
      <div className="flex flex-1 min-h-0">
        {/* Library (left) */}
        <div className="flex-shrink-0 h-full" style={{ width: leftPanel.width }}>
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
        </div>

        {/* Resize handle between Library and Playlists */}
        <ResizeHandle
          onMouseDown={leftPanel.handleMouseDown}
          isResizing={leftPanel.isResizing}
        />

        {/* Playlists (center) */}
        <div className="flex-1 min-w-0 h-full">
          <PlaylistManager
            playlists={playlists}
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
        </div>

        {/* Resize handle between Playlists and Queue */}
        <ResizeHandle
          onMouseDown={rightPanel.handleMouseDown}
          isResizing={rightPanel.isResizing}
        />

        {/* Queue (right) */}
        <div className="flex-shrink-0 h-full" style={{ width: rightPanel.width }}>
          <QueuePanel
            queue={queue}
            currentTrackId={currentTrackId}
            currentQueueItemId={currentQueueItemId}
            onRemoveFromQueue={handleRemoveFromQueue}
            onReorderQueue={handleReorderQueue}
            timing={timing}
            now={nowIst}
            playlists={playlists}
            onAddQueueItemToPlaylist={handleAddQueueItemToPlaylist}
          />
        </div>
      </div>

      {/* Bottom Playback Bar */}
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
      />

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

      {duplicatePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-md shadow-lg p-4 w-full max-w-sm">
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
          </div>
        </div>
      )}

      {folderDuplicatePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-md shadow-lg p-4 w-full max-w-sm">
            <div className="mb-3">
              <h2 className="text-sm font-semibold mb-1">File name already in folder</h2>
              <p className="text-xs text-muted-foreground">
                "{folderDuplicatePrompt.baseName}" already exists in this folder.
              </p>
              <p className="text-[11px] text-muted-foreground mt-1 break-all">
                Importing file: <span className="font-mono">{folderDuplicatePrompt.fileName}</span>
              </p>
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleFolderDuplicateDecision('skip')}
              >
                Skip
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleFolderDuplicateDecision('cancel')}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleFolderDuplicateDecision('add')}
              >
                Add
              </Button>
              <Button size="sm" onClick={() => handleFolderDuplicateDecision('addAll')}>
                Add All Copy
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}