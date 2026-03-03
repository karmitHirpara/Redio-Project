import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, Plus, GripVertical, Clock } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Playlist, Track } from '../types';
import { TrackRow } from './TrackRow';
import { formatDuration, formatFileSize } from '../lib/utils';
import { ConfirmDialog } from './ConfirmDialog';
import { Progress } from './ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Label } from './ui/label';

interface PlaylistEditorProps {
  playlist: Playlist;
  highlightTrackId?: string | null;
  importProgress?: { percent: number; label: string } | null;
  onClose: () => void;
  onPlayPlaylistNow: () => void;
  onQueuePlaylist: () => void;
  onAddSongs: (tracks: Track[]) => void;
  onRemoveTrack: (trackId: string) => void;
  onReorderTracks: (tracks: Track[]) => void;
  onImportFiles: (files: File[], insertIndex?: number, suppressDuplicateDialog?: boolean) => void;
  onQueueTrack: (track: Track) => void;
  onTrackUpdated?: (track: Track) => void;
  scheduledStartTime?: Date | null;
  onDropTrackOnPlaylistPanel?: (trackIds: string[], insertIndex: number) => void;
  onDropFolderOnPlaylistPanel?: (folderIds: string[], insertIndex: number) => void;
}

export function PlaylistEditor({
  playlist,
  highlightTrackId,
  importProgress,
  onClose,
  onPlayPlaylistNow,
  onQueuePlaylist,
  onAddSongs,
  onRemoveTrack,
  onReorderTracks,
  onImportFiles,
  onQueueTrack,
  onTrackUpdated,
  scheduledStartTime,
  onDropTrackOnPlaylistPanel,
  onDropFolderOnPlaylistPanel,
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

  const [previewBaseDateTime, setPreviewBaseDateTime] = useState<Date | null>(null);
  const [previewTimeByTrackId, setPreviewTimeByTrackId] = useState<Record<string, { start: Date; end: Date }>>({});
  const [previewHourKeyByTrackId, setPreviewHourKeyByTrackId] = useState<Record<string, string>>({});
  const previewComputeRunRef = useRef(0);

  const hasScheduledBase =
    scheduledStartTime instanceof Date && !Number.isNaN(scheduledStartTime.getTime());

  const effectiveBaseDateTime =
    hasScheduledBase
      ? scheduledStartTime
      : previewBaseDateTime;

  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewDialogDate, setPreviewDialogDate] = useState('');
  const [previewDialogTime, setPreviewDialogTime] = useState('');

  const getIstParts = (dt: Date) => {
    const parts = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(dt);

    const lookup: Record<string, string> = {};
    parts.forEach((p) => {
      if (p.type !== 'literal') lookup[p.type] = p.value;
    });

    return {
      yyyy: lookup.year,
      mm: lookup.month,
      dd: lookup.day,
      hh: lookup.hour,
      mi: lookup.minute,
      ss: lookup.second,
    };
  };

  const istDateFromInputs = (dateStr: string, timeStr: string) => {
    const d = String(dateStr || '').split('-');
    const t = String(timeStr || '').split(':');
    if (d.length !== 3 || t.length < 2) return null;

    const year = Number(d[0]);
    const month = Number(d[1]);
    const day = Number(d[2]);
    const hour = Number(t[0]);
    const minute = Number(t[1]);
    const second = t.length >= 3 ? Number(t[2]) : 0;

    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      !Number.isFinite(day) ||
      !Number.isFinite(hour) ||
      !Number.isFinite(minute) ||
      !Number.isFinite(second)
    ) {
      return null;
    }

    const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - 330 * 60 * 1000;
    const dt = new Date(utcMs);
    return Number.isNaN(dt.getTime()) ? null : dt;
  };

  const persistPreviewBase = (dt: Date | null) => {
    try {
      if (!dt) {
        window.localStorage.removeItem('redio.playlists.preview_base_datetime');
      } else {
        window.localStorage.setItem('redio.playlists.preview_base_datetime', dt.toISOString());
      }
    } catch {
      // ignore
    }
    try {
      window.dispatchEvent(new Event('redio:playlist-preview-base-changed'));
    } catch {
      // ignore
    }
  };

  const computedPreviewDialogDateTime = useMemo(() => {
    if (!previewDialogDate || !previewDialogTime) return null;
    const normalizedTime = previewDialogTime.length === 5 ? `${previewDialogTime}:00` : previewDialogTime;
    return istDateFromInputs(previewDialogDate, normalizedTime);
  }, [previewDialogDate, previewDialogTime]);

  useEffect(() => {
    if (!previewDialogOpen) return;
    if (hasScheduledBase) return;

    try {
      const raw = window.localStorage.getItem('redio.playlists.preview_base_datetime');
      const dt = raw ? new Date(raw) : null;
      const base = dt && !Number.isNaN(dt.getTime()) ? dt : new Date(Date.now() + 5 * 60 * 1000);
      const { yyyy, mm, dd, hh, mi, ss } = getIstParts(base);
      if (yyyy && mm && dd) setPreviewDialogDate(`${yyyy}-${mm}-${dd}`);
      if (hh && mi && ss) setPreviewDialogTime(`${hh}:${mi}:${ss}`);
    } catch {
      const base = new Date(Date.now() + 5 * 60 * 1000);
      const { yyyy, mm, dd, hh, mi, ss } = getIstParts(base);
      if (yyyy && mm && dd) setPreviewDialogDate(`${yyyy}-${mm}-${dd}`);
      if (hh && mi && ss) setPreviewDialogTime(`${hh}:${mi}:${ss}`);
    }
  }, [hasScheduledBase, previewDialogOpen]);

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

  useEffect(() => {
    const readBase = () => {
      try {
        const raw = window.localStorage.getItem('redio.playlists.preview_base_datetime');
        if (!raw) {
          setPreviewBaseDateTime(null);
          return;
        }
        const dt = new Date(raw);
        if (Number.isNaN(dt.getTime())) {
          setPreviewBaseDateTime(null);
          return;
        }
        setPreviewBaseDateTime(dt);
      } catch {
        setPreviewBaseDateTime(null);
      }
    };

    readBase();

    const onChanged = () => readBase();
    window.addEventListener('redio:playlist-preview-base-changed', onChanged as any);
    window.addEventListener('storage', onChanged);
    return () => {
      window.removeEventListener('redio:playlist-preview-base-changed', onChanged as any);
      window.removeEventListener('storage', onChanged);
    };
  }, []);

  useEffect(() => {
    const base = effectiveBaseDateTime;
    const runId = ++previewComputeRunRef.current;

    if (!base || !(base instanceof Date) || Number.isNaN(base.getTime())) {
      setPreviewTimeByTrackId({});
      setPreviewHourKeyByTrackId({});
      return;
    }

    const tracks = playlist.tracks;
    const total = tracks.length;

    const nextTimes: Record<string, { start: Date; end: Date }> = {};
    const nextHourKey: Record<string, string> = {};
    let cursorMs = base.getTime();

    const formatHourKey = (dt: Date) => {
      // Hour bucket in IST
      const parts = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
      }).formatToParts(dt);
      const lookup: Record<string, string> = {};
      for (const p of parts) {
        if (p.type !== 'literal') lookup[p.type] = p.value;
      }
      return `${lookup.year}-${lookup.month}-${lookup.day} ${lookup.hour}`;
    };

    let i = 0;
    const step = () => {
      if (previewComputeRunRef.current !== runId) return;

      const chunkEnd = Math.min(total, i + 250);
      for (; i < chunkEnd; i += 1) {
        const t = tracks[i];
        const start = new Date(cursorMs);
        const durSec = Number(t.duration || 0);
        const end = new Date(cursorMs + Math.max(0, durSec) * 1000);
        nextTimes[t.id] = { start, end };
        nextHourKey[t.id] = formatHourKey(start);
        cursorMs = end.getTime();
      }

      // publish progressively (non-blocking for huge playlists)
      setPreviewTimeByTrackId((prev) => (previewComputeRunRef.current === runId ? { ...prev, ...nextTimes } : prev));
      setPreviewHourKeyByTrackId((prev) => (previewComputeRunRef.current === runId ? { ...prev, ...nextHourKey } : prev));

      if (i < total) {
        window.setTimeout(step, 0);
      }
    };

    // reset maps for fresh run
    setPreviewTimeByTrackId({});
    setPreviewHourKeyByTrackId({});
    window.setTimeout(step, 0);
  }, [effectiveBaseDateTime, playlist.tracks]);

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

  const previewLabelByTrackId: Record<string, string> = {};
  const previewTooltipByTrackId: Record<string, string> = {};
  const hourHeaderByKey: Record<string, string> = {};

  if (effectiveBaseDateTime) {
    for (const t of playlist.tracks) {
      const span = previewTimeByTrackId[t.id];
      if (!span) continue;
      const startLabel = span.start
        .toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
        .toUpperCase();
      const endLabel = span.end
        .toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
        .toUpperCase();

      previewLabelByTrackId[t.id] = startLabel;
      previewTooltipByTrackId[t.id] = `${startLabel} → ${endLabel} • ${formatFileSize(t.size)}`;

      const hourKey = previewHourKeyByTrackId[t.id];
      if (hourKey && !hourHeaderByKey[hourKey]) {
        hourHeaderByKey[hourKey] = span.start.toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        });
      }
    }
  }

  // Fallback: keep existing scheduledStartTime display when no preview base is set
  const startTimeByTrackId: Record<string, string> = {};
  if (!effectiveBaseDateTime && scheduledStartTime instanceof Date && !isNaN(scheduledStartTime.getTime())) {
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
      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Preview Timing</DialogTitle>
            <DialogDescription>
              Temporary timing preview for playlist ordering only. Does not schedule automation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Base date (IST)</Label>
                <Input
                  type="date"
                  value={previewDialogDate}
                  onChange={(e) => setPreviewDialogDate(e.target.value)}
                  disabled={hasScheduledBase}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Base time (IST)</Label>
                <Input
                  type="time"
                  step={1}
                  value={previewDialogTime}
                  onChange={(e) => setPreviewDialogTime(e.target.value)}
                  disabled={hasScheduledBase}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                persistPreviewBase(null);
                setPreviewDialogOpen(false);
              }}
              disabled={hasScheduledBase}
            >
              Clear
            </Button>
            <Button
              type="button"
              onClick={() => {
                persistPreviewBase(computedPreviewDialogDateTime);
                setPreviewDialogOpen(false);
              }}
              disabled={hasScheduledBase || !computedPreviewDialogDateTime}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            {!hasScheduledBase && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPreviewDialogOpen(true)}
                title="Preview timing (temporary)"
              >
                <Clock className="w-4 h-4 mr-2" />
                Preview
              </Button>
            )}
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

        {importProgress && (
          <div className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
            <div className="flex items-center justify-between text-[10px] leading-4 text-muted-foreground">
              <span className="truncate pr-3">{importProgress.label}</span>
              <span className="tabular-nums">{Math.round(importProgress.percent)}%</span>
            </div>
            <Progress value={importProgress.percent} className="h-1.5 mt-1" />
          </div>
        )}

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
          const hasTracks = types.includes('application/x-redio-tracks');
          const hasFolder = types.includes('application/x-redio-folder');
          const hasFiles = types.includes('Files');
          if ((hasTrackId && onDropTrackOnPlaylistPanel) || (hasTracks && onDropTrackOnPlaylistPanel) || (hasFolder && onDropFolderOnPlaylistPanel) || hasFiles) {
            e.preventDefault();
          }
        }}
        onDrop={(e) => {
          const types = Array.from(e.dataTransfer.types);
          const hasTrackId = types.includes('application/x-track-id');
          const hasTracks = types.includes('application/x-redio-tracks');
          const hasFolder = types.includes('application/x-redio-folder');
          const hasFiles = types.includes('Files');
          e.preventDefault();
          e.stopPropagation();

          if (hasFolder && onDropFolderOnPlaylistPanel) {
            try {
              const payload = JSON.parse(e.dataTransfer.getData('application/x-redio-folder') || '{}');
              const folderIds = payload.folderIds || (payload.folderId ? [payload.folderId] : []);
              if (folderIds.length === 0) return;
              const insertAt = dropIndex !== null ? dropIndex : filteredTracks.length;
              onDropFolderOnPlaylistPanel(folderIds, insertAt);
              setDropIndex(null);
              return;
            } catch {
              // ignore
            }
          }

          if (hasTracks && onDropTrackOnPlaylistPanel) {
            try {
              const payload = JSON.parse(e.dataTransfer.getData('application/x-redio-tracks') || '{}');
              const trackIds = payload.trackIds || [];
              if (trackIds.length === 0) return;
              const insertAt = dropIndex !== null ? dropIndex : filteredTracks.length;
              onDropTrackOnPlaylistPanel(trackIds, insertAt);
              setDropIndex(null);
              return;
            } catch {
              // Fall through to single-track handling
            }
          }

          if (hasTrackId && onDropTrackOnPlaylistPanel) {
            const trackId = e.dataTransfer.getData('application/x-track-id');
            if (!trackId) return;
            const insertAt = dropIndex !== null ? dropIndex : filteredTracks.length;
            onDropTrackOnPlaylistPanel([trackId], insertAt);
            setDropIndex(null);
            return;
          }

          if (hasFiles && onImportFiles) {
            const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
            if (files.length === 0) return;
            const insertAt = dropIndex !== null ? dropIndex : filteredTracks.length;
            // OS drag-and-drop into playlist: suppress duplicate dialog for a
            // smoother flow, always treating duplicates as "Add Copy".
            void onImportFiles(files, insertAt, true);
            setDropIndex(null);
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
                <div key={`${track.id}-hourwrap`} className="space-y-1">
                  {effectiveBaseDateTime && index === 0 ? (
                    <div className="px-2 pt-1">
                      <div className="inline-flex items-center rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-[10px] text-muted-foreground">
                        {hasScheduledBase ? 'Scheduled start (IST): ' : 'Preview base (IST): '}
                        {effectiveBaseDateTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                      </div>
                    </div>
                  ) : null}

                  {effectiveBaseDateTime ? (() => {
                    const hourKey = previewHourKeyByTrackId[track.id];
                    const prevId = filteredTracks[index - 1]?.id;
                    const prevKey = prevId ? previewHourKeyByTrackId[prevId] : null;
                    if (!hourKey) return null;
                    if (hourKey === prevKey) return null;
                    return (
                      <div className="px-2 pt-2">
                        <div className="text-[11px] font-medium text-muted-foreground">{hourHeaderByKey[hourKey] || ''}</div>
                        <div className="h-px bg-border/70 mt-1" />
                      </div>
                    );
                  })() : null}

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
                  className={`flex items-center gap-2 cursor-default select-none relative hover:bg-accent/10 ${dropIndex === index || dropIndex === index + 1
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
                    <div title={effectiveBaseDateTime ? (previewTooltipByTrackId[track.id] || '') : ''}>
                      <TrackRow
                        track={track}
                        onAddToQueue={onQueueTrack}
                        onAddToPlaylist={() => { }}
                        playlists={[]}
                        onRemove={onRemoveTrack}
                        showRemove={!playlist.locked}
                        startTimeLabel={effectiveBaseDateTime ? previewLabelByTrackId[track.id] : startTimeByTrackId[track.id]}
                        onTrackUpdated={onTrackUpdated}
                      />
                    </div>
                  </div>
                </motion.div>
                </div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
