import {
  startTransition,
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  type MouseEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Folder, Plus, ChevronRight, ChevronDown } from 'lucide-react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Track, Playlist, LibraryFolder } from '../types';
import { TrackRow } from './TrackRow';
import { toast } from 'sonner';
import { foldersAPI, resolveUploadsUrl } from '../services/api';
import { PlaylistFolder } from './PlaylistFolder';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from './ui/context-menu';

function VirtualizedFolderTrackList({
  tracks,
  folderId,
  selectedTrackIds,
  recentlyMovedTrackIds,
  onSelect,
  getDragPayload,
  onAddToQueue,
  onAddToPlaylist,
  playlists,
  onRemove,
}: {
  tracks: Track[];
  folderId?: string;
  selectedTrackIds: Set<string>;
  recentlyMovedTrackIds?: Set<string>;
  onSelect: (trackId: string, e: MouseEvent) => void;
  getDragPayload: (trackId: string, folderId?: string) => { trackIds: string[]; sourceFolderId?: string };
  onAddToQueue: (track: Track) => void;
  onAddToPlaylist: (track: Track, playlistId: string) => void;
  playlists: Playlist[];
  onRemove: (trackId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const rowHeight = 28;
  const overscan = 10;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      setViewportHeight(el.clientHeight);
    };

    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totalHeight = tracks.length * rowHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    tracks.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
  );

  const items = tracks.slice(startIndex, endIndex);

  return (
    <div
      ref={containerRef}
      className="max-h-72 overflow-y-auto pr-1"
      onScroll={(e) => {
        const target = e.currentTarget;
        setScrollTop(target.scrollTop);
      }}
    >
      <div className="relative" style={{ height: totalHeight }}>
        <div className="absolute left-0 right-0" style={{ transform: `translateY(${startIndex * rowHeight}px)` }}>
          <div className="space-y-0.5">
            {items.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                isLibrary
                isSelected={selectedTrackIds.has(track.id)}
                isRecentlyMoved={Boolean(folderId && recentlyMovedTrackIds?.has(track.id))}
                onSelect={onSelect}
                getDragPayload={() => getDragPayload(track.id, folderId)}
                onAddToQueue={onAddToQueue}
                onAddToPlaylist={onAddToPlaylist}
                playlists={playlists}
                onRemove={onRemove}
                showRemove
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface LibraryPanelProps {
  tracks: Track[];
  playlists: Playlist[];
  onAddToQueue: (track: Track) => void;
  onAddToPlaylist: (track: Track, playlistId: string) => void;
  onSelectPlaylist: (playlist: Playlist) => void;
  onCreatePlaylist: () => void;
  onRenamePlaylist: (playlistId: string) => void;
  onDeletePlaylist: (playlistId: string) => void;
  onToggleLockPlaylist: (playlistId: string) => void;
  onRemoveTrack: (trackId: string) => void;
  onImportTracks: (files: File[], folderId?: string) => Promise<void> | void;
}

export function LibraryPanel({
  tracks,
  playlists,
  onAddToQueue,
  onAddToPlaylist,
  onSelectPlaylist,
  onCreatePlaylist,
  onRenamePlaylist,
  onDeletePlaylist,
  onToggleLockPlaylist,
  onRemoveTrack,
  onImportTracks
}: LibraryPanelProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const [hasMounted, setHasMounted] = useState(false);
  const [playlistSearch, setPlaylistSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [folderSelectionAnchorId, setFolderSelectionAnchorId] = useState<string | null>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>([]);
  const [folderTracks, setFolderTracks] = useState<Record<string, Track[]>>({});
  const [activeTrackFolderId, setActiveTrackFolderId] = useState<string | null>(null);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [trackSelectionAnchorId, setTrackSelectionAnchorId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [focusedExplorerItem, setFocusedExplorerItem] = useState<
    | { kind: 'folder'; id: string }
    | { kind: 'track'; id: string; folderId: string }
    | null
  >(null);
  const [recentlyMovedFolderId, setRecentlyMovedFolderId] = useState<string | null>(null);
  const [recentlyMovedTrackIds, setRecentlyMovedTrackIds] = useState<Set<string>>(new Set());
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderNameInput, setFolderNameInput] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [creatingParentFolderId, setCreatingParentFolderId] = useState<string | null>(null);
  const [pendingFolderForUpload, setPendingFolderForUpload] = useState<string | null>(null);
  const [folderLoadingIds, setFolderLoadingIds] = useState<Set<string>>(new Set());

  const closeFolderDialog = () => {
    setFolderDialogOpen(false);
    setEditingFolderId(null);
    setFolderNameInput('');
  };

  const visibleFolderIds = useMemo(() => {
    const roots = folders
      .filter((f) => !String((f as any).parent_id || '').trim())
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const out: string[] = [];
    for (const r of roots) {
      out.push(r.id);
      if (expandedFolderIds.includes(r.id)) {
        const subs = folders
          .filter((sf) => String((sf as any).parent_id || '') === r.id)
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        for (const sf of subs) out.push(sf.id);
      }
    }
    return out;
  }, [folders, expandedFolderIds]);

  const visibleExplorerItems = useMemo(() => {
    const roots = folders
      .filter((f) => !String((f as any).parent_id || '').trim())
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const out: Array<
      | { kind: 'folder'; id: string }
      | { kind: 'track'; id: string; folderId: string }
    > = [];

    for (const r of roots) {
      out.push({ kind: 'folder', id: r.id });

      if (expandedFolderIds.includes(r.id)) {
        const subs = folders
          .filter((sf) => String((sf as any).parent_id || '') === r.id)
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        for (const sf of subs) {
          out.push({ kind: 'folder', id: sf.id });
          if (expandedFolderIds.includes(sf.id)) {
            const tracks = folderTracks[sf.id] || [];
            for (const t of tracks) out.push({ kind: 'track', id: t.id, folderId: sf.id });
          }
        }

        const tracks = folderTracks[r.id] || [];
        for (const t of tracks) out.push({ kind: 'track', id: t.id, folderId: r.id });
      }
    }

    return out;
  }, [expandedFolderIds, folderTracks, folders]);

  const handleSelectFolderNode = useCallback(
    (folderId: string, e: MouseEvent) => {
      setSelectedFolderId(folderId);
      setActiveTrackFolderId(folderId);
      setSelectedTrackIds(new Set());
      setTrackSelectionAnchorId(null);
      setFocusedExplorerItem({ kind: 'folder', id: folderId });

      const meta = e.metaKey;
      const ctrl = e.ctrlKey;
      const shift = e.shiftKey;

      if (shift && folderSelectionAnchorId) {
        const ids = visibleFolderIds;
        const a = ids.indexOf(folderSelectionAnchorId);
        const b = ids.indexOf(folderId);
        if (a >= 0 && b >= 0) {
          const start = Math.min(a, b);
          const end = Math.max(a, b);
          const next = new Set(selectedFolderIds);
          for (let i = start; i <= end; i += 1) next.add(ids[i]);
          setSelectedFolderIds(next);
          return;
        }
      }

      if (meta || ctrl) {
        const next = new Set(selectedFolderIds);
        if (next.has(folderId)) next.delete(folderId);
        else next.add(folderId);
        setSelectedFolderIds(next);
        setFolderSelectionAnchorId(folderId);
        return;
      }

      setSelectedFolderIds(new Set([folderId]));
      setFolderSelectionAnchorId(folderId);
    },
    [visibleFolderIds, selectedFolderIds, folderSelectionAnchorId]
  );

  const focusExplorerItem = useCallback(
    (
      item:
        | { kind: 'folder'; id: string }
        | { kind: 'track'; id: string; folderId: string }
    ) => {
      setFocusedExplorerItem(item);

      if (item.kind === 'folder') {
        setSelectedFolderId(item.id);
        setActiveTrackFolderId(item.id);
        setSelectedTrackIds(new Set());
        setTrackSelectionAnchorId(null);
        setSelectedFolderIds(new Set([item.id]));
        setFolderSelectionAnchorId(item.id);
        return;
      }

      setSelectedFolderId(item.folderId);
      setActiveTrackFolderId(item.folderId);
      setSelectedFolderIds(new Set([item.folderId]));
      setFolderSelectionAnchorId(item.folderId);
      setSelectedTrackIds(new Set([item.id]));
      setTrackSelectionAnchorId(item.id);
    },
    []
  );

  const handleDropOnFolder = useCallback(
    async (targetFolderId: string, e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverFolderId(null);

      const rawTracks = e.dataTransfer.getData('application/x-redio-tracks');
      if (rawTracks) {
        try {
          const payload = JSON.parse(rawTracks);
          const sourceFolderId = payload?.sourceFolderId;
          const trackIds: string[] = Array.isArray(payload?.trackIds) ? payload.trackIds : [];
          if (!sourceFolderId || trackIds.length === 0) return;
          if (String(sourceFolderId) === String(targetFolderId)) return;

          await foldersAPI.moveTracks({ sourceFolderId, targetFolderId, trackIds });

          setFolderTracks((prev) => {
            const src = prev[sourceFolderId] || [];
            const dst = prev[targetFolderId] || [];
            const moveSet = new Set(trackIds);
            const moved = src.filter((t: Track) => moveSet.has(t.id));
            const nextSrc = src.filter((t: Track) => !moveSet.has(t.id));
            const nextDst = [...moved, ...dst];
            return { ...prev, [sourceFolderId]: nextSrc, [targetFolderId]: nextDst };
          });

          setRecentlyMovedFolderId(targetFolderId);
          setRecentlyMovedTrackIds(new Set(trackIds));
          window.setTimeout(() => {
            setRecentlyMovedFolderId(null);
            setRecentlyMovedTrackIds(new Set());
          }, 900);

          setSelectedTrackIds(new Set());
          toast.success('Moved');
        } catch {
          // ignore
        }
        return;
      }

      const rawFolder = e.dataTransfer.getData('application/x-redio-folder');
      if (rawFolder) {
        try {
          const payload = JSON.parse(rawFolder);
          const movingFolderId = String(payload?.folderId || '');
          if (!movingFolderId) return;

          const moving = folders.find((f) => f.id === movingFolderId);
          if (!moving) return;

          const target = folders.find((f) => f.id === targetFolderId);
          const targetParent = String((target as any)?.parent_id || '').trim();
          if (targetParent) {
            toast.error('Cannot move into a subfolder');
            return;
          }

          await foldersAPI.setParent(movingFolderId, targetFolderId);
          setFolders((prev) =>
            prev.map((f) => (f.id === movingFolderId ? ({ ...f, parent_id: targetFolderId } as any) : f))
          );
          toast.success('Moved');
        } catch {
          // ignore
        }
      }
    },
    [expandedFolderIds, folders]
  );

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    if (!folderDialogOpen) return;

    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeFolderDialog();
        return;
      }

      if (e.key === 'Enter') {
        const t = e.target as HTMLElement | null;
        if (t && t.tagName === 'INPUT') {
          e.preventDefault();
          void handleConfirmFolder();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [folderDialogOpen, folderNameInput, editingFolderId]);

  // Load folders from backend
  useEffect(() => {
    const load = async () => {
      try {
        const data = await foldersAPI.getAll();
        setFolders(data as any);
      } catch (err) {
        console.error('Failed to load folders', err);
      }
    };
    load();
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await foldersAPI.getAll();
        setFolders(data as any);
        if (expandedFolderIds.length > 0) {
          setFolderLoadingIds((prev) => {
            const next = new Set(prev);
            for (const id of expandedFolderIds) next.add(id);
            return next;
          });
          try {
            const results = await Promise.all(
              expandedFolderIds.map(async (folderId) => {
                const raw = await foldersAPI.getTracks(folderId);
                const normalized: Track[] = (raw || []).map((t: any) => ({
                  id: t.id,
                  name: t.name,
                  artist: t.artist,
                  duration: t.duration || 0,
                  size: t.size || 0,
                  filePath: resolveUploadsUrl(t.file_path),
                  hash: t.hash,
                  dateAdded: t.date_added ? new Date(t.date_added) : new Date(),
                }));
                normalized.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                return { folderId, tracks: normalized };
              })
            );
            setFolderTracks((prev) => {
              const next = { ...prev };
              for (const r of results) next[r.folderId] = r.tracks;
              return next;
            });
          } finally {
            setFolderLoadingIds((prev) => {
              const next = new Set(prev);
              for (const id of expandedFolderIds) next.delete(id);
              return next;
            });
          }
        }
      } catch (err) {
        console.error('Failed to load folders', err);
      }
    };

    const onResync = () => void load();
    window.addEventListener('redio:library-resync', onResync);
    return () => window.removeEventListener('redio:library-resync', onResync);
  }, [expandedFolderIds]);

  useEffect(() => {
    if (folders.length === 0) return;
    const firstFolderId = folders[0]?.id;
    if (!firstFolderId) return;
    if (folderTracks[firstFolderId]) return;

    const idle = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;
    const cancelIdle = (window as any).cancelIdleCallback as ((id: number) => void) | undefined;

    let cancelled = false;
    const prefetch = async () => {
      try {
        const raw = await foldersAPI.getTracks(firstFolderId);
        const normalized: Track[] = (raw || []).map((t: any) => ({
          id: t.id,
          name: t.name,
          artist: t.artist,
          duration: t.duration || 0,
          size: t.size || 0,
          filePath: resolveUploadsUrl(t.file_path),
          hash: t.hash,
          dateAdded: t.date_added ? new Date(t.date_added) : new Date(),
        }));
        normalized.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        if (cancelled) return;
        startTransition(() => {
          setFolderTracks((prev) => ({ ...prev, [firstFolderId]: normalized }));
        });
      } catch {
        // ignore background prefetch errors
      }
    };

    if (idle) {
      const id = idle(() => void prefetch(), { timeout: 1500 });
      return () => {
        cancelled = true;
        if (cancelIdle) cancelIdle(id);
      };
    }

    const id = window.setTimeout(() => void prefetch(), 350);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [folders, folderTracks]);

  // Keep expanded folder contents in sync when the global tracks list changes
  useEffect(() => {
    const refreshExpandedFolders = async () => {
      try {
        const updates: Record<string, Track[]> = {};
        const results = await Promise.all(
          expandedFolderIds.map(async (folderId) => {
            const raw = await foldersAPI.getTracks(folderId);
            const normalized: Track[] = (raw || []).map((t: any) => ({
              id: t.id,
              name: t.name,
              artist: t.artist,
              duration: t.duration || 0,
              size: t.size || 0,
              filePath: resolveUploadsUrl(t.file_path),
              hash: t.hash,
              dateAdded: t.date_added ? new Date(t.date_added) : new Date(),
            }));
            normalized.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
            return { folderId, tracks: normalized };
          })
        );

        for (const r of results) {
          if (!r.tracks) continue;
          updates[r.folderId] = r.tracks;
        }

        const keys = Object.keys(updates);
        if (keys.length === 0) return;
        setFolderTracks((prev) => ({
          ...prev,
          ...updates,
        }));
      } catch (err) {
        console.error('Failed to refresh expanded folder tracks', err);
      }
    };

    if (expandedFolderIds.length > 0) {
      refreshExpandedFolders();
    }
  }, [tracks, expandedFolderIds]);

  const handleSelectFolderTrack = useCallback(
    (trackId: string, e: MouseEvent) => {
      const folderId = activeTrackFolderId;
      // Clear folder selection when selecting a track (fix multi-selection conflict)
      setSelectedFolderId(null);
      setFocusedExplorerItem({ kind: 'track', id: trackId, folderId: folderId || '' });

      const list = folderTracks[folderId || ''] || [];
      const ids = list.map((t) => t.id);
      const meta = e.metaKey;
      const ctrl = e.ctrlKey;
      const shift = e.shiftKey;

      // If there's no active folder or track not in list, fall back to simple selection
      if (!folderId || !ids.includes(trackId)) {
        setSelectedTrackIds(new Set([trackId]));
        setTrackSelectionAnchorId(trackId);
        return;
      }

      if (shift && trackSelectionAnchorId) {
        const a = ids.indexOf(trackSelectionAnchorId);
        const b = ids.indexOf(trackId);
        if (a >= 0 && b >= 0) {
          const start = Math.min(a, b);
          const end = Math.max(a, b);
          const next = new Set(selectedTrackIds);
          for (let i = start; i <= end; i += 1) next.add(ids[i]);
          setSelectedTrackIds(next);
          return;
        }
      }

      if (meta || ctrl) {
        const next = new Set(selectedTrackIds);
        if (next.has(trackId)) next.delete(trackId);
        else next.add(trackId);
        setSelectedTrackIds(next);
        setTrackSelectionAnchorId(trackId);
        return;
      }

      setSelectedTrackIds(new Set([trackId]));
      setTrackSelectionAnchorId(trackId);
    },
    [activeTrackFolderId, folderTracks, selectedTrackIds, trackSelectionAnchorId]
  );

  const getTrackDragPayload = useCallback(
    (trackId: string, sourceFolderId?: string) => {
      const folderId = sourceFolderId || undefined;
      const payload = selectedTrackIds.has(trackId)
        ? { trackIds: Array.from(selectedTrackIds), sourceFolderId: folderId }
        : { trackIds: [trackId], sourceFolderId: folderId };
      // Responsive drag preview: include count in payload for UI feedback
      (payload as any).count = payload.trackIds.length;
      return payload;
    },
    [selectedTrackIds]
  );

  const handleRemoveFolderTrack = useCallback(
    (trackId: string) => {
      onRemoveTrack(trackId);
    },
    [onRemoveTrack]
  );

  const filteredPlaylists = useMemo(() => {
    return playlists.filter(playlist =>
      playlist.name.toLowerCase().includes(playlistSearch.toLowerCase())
    );
  }, [playlists, playlistSearch]);

  const handleOpenNewFolderDialog = () => {
    setEditingFolderId(null);
    setCreatingParentFolderId(null);
    setFolderNameInput('');
    setFolderDialogOpen(true);
  };

  const handleOpenNewSubfolderDialog = (parentFolderId: string) => {
    setEditingFolderId(null);
    setCreatingParentFolderId(parentFolderId);
    setFolderNameInput('');
    setFolderDialogOpen(true);
  };

  const handleConfirmFolder = async () => {
    const trimmed = folderNameInput.trim();
    if (!trimmed) {
      closeFolderDialog();
      return;
    }

    try {
      if (editingFolderId) {
        const updated = await foldersAPI.rename(editingFolderId, trimmed);
        setFolders(prev => prev.map(f => (f.id === updated.id ? updated : f)));
      } else {
        const created = await foldersAPI.create(trimmed, creatingParentFolderId || undefined);
        setFolders(prev => [...prev, created]);

        if (creatingParentFolderId) {
          setExpandedFolderIds((prev) =>
            prev.includes(creatingParentFolderId) ? prev : [...prev, creatingParentFolderId]
          );
        }
      }

      setFolderDialogOpen(false);
    } catch (err: any) {
      console.error('Failed to save folder', err);
      alert(err?.message || 'Failed to save folder');
    }
  };

  const handleRenameFolder = (folder: LibraryFolder) => {
    setEditingFolderId(folder.id);
    setFolderNameInput(folder.name);
    setFolderDialogOpen(true);
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (!confirm('Delete this folder?')) return;
    try {
      await foldersAPI.delete(folderId);
      setFolders(prev => prev.filter(f => f.id !== folderId && (f as any).parent_id !== folderId));
      setFolderTracks(prev => {
        const next = { ...prev };
        delete next[folderId];
        return next;
      });
      setExpandedFolderIds(prev => prev.filter(id => id !== folderId));
      if (selectedFolderId === folderId) {
        setSelectedFolderId(null);
      }
    } catch (err: any) {
      console.error('Failed to delete folder', err);
      alert(err?.message || 'Failed to delete folder');
    }
  };

  const toggleFolderExpanded = async (folderId: string) => {
    setSelectedFolderId(folderId);
    const willExpand = !expandedFolderIds.includes(folderId);
    setExpandedFolderIds((prev) => (prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId]));

    if (!willExpand) {
      return;
    }

    if (!folderTracks[folderId]) {
      setFolderLoadingIds((prev) => {
        const next = new Set(prev);
        next.add(folderId);
        return next;
      });

      window.setTimeout(async () => {
        try {
          const raw = await foldersAPI.getTracks(folderId);
          const normalized: Track[] = (raw || []).map((t: any) => ({
            id: t.id,
            name: t.name,
            artist: t.artist,
            duration: t.duration || 0,
            size: t.size || 0,
            filePath: resolveUploadsUrl(t.file_path),
            hash: t.hash,
            dateAdded: t.date_added ? new Date(t.date_added) : new Date(),
          }));
          normalized.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
          startTransition(() => {
            setFolderTracks((prev) => ({ ...prev, [folderId]: normalized }));
          });
        } catch (err) {
          console.error('Failed to load folder tracks', err);
        } finally {
          setFolderLoadingIds((prev) => {
            const next = new Set(prev);
            next.delete(folderId);
            return next;
          });
        }
      }, 0);
    }
  };

  const handleExplorerKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
      if (visibleExplorerItems.length === 0) return;

      let currentIndex = -1;
      if (focusedExplorerItem) {
        currentIndex = visibleExplorerItems.findIndex((it) => {
          if (focusedExplorerItem.kind === 'folder') {
            return it.kind === 'folder' && it.id === focusedExplorerItem.id;
          }
          return (
            it.kind === 'track' &&
            it.id === focusedExplorerItem.id &&
            it.folderId === focusedExplorerItem.folderId
          );
        });
      }

      if (e.key === 'Enter') {
        if (focusedExplorerItem?.kind === 'folder') {
          e.preventDefault();
          void toggleFolderExpanded(focusedExplorerItem.id);
        }
        return;
      }

      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const base = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = Math.min(visibleExplorerItems.length - 1, Math.max(0, base + dir));
      focusExplorerItem(visibleExplorerItems[nextIndex]);
    },
    [focusExplorerItem, focusedExplorerItem, toggleFolderExpanded, visibleExplorerItems]
  );

  const isAudioFile = (file: File) => {
    const lower = file.name.toLowerCase();
    return (
      lower.endsWith('.mp3') ||
      lower.endsWith('.wav') ||
      lower.endsWith('.ogg') ||
      lower.endsWith('.m4a') ||
      lower.endsWith('.flac')
    );
  };

  return (
    <div className="h-full flex flex-col bg-background border-r border-border">
      {/* Library Header */}
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Library</h2>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="gap-2"
              onClick={handleOpenNewFolderDialog}
            >
              <Plus className="w-4 h-4" />
              <span>New Folder</span>
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".mp3,.wav,.ogg,.m4a,.flac"
              className="hidden"
              onChange={async (e) => {
                const files = e.target.files ? Array.from(e.target.files) : [];
                if (files.length > 0) {
                  const targetFolderId = pendingFolderForUpload || selectedFolderId;
                  setPendingFolderForUpload(null);

                  // Enforce: audio files cannot be added to the Library root.
                  // A folder must be selected or chosen via context menu first.
                  if (!targetFolderId) {
                    alert('Select a folder first, then add files into that folder.');
                    e.target.value = '';
                    return;
                  }

                  await onImportTracks(files, targetFolderId);

                  // Refresh this folder's contents after upload
                  try {
                    const raw = await foldersAPI.getTracks(targetFolderId);
                    const normalized: Track[] = (raw || []).map((t: any) => ({
                      id: t.id,
                      name: t.name,
                      artist: t.artist,
                      duration: t.duration || 0,
                      size: t.size || 0,
                      filePath: resolveUploadsUrl(t.file_path),
                      hash: t.hash,
                      dateAdded: t.date_added ? new Date(t.date_added) : new Date(),
                    }));
                    normalized.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                    setFolderTracks(prev => ({ ...prev, [targetFolderId]: normalized }));
                  } catch (err) {
                    console.error('Failed to refresh folder tracks after upload', err);
                  }
                }
                // allow re-selecting the same files
                e.target.value = '';
              }}
            />
        </div>
      </div>
      
      {/* Search and sort controls removed per request; Library now shows a simple folder tree without filters. */}
    </div>

    {/* Folder List (VS Code style) */}
    {folders.length > 0 && (
      <div
        className="flex-1 overflow-y-auto px-2 py-2 space-y-1 border-t border-border scroll-thin outline-none"
        tabIndex={0}
        onKeyDown={handleExplorerKeyDown}
      >
        <AnimatePresence mode="popLayout">
          {folders
            .filter((f) => !String((f as any).parent_id || '').trim())
            .map((folder) => {
              const expanded = expandedFolderIds.includes(folder.id);
              const childFolders = folders
                .filter((sf) => String((sf as any).parent_id || '') === folder.id)
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

              const tracksInFolder = folderTracks[folder.id] || [];
              const trackCount = tracksInFolder.length;
              return (
                <motion.div
                  key={folder.id}
                  layout
                  initial={reduceMotion || !hasMounted ? false : { opacity: 0, y: -6 }}
                  animate={reduceMotion || !hasMounted ? undefined : { opacity: 1, y: 0 }}
                  exit={reduceMotion || !hasMounted ? undefined : { opacity: 0, y: 6 }}
                  transition={reduceMotion ? undefined : { duration: 0.16, ease: 'easeOut' }}
                  className="space-y-0.5"
                >
                  <ContextMenu>
                    <ContextMenuTrigger>
                      <button
                        type="button"
                        onClick={(e) => {
                          handleSelectFolderNode(folder.id, e);
                          toggleFolderExpanded(folder.id);
                        }}
                        onDragEnter={() => setDragOverFolderId(folder.id)}
                        onDragLeave={(e) => {
                          const next = e.relatedTarget as Node | null;
                          if (!next || !e.currentTarget.contains(next)) setDragOverFolderId(null);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(e) => {
                          void handleDropOnFolder(folder.id, e);
                        }}
                        className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs text-left transition-colors ${
                          selectedFolderId === folder.id
                            ? 'bg-[#094771] dark:bg-[#1a3b5c] text-white'
                            : dragOverFolderId === folder.id
                              ? 'bg-[#37373d] dark:bg-[#2a2d2e] text-foreground'
                              : 'hover:bg-[#2a2d2e] dark:hover:bg-[#37373d] text-foreground'
                        }`}
                      >
                        {expanded ? (
                          <ChevronDown className="w-3 h-3 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-3 h-3 text-muted-foreground" />
                        )}
                        <Folder className="w-4 h-4 text-muted-foreground" />
                        <span className="flex-1 truncate font-semibold text-sm select-text">{folder.name}</span>
                        {trackCount > 0 && (
                          <span className="text-[10px] text-muted-foreground select-text">
                            {trackCount} track{trackCount === 1 ? '' : 's'}
                          </span>
                        )}
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onClick={() => handleOpenNewSubfolderDialog(folder.id)}>
                        Create Folder
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleOpenNewSubfolderDialog(folder.id)}>
                        New Subfolder
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => {
                          setPendingFolderForUpload(folder.id);
                          fileInputRef.current?.click();
                        }}
                      >
                        Add Files
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleRenameFolder(folder)}>
                        Rename Folder
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => handleDeleteFolder(folder.id)}
                        className="text-destructive"
                      >
                        Delete Folder
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>

                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div
                        key={`${folder.id}-expanded`}
                        initial={reduceMotion || !hasMounted ? false : { opacity: 0, height: 0 }}
                        animate={reduceMotion || !hasMounted ? undefined : { opacity: 1, height: 'auto' }}
                        exit={reduceMotion || !hasMounted ? undefined : { opacity: 0, height: 0 }}
                        transition={reduceMotion ? undefined : { duration: 0.22, ease: 'easeInOut' }}
                        className="ml-6 border-l border-border/40 pl-3 mt-1 space-y-0.5 overflow-hidden"
                      >
                        {childFolders.length > 0 && (
                          <div className="space-y-0.5">
                            {childFolders.map((sf) => {
                              const sfTracks = folderTracks[sf.id] || [];
                              const sfCount = sfTracks.length;
                              const sfSelected = selectedFolderId === sf.id;
                              const sfExpanded = expandedFolderIds.includes(sf.id);

                              return (
                                <div key={sf.id} className="space-y-0.5">
                                  <ContextMenu>
                                    <ContextMenuTrigger>
                                      <button
                                        type="button"
                                        draggable
                                        onDragStart={(e) => {
                                          try {
                                            e.dataTransfer.setData(
                                              'application/x-redio-folder',
                                              JSON.stringify({ folderId: sf.id })
                                            );
                                            e.dataTransfer.effectAllowed = 'move';
                                          } catch {
                                            // ignore
                                          }
                                        }}
                                        onClick={(e) => {
                                          handleSelectFolderNode(sf.id, e);
                                          toggleFolderExpanded(sf.id);
                                        }}
                                        onDragEnter={() => setDragOverFolderId(sf.id)}
                                        onDragLeave={(e) => {
                                          const next = e.relatedTarget as Node | null;
                                          if (!next || !e.currentTarget.contains(next)) setDragOverFolderId(null);
                                        }}
                                        onDragOver={(e) => {
                                          e.preventDefault();
                                          e.dataTransfer.dropEffect = 'move';
                                        }}
                                        onDrop={(e) => {
                                          void handleDropOnFolder(sf.id, e);
                                        }}
                                        className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs text-left transition-colors ${
                                          sfSelected
                                            ? 'bg-[#094771] dark:bg-[#1a3b5c] text-white'
                                            : dragOverFolderId === sf.id
                                              ? 'bg-[#37373d] dark:bg-[#2a2d2e] text-foreground'
                                              : 'hover:bg-[#2a2d2e] dark:hover:bg-[#37373d] text-foreground'
                                        }`}
                                      >
                                        {sfExpanded ? (
                                          <ChevronDown className="w-3 h-3 text-muted-foreground" />
                                        ) : (
                                          <ChevronRight className="w-3 h-3 text-muted-foreground" />
                                        )}
                                        <Folder className="w-4 h-4 text-muted-foreground" />
                                        <span className="flex-1 truncate text-sm select-text">{sf.name}</span>
                                        {sfCount > 0 && (
                                          <span className="text-[10px] text-muted-foreground select-text">
                                            {sfCount} track{sfCount === 1 ? '' : 's'}
                                          </span>
                                        )}
                                      </button>
                                    </ContextMenuTrigger>
                                    <ContextMenuContent>
                                      <ContextMenuItem
                                        onClick={() => {
                                          setPendingFolderForUpload(sf.id);
                                          fileInputRef.current?.click();
                                        }}
                                      >
                                        Add Files
                                      </ContextMenuItem>
                                      <ContextMenuItem onClick={() => handleRenameFolder(sf)}>
                                        Rename Folder
                                      </ContextMenuItem>
                                      <ContextMenuItem
                                        onClick={() => handleDeleteFolder(sf.id)}
                                        className="text-destructive"
                                      >
                                        Delete Folder
                                      </ContextMenuItem>
                                    </ContextMenuContent>
                                  </ContextMenu>

                                  {sfExpanded && (
                                    <div className="ml-6 border-l border-border/40 pl-3 mt-1 space-y-0.5">
                                      {folderLoadingIds.has(sf.id) ? (
                                        <div className="text-[11px] text-muted-foreground/80 pl-5 py-0.5">
                                          Loading…
                                        </div>
                                      ) : sfTracks.length === 0 ? (
                                        <div className="text-[11px] text-muted-foreground/80 pl-5 py-0.5">
                                          No tracks in this folder
                                        </div>
                                      ) : (
                                        <VirtualizedFolderTrackList
                                          tracks={sfTracks}
                                          folderId={sf.id}
                                          selectedTrackIds={activeTrackFolderId === sf.id ? selectedTrackIds : new Set()}
                                          recentlyMovedTrackIds={recentlyMovedFolderId === sf.id ? recentlyMovedTrackIds : undefined}
                                          onSelect={handleSelectFolderTrack}
                                          getDragPayload={getTrackDragPayload}
                                          onAddToQueue={onAddToQueue}
                                          onAddToPlaylist={onAddToPlaylist}
                                          playlists={playlists}
                                          onRemove={handleRemoveFolderTrack}
                                        />
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="pt-1">
                          {folderLoadingIds.has(folder.id) ? (
                            <div className="text-[11px] text-muted-foreground/80 pl-5 py-0.5">
                              Loading…
                            </div>
                          ) : tracksInFolder.length === 0 ? (
                            <div className="text-[11px] text-muted-foreground/80 pl-5 py-0.5">
                              No tracks in this folder
                            </div>
                          ) : (
                            <VirtualizedFolderTrackList
                              tracks={tracksInFolder}
                              folderId={folder.id}
                              selectedTrackIds={activeTrackFolderId === folder.id ? selectedTrackIds : new Set()}
                              recentlyMovedTrackIds={recentlyMovedFolderId === folder.id ? recentlyMovedTrackIds : undefined}
                              onSelect={handleSelectFolderTrack}
                              getDragPayload={getTrackDragPayload}
                              onAddToQueue={onAddToQueue}
                              onAddToPlaylist={onAddToPlaylist}
                              playlists={playlists}
                              onRemove={handleRemoveFolderTrack}
                            />
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
        </AnimatePresence>
      </div>
    )}

      {/* New/Rename Folder Modal (custom, non-Radix to avoid focus issues) */}
      <AnimatePresence>
        {folderDialogOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => {
              closeFolderDialog();
            }}
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
                  void handleConfirmFolder();
                }}
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold tracking-tight text-foreground">
                    {editingFolderId ? 'Rename Folder' : creatingParentFolderId ? 'New Subfolder' : 'New Folder'}
                  </h3>
                  <button
                    type="button"
                    onClick={closeFolderDialog}
                    className="text-muted-foreground hover:text-foreground text-lg leading-none px-2"
                  >
                    ×
                  </button>
                </div>
                <div className="space-y-2">
                  <Input
                    autoFocus
                    placeholder="Folder name"
                    value={folderNameInput}
                    onChange={(e) => setFolderNameInput(e.target.value)}
                    className="bg-white text-slate-900 placeholder:text-slate-500 border-slate-300 focus-visible:ring-primary/30 focus-visible:border-primary dark:bg-input/40 dark:text-foreground dark:placeholder:text-muted-foreground/80 dark:border-input"
                  />
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <Button size="sm" variant="outline" type="button" onClick={closeFolderDialog}>
                    Cancel
                  </Button>
                  <Button size="sm" type="submit">
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