import { Track, Playlist, QueueItem, ScheduledPlaylist } from '../types';

// Determine the correct API base URL depending on environment.
// - In the browser / dev server: use VITE_API_URL or "/api" (proxied by Vite).
// - In the Electron desktop app: talk directly to the embedded backend on
//   http://localhost:3001.
//
// The most reliable check for packaged Electron is that the UI is loaded from
// file:// (app.asar/dist/index.html). When running in a normal browser/dev
// server, this will not be file://.
const isFileProtocol =
  typeof window !== 'undefined' && window.location?.protocol === 'file:';

const API_BASE_URL = isFileProtocol
  ? 'http://localhost:3001/api'
  : import.meta.env.VITE_API_URL || '/api';

export class ApiError extends Error {
  status: number | null;
  url: string;
  method: string;
  details: any;

  constructor(message: string, init: { status: number | null; url: string; method: string; details?: any }) {
    super(message);
    this.name = 'ApiError';
    this.status = init.status;
    this.url = init.url;
    this.method = init.method;
    this.details = init.details;
  }
}

export const getBackendOrigin = (): string => {
  if (isFileProtocol) return 'http://localhost:3001';
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost:3001';
};

export const resolveUploadsUrl = (maybePath: string): string => {
  if (!maybePath || typeof maybePath !== 'string') return maybePath as any;
  if (/^(https?:|blob:|data:)/i.test(maybePath)) return maybePath;
  if (maybePath.startsWith('/uploads/')) {
    return `${getBackendOrigin()}${maybePath}`;
  }
  return maybePath;
};

type ApiResponseType = 'json' | 'text' | 'none';

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: BodyInit | null;
  json?: any;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  responseType?: ApiResponseType;
  allowedStatuses?: number[];
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 350;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isIdempotentMethod = (method: string) => {
  const m = method.toUpperCase();
  return m === 'GET' || m === 'HEAD';
};

const shouldRetryResponse = (res: Response) => {
  if (res.status === 408 || res.status === 429) return true;
  if (res.status >= 500 && res.status <= 599) return true;
  return false;
};

const readErrorPayload = async (res: Response) => {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json().catch(() => null);
  }
  return res.text().catch(() => null);
};

const normalizeErrorMessage = (payload: any, fallback: string) => {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload;
  if (typeof payload?.error === 'string') return payload.error;
  if (typeof payload?.message === 'string') return payload.message;
  return fallback;
};

const buildUrl = (endpoint: string) => {
  if (/^https?:/i.test(endpoint)) return endpoint;
  return `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
};

async function request<T>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
  const url = buildUrl(endpoint);
  const method = (options.method || 'GET').toUpperCase();
  const responseType: ApiResponseType = options.responseType || 'json';
  const allowedStatuses = options.allowedStatuses || [];

  const headers = new Headers(options.headers);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  // Desktop security: the embedded local server requires a custom header for
  // non-idempotent requests to mitigate CSRF-style attacks from other origins.
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    if (!headers.has('X-Redio-Client')) {
      headers.set('X-Redio-Client', 'redio-desktop');
    }
  }

  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const timeoutMs =
    options.timeoutMs ?? (isFormData ? 0 : DEFAULT_TIMEOUT_MS);
  const hasJson = Object.prototype.hasOwnProperty.call(options, 'json');
  const body: BodyInit | null | undefined = hasJson ? JSON.stringify(options.json) : options.body;

  if (hasJson && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!hasJson && !isFormData && body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const doAttempt = async (): Promise<Response> => {
    const controller = new AbortController();
    const id = timeoutMs > 0 ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      return await fetch(url, {
        ...options,
        method,
        headers,
        body: body as any,
        credentials: 'include',
        signal: controller.signal,
      });
    } finally {
      if (id != null) window.clearTimeout(id);
    }
  };

  const retries = isIdempotentMethod(method) ? options.retries ?? DEFAULT_RETRIES : 0;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  let attempt = 0;
  while (true) {
    try {
      const res = await doAttempt();
      if (!res.ok && !allowedStatuses.includes(res.status)) {
        const payload = await readErrorPayload(res);
        const message = normalizeErrorMessage(payload, res.statusText || 'API request failed');
        throw new ApiError(message, { status: res.status, url, method, details: payload });
      }

      if (responseType === 'none') {
        return undefined as any;
      }

      const contentLength = res.headers.get('content-length');
      if (res.status === 204 || contentLength === '0') {
        return undefined as any;
      }

      if (responseType === 'text') {
        return (await res.text()) as any;
      }

      return (await res.json()) as T;
    } catch (err: any) {
      const shouldRetry =
        attempt < retries &&
        (err?.name === 'AbortError' || err instanceof TypeError || err instanceof ApiError);

      if (!shouldRetry) {
        if (err?.name === 'AbortError') {
          throw new ApiError('Request timed out', { status: null, url, method });
        }
        if (err instanceof ApiError) throw err;
        throw new ApiError(err?.message || 'Network request failed', { status: null, url, method, details: err });
      }

      // Only retry on network/timeout errors, or retryable HTTP statuses.
      if (err instanceof ApiError && err.status != null) {
        // If this is a structured HTTP error, only retry on 408/429/5xx.
        if (!(err.status === 408 || err.status === 429 || (err.status >= 500 && err.status <= 599))) {
          throw err;
        }
      }

      attempt += 1;
      await sleep(retryDelayMs * attempt);
    }
  }
}

export const apiClient = {
  request,
  get: <T>(endpoint: string, options?: Omit<ApiRequestOptions, 'method'>) =>
    request<T>(endpoint, { ...options, method: 'GET' }),
  head: (endpoint: string, options?: Omit<ApiRequestOptions, 'method' | 'responseType'>) =>
    request<void>(endpoint, { ...options, method: 'HEAD', responseType: 'none' }),
  json: <T>(endpoint: string, options: Omit<ApiRequestOptions, 'body'> & { json: any }) =>
    request<T>(endpoint, options),
};

// Tracks API
export const tracksAPI = {
  getAll: () => apiClient.get<Track[]>('/tracks'),
  
  getById: (id: string) => apiClient.get<Track>(`/tracks/${id}`),
  
  upload: async (file: File, metadata: { name?: string; artist?: string; duration?: number }) => {
    const formData = new FormData();
    formData.append('file', file);
    if (metadata.name) formData.append('name', metadata.name);
    if (metadata.artist) formData.append('artist', metadata.artist);
    if (metadata.duration) formData.append('duration', metadata.duration.toString());

    return apiClient.request<any>('/tracks/upload', {
      method: 'POST',
      body: formData,
    });
  },

  uploadFormData: (formData: FormData) =>
    apiClient.request<any>('/tracks/upload', {
      method: 'POST',
      body: formData,
    }),
  
  copy: (sourceTrackId: string) =>
    apiClient.json<Track>('/tracks/copy', { method: 'POST', json: { sourceTrackId } }),

  alias: (baseTrackId: string, aliasName: string) =>
    apiClient.json<Track>('/tracks/alias', { method: 'POST', json: { baseTrackId, aliasName } }),
  
  delete: (id: string) => apiClient.request<{ message: string }>(`/tracks/${id}`, { method: 'DELETE' }),
};

// Playlists API
export const playlistsAPI = {
  getAll: () => apiClient.get<Playlist[]>('/playlists'),
  
  getById: (id: string) => apiClient.get<Playlist>(`/playlists/${id}`),
  
  create: (name: string) => apiClient.json<Playlist>('/playlists', { method: 'POST', json: { name } }),
  
  update: (id: string, data: { name?: string; locked?: boolean }) => 
    apiClient.json<Playlist>(`/playlists/${id}`, { method: 'PUT', json: data }),
  
  delete: (id: string) => apiClient.request<{ message: string }>(`/playlists/${id}`, { method: 'DELETE' }),
  
  addTracks: (id: string, trackIds: string[]) => 
    apiClient.json<{ tracks: Track[] }>(`/playlists/${id}/tracks`, { method: 'POST', json: { trackIds } }),
  
  removeTrack: (id: string, trackId: string) => 
    apiClient.request<{ message: string }>(`/playlists/${id}/tracks/${trackId}`, { method: 'DELETE' }),
  
  reorder: (id: string, trackIds: string[]) => 
    apiClient.json<{ message: string }>(`/playlists/${id}/reorder`, { method: 'PUT', json: { trackIds } }),
};

// Queue API
export const queueAPI = {
  get: () => apiClient.get<QueueItem[]>('/queue'),
  
  add: (trackId: string, fromPlaylist?: string) => 
    apiClient.json<QueueItem>('/queue', { method: 'POST', json: { trackId, fromPlaylist } }),
  
  reorder: (queueIds: string[]) => 
    apiClient.json<{ message: string }>('/queue/reorder', { method: 'PUT', json: { queueIds } }),
  
  remove: (id: string) => apiClient.request<{ message: string }>(`/queue/${id}`, { method: 'DELETE' }),
  
  clear: () => apiClient.request<{ message: string }>('/queue', { method: 'DELETE' }),
};

// Schedules API
export const schedulesAPI = {
  getAll: () => apiClient.get<ScheduledPlaylist[]>('/schedules'),
  
  create: (schedule: {
    playlistId: string;
    type: 'datetime' | 'song-trigger';
    dateTime?: string;
    queueSongId?: string;
    triggerPosition?: 'before' | 'after';
    lockPlaylist?: boolean;
  }) => apiClient.json<ScheduledPlaylist>('/schedules', { method: 'POST', json: schedule }),
  
  updateStatus: (id: string, status: string) => 
    apiClient.json<ScheduledPlaylist>(`/schedules/${id}`, { method: 'PUT', json: { status } }),
  
  delete: (id: string) => apiClient.request<{ message: string }>(`/schedules/${id}`, { method: 'DELETE' }),
};

export const foldersAPI = {
  getAll: () => apiClient.get<any[]>('/folders'),
  create: (name: string, parentId?: string) =>
    apiClient.json<any>('/folders', { method: 'POST', json: { name, parentId } }),
  rename: (id: string, name: string) => apiClient.json<any>(`/folders/${id}`, { method: 'PUT', json: { name } }),
  delete: (id: string) => apiClient.request<{ message: string }>(`/folders/${id}`, { method: 'DELETE' }),
  getTracks: (folderId: string) => apiClient.get<any[]>(`/folders/${folderId}/tracks`),
  attachTracks: (folderId: string, trackIds: string[]) =>
    apiClient.json<{ message: string }>(`/folders/${folderId}/tracks`, { method: 'POST', json: { trackIds } }),
  moveTracks: (payload: { sourceFolderId: string; targetFolderId: string; trackIds: string[] }) =>
    apiClient.json<{ message: string }>(`/folders/move-tracks`, { method: 'POST', json: payload }),
  setParent: (folderId: string, parentId: string) =>
    apiClient.json<any>(`/folders/${folderId}/parent`, { method: 'PUT', json: { parentId } }),
};

export const historyAPI = {
  get: (limit = 100) => apiClient.get<any[]>(`/history?limit=${encodeURIComponent(String(limit))}`),
  create: (payload: {
    trackId: string;
    playedAt: string;
    positionStart: number;
    positionEnd: number;
    completed: boolean;
    source: string;
    fileStatus: string;
    sessionId?: string;
  }) => apiClient.json<any>('/history', { method: 'POST', json: payload }),
  update: (
    id: string,
    payload: {
      positionStart?: number;
      positionEnd?: number;
      completed?: boolean;
    },
  ) => apiClient.json<any>(`/history/${id}`, { method: 'PUT', json: payload }),
  delete: (id: string) => apiClient.request<{ message: string }>(`/history/${id}`, { method: 'DELETE' }),
  clearAll: () => apiClient.request<{ message: string }>('/history', { method: 'DELETE' }),
  action: (id: string, action: 'addToQueue' | 'putBackToLibrary') =>
    apiClient.json<any>(`/history/${id}/actions`, { method: 'POST', json: { action } }),
};

// Enhanced backup types for professional features
export type BackupType = 'full' | 'incremental' | 'selective';
export type DataCategory = 'library' | 'playlists' | 'queue' | 'scheduler' | 'history' | 'configs';
export type StorageType = 'local' | 'external' | 'network';
export type ConflictResolution = 'overwrite' | 'merge' | 'skip';

export type StorageLocation = {
  name: string;
  type: StorageType;
  path?: string;
  networkPath?: string;
  credentials?: {
    username?: string;
    password?: string;
  };
};

export type BackupMetadata = {
  id: string;
  type: BackupType;
  categories: DataCategory[];
  size: number;
  checksum: string;
  createdAt: string;
  version: string;
  appVersion: string;
  location: string;
  compressed: boolean;
  includesAudio: boolean;
  description?: string;
  uploadedAt?: string;
  originalFilename?: string;
  forceFullBackup?: boolean;
};

export type BackupFile = {
  filename: string;
  bytes: number;
  modifiedAt: string;
  location: string;
  metadata?: BackupMetadata;
  isValid: boolean;
};

export type BackupJob = {
  id: string;
  type: BackupType;
  categories: DataCategory[];
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  progress: number;
  currentStep: string;
  error?: string;
};

export type BackupStatus = {
  status: 'idle' | 'running';
  currentJob: BackupJob | null;
};

export type BackupPreview = {
  tracks?: number;
  playlists?: number;
  queueItems?: number;
  schedules?: number;
};

export type BackupConfig = {
  storageLocations: StorageLocation[];
  retentionPolicy: {
    keepDaily: number;
    keepWeekly: number;
    keepMonthly: number;
  };
  compressionEnabled: boolean;
  includeAudioFiles: boolean;
  defaultBackupType: BackupType;
};

export type CreateBackupOptions = {
  type?: BackupType;
  categories?: DataCategory[];
  location?: string;
  description?: string;
};

export type RestoreOptions = {
  location?: string;
  validateOnly?: boolean;
  conflictResolution?: ConflictResolution;
  createRestorePoint?: boolean;
  selectiveRestore?: {
    categories: DataCategory[];
    mode: 'include' | 'exclude';
  };
};

export type UploadResult = {
  ok: true;
  filename: string;
  originalName: string;
  size: number;
  checksum: string;
  metadata: BackupMetadata;
};

export type RestoreResult = {
  ok: boolean;
  restartRequired: boolean;
  metadata: BackupMetadata;
  selectiveRestore?: boolean;
  restoredCategories?: DataCategory[];
  fullRestore?: boolean;
};

export const backupAPI = {
  // Basic operations
  list: (location?: string) => apiClient.get<{ backups: BackupFile[] }>(location ? `/backups?location=${location}` : '/backups'),
  create: (options?: CreateBackupOptions) => 
    apiClient.request<{ ok: true; backup: { filename: string; path: string; bytes: number; checksum: string } }>('/backup', { 
      method: 'POST',
      json: options || {} 
    }),
  
  // Status and job management
  getStatus: (jobId?: string) => apiClient.get<BackupStatus>(jobId ? `/backup/status?jobId=${jobId}` : '/backup/status'),
  cancelJob: (jobId: string) => apiClient.request<{ ok: true; message: string }>(`/backup/${jobId}`, { method: 'DELETE' }),
  
  // Validation and preview
  preview: (filename: string, location?: string) =>
    apiClient.json<{ ok: true; metadata: BackupMetadata; preview: BackupPreview }>('/backup/preview', {
      method: 'POST',
      json: { filename, location }
    }),
  
  // Validate database structure
  validate: (filename: string) =>
    apiClient.json<{ isValid: boolean; errors?: string[]; filename: string }>('/backup/validate', {
      method: 'POST',
      json: { filename }
    }),
  
  // Restore with options
  restore: (filename: string, options?: RestoreOptions) =>
    apiClient.json<RestoreResult>('/backup/restore', { 
      method: 'POST', 
      json: { filename, ...options } 
    }),
  
  // Configuration
  getConfig: () => apiClient.get<{ config: BackupConfig }>('/backup/config'),
  updateConfig: (config: Partial<BackupConfig>) =>
    apiClient.json<{ ok: true; config: BackupConfig }>('/backup/config', {
      method: 'PUT',
      json: config
    }),
  
  // Storage location testing
  testLocation: (type: StorageType, path: string) =>
    apiClient.json<{ ok: boolean; error?: string }>('/backup/location/test', {
      method: 'POST',
      json: { type, path }
    }),
  
  // Cleanup and management
  delete: (filename: string, location?: string) =>
    apiClient.request<{ ok: true }>(`/backups/${filename}${location ? `?location=${location}` : ''}`, { method: 'DELETE' }),
  cleanup: (policy?: BackupConfig['retentionPolicy']) =>
    apiClient.json<{ ok: true; deleted: number; remaining: number }>('/backups/cleanup', {
      method: 'POST',
      json: { policy }
    }),
  
  // Upload and download
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('backupFile', file);
    
    return apiClient.request<UploadResult>('/backup/upload', {
      method: 'POST',
      body: formData,
    });
  },
  
  download: (filename: string, location?: string) => {
    const url = location ? `/api/backup/download/${filename}?location=${location}` : `/api/backup/download/${filename}`;
    
    // Create download link
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    return Promise.resolve();
  },
  getSchedule: () => apiClient.get<{ enabled: boolean; intervalMinutes: number }>('/backup/schedule'),
  setSchedule: (enabled: boolean, intervalMinutes: number) =>
    apiClient.json<{ ok: boolean; enabled: boolean; intervalMinutes: number }>('/backup/schedule', {
      method: 'POST',
      json: { enabled, intervalMinutes },
    }),
};
