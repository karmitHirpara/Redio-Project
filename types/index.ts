export interface Track {
  id: string;
  name: string;
  artist: string;
  duration: number; // in seconds
  size: number; // in bytes
  dateAdded: Date;
  filePath: string;
  hash: string;
}

export interface Playlist {
  id: string;
  name: string;
  tracks: Track[];
  locked: boolean;
  createdAt: Date;
  duration: number; // calculated total duration
}

export interface QueueItem {
  id: string;
  track: Track;
  fromPlaylist?: string; // playlist name if triggered by schedule
  order: number;
}

export interface ScheduledPlaylist {
  id: string;
  playlistId: string;
  playlistName: string;
  type: 'datetime' | 'song-trigger';
  dateTime?: Date;
  queueSongId?: string;
  triggerPosition?: 'before' | 'after';
  lockPlaylist?: boolean;
  status: 'pending' | 'active' | 'completed';
}

// Flat library folder (no nesting)
export interface LibraryFolder {
  id: string;
  name: string;
  parent_id?: string;
}

export type SortOption = 'name' | 'size' | 'dateAdded';
export type Theme = 'default' | 'light';