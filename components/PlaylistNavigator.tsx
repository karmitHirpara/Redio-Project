import { useState, useMemo } from 'react';
import { Search, Plus, Clock, Music } from 'lucide-react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Playlist, ScheduledPlaylist } from '../types';
import { PlaylistFolder } from './PlaylistFolder';
import { formatDuration } from '../lib/utils';
import { cn } from '../lib/utils';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

interface PlaylistNavigatorProps {
  playlists: Playlist[];
  selectedPlaylist: Playlist | null;
  onSelectPlaylist: (playlist: Playlist) => void;
  onCreatePlaylist: () => void;
  onRenamePlaylist: (playlistId: string) => void;
  onDeletePlaylist: (playlistId: string) => void;
  onToggleLockPlaylist: (playlistId: string) => void;
  onDuplicatePlaylist: (playlistId: string) => void;
  onSchedulePlaylist: (playlistId: string) => void;
  scheduledPlaylists: ScheduledPlaylist[];
  onDeleteSchedule: (scheduleId: string) => void | Promise<void>;
  onDropTrackOnPlaylistHeader?: (playlistId: string, trackIds: string[]) => void;
  onDropFolderOnPlaylistHeader?: (playlistId: string, folderIds: string[]) => void;
  onDropFilesOnPlaylistHeader?: (playlistId: string, files: File[]) => void;
}

export function PlaylistNavigator({
  playlists,
  selectedPlaylist,
  onSelectPlaylist,
  onCreatePlaylist,
  onRenamePlaylist,
  onDeletePlaylist,
  onToggleLockPlaylist,
  onDuplicatePlaylist,
  onSchedulePlaylist,
  scheduledPlaylists,
  onDeleteSchedule,
  onDropTrackOnPlaylistHeader,
  onDropFolderOnPlaylistHeader,
  onDropFilesOnPlaylistHeader,
}: PlaylistNavigatorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showScheduledOnly, setShowScheduledOnly] = useState(false);
  const reduceMotion = useReducedMotion() ?? false;
  const [dragOverPlaylistId, setDragOverPlaylistId] = useState<string | null>(null);

  const nextScheduleByPlaylist = useMemo(() => {
    const map: Record<string, ScheduledPlaylist | undefined> = {};
    scheduledPlaylists
      .filter(s => s.status === 'pending')
      .forEach(s => {
        const existing = map[s.playlistId];
        if (!existing) {
          map[s.playlistId] = s;
          return;
        }
        const a = s.dateTime?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const b = existing.dateTime?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (a < b) {
          map[s.playlistId] = s;
        }
      });
    return map;
  }, [scheduledPlaylists]);

  const filteredPlaylists = useMemo(() => {
    const base = playlists.filter((playlist) => {
      const matchesSearch = playlist.name.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;
      if (!showScheduledOnly) return true;
      // In Scheduled view, only include playlists that have a pending next schedule
      return Boolean(nextScheduleByPlaylist[playlist.id]);
    });

    if (!showScheduledOnly) {
      // Keep original ordering when not in Scheduled mode
      return base;
    }

    // In Scheduled view, sort by upcoming schedule time (earliest first)
    return [...base].sort((a, b) => {
      const sa = nextScheduleByPlaylist[a.id];
      const sb = nextScheduleByPlaylist[b.id];

      const ta = sa?.dateTime?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const tb = sb?.dateTime?.getTime() ?? Number.MAX_SAFE_INTEGER;

      if (ta !== tb) return ta - tb;
      // Stable fallback by name for equal times
      return a.name.localeCompare(b.name);
    });
  }, [playlists, searchQuery, showScheduledOnly, nextScheduleByPlaylist]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-semibold tracking-tight text-foreground min-w-0 truncate">Playlists</h2>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button
              size="sm"
              variant={showScheduledOnly ? 'default' : 'outline'}
              className="h-8 px-2.5 text-[11px]"
              onClick={() => setShowScheduledOnly((v) => !v)}
              title="Show only playlists with pending schedules"
            >
              <span className="mr-1 text-xs">●</span>
              Scheduled
            </Button>
            <Button size="sm" className="h-8" onClick={onCreatePlaylist}>
              <Plus className="w-4 h-4 mr-2" />
              New
            </Button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-muted-foreground" />
          <Input
            placeholder="Search playlists..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 text-slate-900 dark:text-foreground placeholder:text-slate-500 dark:placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Playlists List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <AnimatePresence mode="popLayout">
          {filteredPlaylists.map((playlist) => {
            const nextSchedule = nextScheduleByPlaylist[playlist.id];
            const scheduleLabel = nextSchedule?.dateTime
              ? nextSchedule.dateTime.toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
              })
              : undefined;

            return (
              <motion.div
                key={playlist.id}
                layout
                initial={reduceMotion ? false : { opacity: 0, y: -6 }}
                animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: 6 }}
                transition={
                  reduceMotion
                    ? undefined
                    : {
                      duration: 0.16,
                      ease: 'easeOut',
                    }
                }
                className={cn(
                  'relative rounded-md',
                  dragOverPlaylistId === playlist.id && 'ring-2 ring-primary/60 bg-primary/10'
                )}
                onDragOver={(e) => {
                  const types = Array.from(e.dataTransfer.types);
                  const hasTrackId = types.includes('application/x-track-id');
                  const hasTracks = types.includes('application/x-redio-tracks');
                  const hasFolder = types.includes('application/x-redio-folder');
                  const hasFiles = types.includes('Files');
                  if ((hasTrackId && onDropTrackOnPlaylistHeader) || (hasTracks && onDropTrackOnPlaylistHeader) || (hasFolder && onDropFolderOnPlaylistHeader) || (hasFiles && onDropFilesOnPlaylistHeader)) {
                    e.preventDefault();
                    if (dragOverPlaylistId !== playlist.id) {
                      setDragOverPlaylistId(playlist.id);
                    }
                  }
                }}
                onDragLeave={() => {
                  if (dragOverPlaylistId === playlist.id) {
                    setDragOverPlaylistId(null);
                  }
                }}
                onDrop={(e) => {
                  const types = Array.from(e.dataTransfer.types);
                  const hasTrackId = types.includes('application/x-track-id');
                  const hasTracks = types.includes('application/x-redio-tracks');
                  const hasFolder = types.includes('application/x-redio-folder');
                  const hasFiles = types.includes('Files');

                  if (hasFolder && onDropFolderOnPlaylistHeader) {
                    try {
                      const payload = JSON.parse(e.dataTransfer.getData('application/x-redio-folder') || '{}');
                      const folderIds = payload.folderIds || (payload.folderId ? [payload.folderId] : []);
                      if (folderIds.length === 0) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverPlaylistId(null);
                      onDropFolderOnPlaylistHeader(playlist.id, folderIds);
                      return;
                    } catch {
                      // ignore
                    }
                  }

                  if (hasTracks && onDropTrackOnPlaylistHeader) {
                    try {
                      const payload = JSON.parse(e.dataTransfer.getData('application/x-redio-tracks') || '{}');
                      const trackIds = payload.trackIds || [];
                      if (trackIds.length === 0) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverPlaylistId(null);
                      onDropTrackOnPlaylistHeader(playlist.id, trackIds);
                      return;
                    } catch {
                      // Fall through to single-track handling
                    }
                  }

                  if (hasTrackId && onDropTrackOnPlaylistHeader) {
                    const trackId = e.dataTransfer.getData('application/x-track-id');
                    if (!trackId) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverPlaylistId(null);
                    onDropTrackOnPlaylistHeader(playlist.id, [trackId]);
                    return;
                  }

                  if (hasFiles && onDropFilesOnPlaylistHeader) {
                    e.preventDefault();
                    e.stopPropagation();
                    const items = Array.from(e.dataTransfer.items || []);
                    const hasDirectoryEntry = items.some((it) => {
                      try {
                        const entry = (it as any).webkitGetAsEntry?.();
                        return Boolean(entry && entry.isDirectory);
                      } catch {
                        return false;
                      }
                    });

                    const makeFileWithRelativePath = (file: File, rel: string): File => {
                      const f = new File([file], file.name, {
                        type: file.type,
                        lastModified: file.lastModified,
                      });
                      try {
                        Object.defineProperty(f, 'webkitRelativePath', {
                          value: rel,
                          configurable: true,
                        });
                      } catch {
                        // ignore
                      }
                      return f;
                    };

                    const readEntry = async (entry: any, prefix: string, includeSelfName: boolean): Promise<File[]> => {
                      const out: File[] = [];
                      if (!entry) return out;

                      if (entry.isFile) {
                        await new Promise<void>((resolve) => {
                          entry.file(
                            (file: File) => {
                              out.push(makeFileWithRelativePath(file, `${prefix}${file.name}`));
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

                    const finish = async () => {
                      let files: File[] = [];
                      if (hasDirectoryEntry) {
                        for (const it of items) {
                          const entry = (it as any).webkitGetAsEntry?.();
                          if (!entry) continue;
                          const collected = await readEntry(entry, '', true);
                          files.push(...collected);
                        }
                      } else {
                        files = Array.from(e.dataTransfer.files || []);
                      }

                      if (files.length === 0) return;
                      setDragOverPlaylistId(null);
                      onDropFilesOnPlaylistHeader(playlist.id, files);
                    };

                    void finish();
                  }
                }}
              >
                <AnimatePresence>
                  {dragOverPlaylistId === playlist.id && !reduceMotion && (
                    <motion.div
                      className="pointer-events-none absolute inset-0 rounded-md"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.12, ease: 'easeOut' }}
                    />
                  )}
                </AnimatePresence>
                <PlaylistFolder
                  playlist={playlist}
                  onClick={() => onSelectPlaylist(playlist)}
                  onRename={() => onRenamePlaylist(playlist.id)}
                  onDelete={() => onDeletePlaylist(playlist.id)}
                  onToggleLock={() => onToggleLockPlaylist(playlist.id)}
                  onDuplicate={() => onDuplicatePlaylist(playlist.id)}
                  onSchedule={() => onSchedulePlaylist(playlist.id)}
                  scheduleLabel={scheduleLabel}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Metadata Summary */}
      {selectedPlaylist && (
        <div className="border-t border-border p-4 space-y-2 bg-accent/20">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm text-foreground">{selectedPlaylist.name}</h3>
            {(() => {
              const next = nextScheduleByPlaylist[selectedPlaylist.id];
              if (!next || next.status !== 'pending') return null;
              const disabled = selectedPlaylist.locked;
              return (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => onDeleteSchedule(next.id)}
                  disabled={disabled}
                >
                  Cancel
                </Button>
              );
            })()}
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Music className="w-3 h-3" />
              <span>{selectedPlaylist.tracks.length} tracks</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>{formatDuration(selectedPlaylist.duration)}</span>
            </div>
          </div>
          {(() => {
            const next = nextScheduleByPlaylist[selectedPlaylist.id];
            if (!next || !next.dateTime) return null;
            return (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span>Next schedule:</span>
                <span>{next.dateTime.toLocaleString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                  month: 'short',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: true,
                })}</span>
              </div>
            );
          })()}
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => onSchedulePlaylist(selectedPlaylist.id)}
          >
            Schedule Playlist
          </Button>
        </div>
      )}
    </div>
  );
}