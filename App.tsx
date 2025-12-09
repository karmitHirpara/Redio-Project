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
  const [crossfadeSeconds, setCrossfadeSeconds] = useState(3);
  const [nowPlayingStart, setNowPlayingStart] = useState<Date | null>(null);
  const pauseStartedAtRef = useRef<Date | null>(null);
  const datetimeWarnedRef = useRef<Set<string>>(new Set());
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedPlaylistForSchedule, setSelectedPlaylistForSchedule] = useState<Playlist | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [trackToRemove, setTrackToRemove] = useState<string | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    existingName: string;
    fileName: string;
  } | null>(null);
  const duplicateDecisionResolver = useRef<((choice: 'skip' | 'add') => void) | null>(null);
  const [dismissedScheduleIds, setDismissedScheduleIds] = useState<string[]>([]);
  const [historySessions, setHistorySessions] = useState<Record<string, { id: string; seconds: number }>>({});
  const [nowIst, setNowIst] = useState<Date | null>(null);

  const prevQueueLengthRef = useRef(0);

  const leftPanel = useResizable({ initialWidth: 320, minWidth: 250, maxWidth: 500 });
  const rightPanel = useResizable({ initialWidth: 320, minWidth: 250, maxWidth: 500 });

  const currentQueueItem = currentTrackId
    ? queue.find((item) => item.track.id === currentTrackId) || null
    : null;
  const currentTrack = currentQueueItem?.track || null;
  const currentQueueItemId = currentQueueItem?.id || null;

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

  // Keep a lightweight IST clock for display in the top bar
  useEffect(() => {
    const update = () => {
      const istString = new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
      });
      setNowIst(new Date(istString));
    };
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, []);

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


  // WebSocket connection for real-time events (disabled unless VITE_WS_URL is set)
  useEffect(() => {
    const wsUrl = import.meta.env.VITE_WS_URL as string | undefined;
    if (!wsUrl) return;

    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('WebSocket connected:', wsUrl);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'queue-updated') {
          console.log('Received queue-updated event', data.queue);
          // In the future we can reconcile this with local queue state for multi-client setups
        }
      } catch (err) {
        console.error('Error parsing WebSocket message', err);
      }
    };

    socket.onclose = () => {
      console.log('WebSocket disconnected');
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

  const askDuplicateDecision = (existingName: string, fileName: string): Promise<'skip' | 'add'> => {
    return new Promise((resolve) => {
      duplicateDecisionResolver.current = resolve;
      setDuplicatePrompt({ existingName, fileName });
    });
  };

  const handleDuplicateDecision = (choice: 'skip' | 'add') => {
    if (duplicateDecisionResolver.current) {
      duplicateDecisionResolver.current(choice);
      duplicateDecisionResolver.current = null;
    }
    setDuplicatePrompt(null);
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
    // Prevent duplicate tracks in queue
    const alreadyInQueue = queue.some(item => item.track.id === track.id);
    if (alreadyInQueue) {
      toast.error('Track already in queue');
      return;
    }

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

      setQueue(prev => [...prev, newItem]);

      // If this is the first item in the queue, reflect it immediately in the playback bar
      if (wasEmpty && !currentTrackId) {
        setCurrentTrackId(track.id);
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

  // Track when the current track actually starts (wall-clock)
  useEffect(() => {
    if (currentTrackId && isPlaying) {
      setNowPlayingStart(new Date());
    }
  }, [currentTrackId, isPlaying]);

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
    const importedIds: string[] = [];

    for (const file of files) {
      const detectedDuration = await getAudioDuration(file);
      const formData = new FormData();
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

          // If we are importing into a specific folder, treat this as
          // "use existing track in this folder" with no duplicate warning.
          // Just remember its id so the folder association below links it.
          if (folderId) {
            importedIds.push(existingTrack.id);
            imported += 1;
            continue;
          }

          // Otherwise (no folder), ask the user whether to skip or add a copy.
          const decision = await askDuplicateDecision(existingTrack.name, file.name);

          if (decision === 'skip') {
            duplicates += 1;
            continue;
          }

          // Create an alias track that reuses the same file but with auto-renamed title
          const aliasRes = await fetch('/api/tracks/alias', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseTrackId: existingTrack.id }),
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

    const trackExists = playlist.tracks.some(t => t.id === track.id);
    if (trackExists) {
      toast.error('Track already in playlist');
      return;
    }

    try {
      const res = await fetch(`/api/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackIds: [track.id] })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Failed to add track to playlist (${res.status})`);
      }

      setPlaylists(prev => prev.map(p => {
        if (p.id !== playlistId) return p;
        const newTracks = [...p.tracks, track];
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
    let duplicates = 0;

    try {
      // Only queue tracks that are not already in the queue
      for (const track of playlist.tracks) {
        const inQueue = queue.some(item => item.track.id === track.id) ||
          createdItems.some(item => item.track.id === track.id);
        if (inQueue) {
          duplicates += 1;
          continue;
        }

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
        setQueue(prev => [...prev, ...createdItems]);
        if (wasEmpty && !currentTrackId) {
          setCurrentTrackId(createdItems[0].track.id);
        }
        const desc = duplicates > 0
          ? `${createdItems.length} added, ${duplicates} already in queue`
          : undefined;
        toast.success(`Queued playlist "${playlist.name}"`, {
          description: desc,
        });
      } else if (duplicates > 0) {
        toast.error('All tracks from this playlist are already in queue');
      }
    } catch (error: any) {
      console.error('Failed to queue playlist', error);
      toast.error(error.message || 'Failed to queue playlist');
    }
  };

  const handleImportFilesToPlaylist = async (playlistId: string, files: File[]) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;
    if (playlist.locked) {
      toast.error('Playlist is locked');
      return;
    }

    let importedTracks: Track[] = [];
    let duplicates = 0;
    let failed = 0;

    for (const file of files) {
      const detectedDuration = await getAudioDuration(file);
      const formData = new FormData();
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
          // Duplicate audio file; ask user whether to add a copy into library/playlist via in-app dialog
          const data = await res.json().catch(() => null);
          const existingTrack = data?.existingTrack;

          if (!existingTrack) {
            duplicates += 1;
            continue;
          }

          const decision = await askDuplicateDecision(existingTrack.name, file.name);

          if (decision === 'skip') {
            duplicates += 1;
            continue;
          }

          const aliasRes = await fetch('/api/tracks/alias', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseTrackId: existingTrack.id }),
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

      // Update playlists state: merge importedTracks into the selected playlist's tracks
      setPlaylists(prev => prev.map(p => {
        if (p.id !== playlistId) return p;
        const combined = [...p.tracks, ...importedTracks];
        return {
          ...p,
          tracks: combined,
          duration: combined.reduce((sum, t) => sum + t.duration, 0),
        };
      }));

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
        });
      } else {
        const queueItem = queue.find(q => q.id === config.queueSongId);
        const position = config.triggerPosition === 'after' ? 'after' : 'before';
        toast.success(`Playlist "${selectedPlaylistForSchedule.name}" scheduled`, {
          description: `Will start ${position} "${queueItem?.track.name}"`,
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

  useEffect(() => {
    const interval = setInterval(() => {
      // Use IST as the reference clock for datetime schedules
      const nowIst = new Date(
        new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      );

      setScheduledPlaylists(prev => {
        // 1-minute warning for upcoming datetime schedules
        prev.forEach((schedule) => {
          if (
            schedule.type === 'datetime' &&
            schedule.status === 'pending' &&
            schedule.dateTime
          ) {
            const msUntil = schedule.dateTime.getTime() - nowIst.getTime();
            if (msUntil <= 60_000 && msUntil > 0 && !datetimeWarnedRef.current.has(schedule.id)) {
              datetimeWarnedRef.current.add(schedule.id);
              toast.info('Scheduled playlist starting soon', {
                description: `"${schedule.playlistName}" will start in about 1 minute`,
              });
            }
          }
        });

        const due = prev.filter((schedule) =>
          schedule.type === 'datetime' &&
          schedule.status === 'pending' &&
          schedule.dateTime &&
          schedule.dateTime <= nowIst
        );

        if (due.length === 0) {
          return prev;
        }

        // Sort due schedules for deterministic handling
        const sortedDue = [...due].sort((a, b) => {
          const aTime = a.dateTime?.getTime() ?? 0;
          const bTime = b.dateTime?.getTime() ?? 0;
          if (aTime !== bTime) return aTime - bTime;
          return a.playlistName.localeCompare(b.playlistName);
        });

        // Enqueue playlists for all due schedules in one queue update
        setQueue((prevQueue) => {
          let queueAcc = [...prevQueue];

          sortedDue.forEach((schedule) => {
            const playlist = playlists.find((p) => p.id === schedule.playlistId);
            if (!playlist || playlist.tracks.length === 0) {
              return;
            }

            const startOrder = queueAcc.length;
            const newItems: QueueItem[] = playlist.tracks.map((track, index) => ({
              id: generateId(),
              track,
              fromPlaylist: playlist.name,
              order: startOrder + index,
            }));
            queueAcc = [...queueAcc, ...newItems];
          });

          return queueAcc;
        });

        // Mark each due schedule as completed in backend (fire-and-forget)
        sortedDue.forEach((schedule) => {
          fetch(`/api/schedules/${schedule.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'completed' }),
          }).catch((error) => {
            console.error('Failed to update schedule status', error);
          });
        });

        // Update local status once
        return prev.map((schedule) =>
          due.some((d) => d.id === schedule.id)
            ? { ...schedule, status: 'completed' as ScheduledPlaylist['status'] }
            : schedule
        );
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [playlists]);

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

  // Playback Controls
  // Record real listening time for tracks by accumulating wall-clock seconds
  // in a single history row per track (for this app session).
  const logPlaybackHistory = (track: Track, options?: { completed?: boolean; source?: string }) => {
    const source = options?.source ?? 'queue';
    const completed = options?.completed ?? true;

    // Derive how long this track has actually been playing based on nowPlayingStart
    const now = new Date();
    const baseStart = nowPlayingStart ?? now;
    const elapsedSeconds = Math.max(0, Math.round((now.getTime() - baseStart.getTime()) / 1000));
    if (elapsedSeconds <= 0) {
      return;
    }

    const existingSession = historySessions[track.id];
    const newTotalSeconds = (existingSession?.seconds ?? 0) + elapsedSeconds;

    if (existingSession) {
      // Update existing history row with new cumulative listening time
      fetch(`/api/history/${existingSession.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positionStart: 0,
          positionEnd: newTotalSeconds,
          completed,
        }),
      })
        .then(() => {
          setHistorySessions((prev) => ({
            ...prev,
            [track.id]: { id: existingSession.id, seconds: newTotalSeconds },
          }));
        })
        .catch((error) => {
          console.error('Failed to update playback history', error);
        });
    } else {
      const payload = {
        trackId: track.id,
        playedAt: baseStart.toISOString(),
        positionStart: 0,
        positionEnd: newTotalSeconds,
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
        .then((entry) => {
          if (!entry || !entry.id) return;
          setHistorySessions((prev) => ({
            ...prev,
            [track.id]: { id: String(entry.id), seconds: newTotalSeconds },
          }));
        })
        .catch((error) => {
          console.error('Failed to write playback history', error);
        });
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
      const currentIndex = queue.findIndex(item => item.track.id === currentTrackId);
      if (currentIndex > 0) {
        setCurrentTrackId(queue[currentIndex - 1].track.id);
      }
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground transition-colors duration-200">
      {/* Top Bar */}
      <div className="h-12 bg-background border-b border-border flex items-center px-4">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h1 className="text-foreground whitespace-nowrap">Radio Automation</h1>
        </div>

        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground tabular-nums">
          {nowIst && (() => {
            const raw = nowIst.toLocaleTimeString('en-IN', {
              timeZone: 'Asia/Kolkata',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: true,
            });
            // Force AM/PM to uppercase for a cleaner look
            const parts = raw.split(' ');
            if (parts.length > 1) {
              const suffix = parts.pop()!;
              const time = parts.join(' ');
              return (
                <span>
                  {time} {suffix.toUpperCase()}
                </span>
              );
            }
            return <span>{raw}</span>;
          })()}
        </div>

        <div className="flex items-center gap-2 flex-1 justify-end">
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

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Library */}
        <div style={{ width: leftPanel.width }} className="flex-shrink-0">
          <LibraryPanel
            tracks={tracks}
            playlists={playlists}
            onAddToQueue={handleAddToQueue}
            onAddToPlaylist={handleAddToPlaylist}
            onSelectPlaylist={(playlist) => toast.info(`Selected "${playlist.name}"`)}
            onCreatePlaylist={handleCreatePlaylist}
            onRenamePlaylist={handleRenamePlaylist}
            onDeletePlaylist={handleDeletePlaylist}
            onToggleLockPlaylist={handleToggleLockPlaylist}
            onRemoveTrack={handleRemoveTrack}
            onImportTracks={handleImportTracks}
          />
        </div>
        <ResizeHandle onMouseDown={leftPanel.handleMouseDown} isResizing={leftPanel.isResizing} />

        {/* Center Panel - Playlist Manager */}
        <div className="flex-1 min-w-0">
          <PlaylistManager
            playlists={playlists}
            scheduledPlaylists={scheduledPlaylists}
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
            onDeleteSchedule={handleDeleteSchedule}
          />
        </div>

        <ResizeHandle onMouseDown={rightPanel.handleMouseDown} isResizing={rightPanel.isResizing} />

        {/* Right Panel - Queue + Schedules */}
        <div style={{ width: rightPanel.width }} className="flex-shrink-0 flex flex-col border-l border-border">
          <QueuePanel
            queue={queue}
            currentTrackId={currentTrackId}
            currentQueueItemId={currentQueueItemId}
            onRemoveFromQueue={handleRemoveFromQueue}
            onReorderQueue={handleReorderQueue}
            timing={timing}
          />
          {scheduledPlaylists.length > 0 && (
            <div className="border-t border-border p-2 text-xs space-y-1 bg-muted/40">
              <div className="flex items-center justify-between">
                <div className="text-foreground text-xs font-medium">Scheduled</div>
                <span className="text-[10px] text-muted-foreground">
                  {scheduledPlaylists.filter(s => s.status === 'pending').length} pending
                </span>
              </div>
              <div className="max-h-40 overflow-auto space-y-1">
                {scheduledPlaylists
                  .filter((s) => !dismissedScheduleIds.includes(s.id))
                  .map((s) => {
                  const isPending = s.status === 'pending';
                  const isDatetime = s.type === 'datetime';
                  const playlistForSchedule = playlists.find(p => p.id === s.playlistId);
                  const isLocked = playlistForSchedule?.locked;
                  const playlistDurationSeconds = playlistForSchedule?.duration ?? (playlistForSchedule?.tracks.reduce((sum, t) => sum + (t.duration || 0), 0) || 0);
                  const label = isDatetime && s.dateTime
                    ? s.dateTime.toLocaleString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: true,
                      })
                    : s.queueSongId
                      ? `${s.triggerPosition === 'after' ? 'after' : 'before'} song`
                      : 'song-trigger';

                  const handleDismiss = () => {
                    setDismissedScheduleIds((prev) =>
                      prev.includes(s.id) ? prev : [...prev, s.id]
                    );
                  };

                  return (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-2 rounded px-1 py-0.5"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="truncate max-w-[120px] text-foreground">{s.playlistName}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <span>{label}</span>
                          {playlistDurationSeconds > 0 && (
                            <>
                              <span>•</span>
                              <span>{formatDuration(playlistDurationSeconds)}</span>
                            </>
                          )}
                          <span>•</span>
                          <span>{s.status}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleDismiss}
                        className="text-[10px] px-1 py-0.5 rounded border border-border hover:bg-accent hover:text-foreground"
                        title="Dismiss from list (schedule will still run)"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
                variant="outline"
                size="sm"
                onClick={() => handleDuplicateDecision('skip')}
              >
                Skip
              </Button>
              <Button
                size="sm"
                onClick={() => handleDuplicateDecision('add')}
              >
                Add copy
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}