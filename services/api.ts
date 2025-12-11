import { Track, Playlist, QueueItem, ScheduledPlaylist } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

// Generic fetch wrapper
async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'API request failed');
  }

  return response.json();
}

// Tracks API
export const tracksAPI = {
  getAll: () => fetchAPI<Track[]>('/tracks'),
  
  getById: (id: string) => fetchAPI<Track>(`/tracks/${id}`),
  
  upload: async (file: File, metadata: { name?: string; artist?: string; duration?: number }) => {
    const formData = new FormData();
    formData.append('file', file);
    if (metadata.name) formData.append('name', metadata.name);
    if (metadata.artist) formData.append('artist', metadata.artist);
    if (metadata.duration) formData.append('duration', metadata.duration.toString());

    const response = await fetch(`${API_BASE_URL}/tracks/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Upload failed');
    }

    return response.json();
  },
  
  copy: (sourceTrackId: string) =>
    fetchAPI<Track>('/tracks/copy', {
      method: 'POST',
      body: JSON.stringify({ sourceTrackId }),
    }),
  
  delete: (id: string) => fetchAPI<{ message: string }>(`/tracks/${id}`, {
    method: 'DELETE',
  }),
};

// Playlists API
export const playlistsAPI = {
  getAll: () => fetchAPI<Playlist[]>('/playlists'),
  
  getById: (id: string) => fetchAPI<Playlist>(`/playlists/${id}`),
  
  create: (name: string) => fetchAPI<Playlist>('/playlists', {
    method: 'POST',
    body: JSON.stringify({ name }),
  }),
  
  update: (id: string, data: { name?: string; locked?: boolean }) => 
    fetchAPI<Playlist>(`/playlists/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  
  delete: (id: string) => fetchAPI<{ message: string }>(`/playlists/${id}`, {
    method: 'DELETE',
  }),
  
  addTracks: (id: string, trackIds: string[]) => 
    fetchAPI<{ tracks: Track[] }>(`/playlists/${id}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ trackIds }),
    }),
  
  removeTrack: (id: string, trackId: string) => 
    fetchAPI<{ message: string }>(`/playlists/${id}/tracks/${trackId}`, {
      method: 'DELETE',
    }),
  
  reorder: (id: string, trackIds: string[]) => 
    fetchAPI<{ message: string }>(`/playlists/${id}/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ trackIds }),
    }),
};

// Queue API
export const queueAPI = {
  get: () => fetchAPI<QueueItem[]>('/queue'),
  
  add: (trackId: string, fromPlaylist?: string) => 
    fetchAPI<QueueItem>('/queue', {
      method: 'POST',
      body: JSON.stringify({ trackId, fromPlaylist }),
    }),
  
  reorder: (queueIds: string[]) => 
    fetchAPI<{ message: string }>('/queue/reorder', {
      method: 'PUT',
      body: JSON.stringify({ queueIds }),
    }),
  
  remove: (id: string) => fetchAPI<{ message: string }>(`/queue/${id}`, {
    method: 'DELETE',
  }),
  
  clear: () => fetchAPI<{ message: string }>('/queue', {
    method: 'DELETE',
  }),
};

// Schedules API
export const schedulesAPI = {
  getAll: () => fetchAPI<ScheduledPlaylist[]>('/schedules'),
  
  create: (schedule: {
    playlistId: string;
    type: 'datetime' | 'song-trigger';
    dateTime?: string;
    queueSongId?: string;
    triggerPosition?: 'before' | 'after';
  }) => fetchAPI<ScheduledPlaylist>('/schedules', {
    method: 'POST',
    body: JSON.stringify(schedule),
  }),
  
  updateStatus: (id: string, status: string) => 
    fetchAPI<ScheduledPlaylist>(`/schedules/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),
  
  delete: (id: string) => fetchAPI<{ message: string }>(`/schedules/${id}`, {
    method: 'DELETE',
  }),
};
