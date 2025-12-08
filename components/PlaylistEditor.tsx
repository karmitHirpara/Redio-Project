import { useState, useRef } from 'react';
import { X, Search, Plus, GripVertical } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Playlist, Track } from '../types';
import { TrackRow } from './TrackRow';
import { formatDuration } from '../lib/utils';

interface PlaylistEditorProps {
  playlist: Playlist;
  onClose: () => void;
  onPlayPlaylistNow: () => void;
  onQueuePlaylist: () => void;
  onAddSongs: (tracks: Track[]) => void;
  onRemoveTrack: (trackId: string) => void;
  onReorderTracks: (tracks: Track[]) => void;
  onImportFiles: (files: File[]) => void;
  onQueueTrack: (track: Track) => void;
  scheduledStartTime?: Date | null;
}

export function PlaylistEditor({
  playlist,
  onClose,
  onPlayPlaylistNow,
  onQueuePlaylist,
  onAddSongs,
  onRemoveTrack,
  onReorderTracks,
  onImportFiles,
  onQueueTrack,
  scheduledStartTime,
}: PlaylistEditorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const filteredTracks = playlist.tracks.filter(track =>
    track.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    track.artist.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const canReorder = !playlist.locked && !searchQuery;

  const handleDragStart = (index: number) => {
    if (!canReorder) return;
    setDragIndex(index);
  };

  const handleDragEnter = (index: number) => {
    if (!canReorder) return;
    if (dragIndex === null || dragIndex === index) return;

    const visible = [...filteredTracks];
    const [moved] = visible.splice(dragIndex, 1);
    visible.splice(index, 0, moved);

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

    setDragIndex(index);
    onReorderTracks(newTracks);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
  };

  // Precompute per-track start time labels when a scheduled start time is available
  const startTimeByTrackId: Record<string, string> = {};
  if (scheduledStartTime instanceof Date && !isNaN(scheduledStartTime.getTime())) {
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
      {/* Header */}
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-foreground font-semibold">{playlist.name}</h2>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{playlist.tracks.length} tracks</span>
              <span>{formatDuration(playlist.duration)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={playlist.tracks.length === 0}
              onClick={onQueuePlaylist}
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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search in playlist..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
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
                onImportFiles(files);
              }
              e.target.value = '';
            }}
          />
        </div>

        <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
          <span>{playlist.tracks.length} tracks</span>
          <span>{formatDuration(playlist.duration)}</span>
        </div>
      </div>

      {/* Tracks List */}
      <div className="flex-1 overflow-y-auto p-2">
        {filteredTracks.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            {searchQuery ? 'No tracks found' : 'No tracks in playlist'}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredTracks.map((track, index) => (
              <div
                key={track.id}
                className="flex items-center gap-2"
                draggable={canReorder}
                onDragStart={() => handleDragStart(index)}
                onDragEnter={() => handleDragEnter(index)}
                onDragEnd={handleDragEnd}
              >
                <span className="w-6 text-[11px] text-muted-foreground text-right">
                  {index + 1}
                </span>
                <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
                <div className="flex-1">
                  <TrackRow
                    track={track}
                    onAddToQueue={onQueueTrack}
                    onAddToPlaylist={() => {}}
                    playlists={[]}
                    onRemove={() => onRemoveTrack(track.id)}
                    showRemove={!playlist.locked}
                    startTimeLabel={startTimeByTrackId[track.id]}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
