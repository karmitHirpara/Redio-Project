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
import { Folder, FolderPlus, FolderUp, FolderInput, ChevronRight, ChevronDown } from 'lucide-react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
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
  onSelect: (trackId: string, folderId: string, e: MouseEvent) => void;
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
                onSelect={(id, e) => onSelect(id, folderId || '', e)}
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
  onRemoveTracks?: (trackIds: string[]) => void;
  onImportTracks: (files: File[], folderId?: string) => Promise<void> | void;
  onImportFolder?: (files: File[], parentFolderId?: string) => Promise<void> | void;
  importProgress?: { percent: number; label: string } | null;
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
  onRemoveTracks,
  onImportTracks,
  onImportFolder,
  importProgress,
}: LibraryPanelProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const [hasMounted, setHasMounted] = useState(false);

  // Custom Drag Ghost Element
  const dragGhostRef = useRef<HTMLDivElement>(null);
  const [dragGhostCount, setDragGhostCount] = useState(0);
  const [playlistSearch, setPlaylistSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
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

  const foldersByParentId = useMemo(() => {
    const map = new Map<string, LibraryFolder[]>();
    for (const f of folders) {
      const parentId = String((f as any).parent_id || '').trim();
      const arr = map.get(parentId) || [];
      arr.push(f);
      map.set(parentId, arr);
    }
    for (const [key, arr] of map.entries()) {
      arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      map.set(key, arr);
    }
    return map;
  }, [folders]);

  const folderDescendantsMap = useMemo(() => {
    const parentOf = new Map<string, string>();
    for (const f of folders) {
      parentOf.set(String(f.id), String((f as any).parent_id || '').trim());
    }

    const out = new Map<string, Set<string>>();
    const dfs = (id: string): Set<string> => {
      const cached = out.get(id);
      if (cached) return cached;
      const set = new Set<string>();
      const children = foldersByParentId.get(id) || [];
      for (const c of children) {
        set.add(String(c.id));
        const sub = dfs(String(c.id));
        sub.forEach((x) => set.add(x));
      }
      out.set(id, set);
      return set;
    };

    for (const f of folders) {
      dfs(String(f.id));
    }
    void parentOf;
    return out;
  }, [folders, foldersByParentId]);

  const visibleExplorerItems = useMemo(() => {
    const out: Array<
      | { kind: 'folder'; id: string; depth: number }
      | { kind: 'track'; id: string; folderId: string; depth: number }
    > = [];

    const walk = (parentId: string, depth: number) => {
      const children = foldersByParentId.get(parentId) || [];
      for (const f of children) {
        out.push({ kind: 'folder', id: String(f.id), depth });
        const expanded = expandedFolderIds.includes(String(f.id));
        if (expanded) {
          walk(String(f.id), depth + 1);
          const tracksInFolder = folderTracks[String(f.id)] || [];
          for (const t of tracksInFolder) {
            out.push({ kind: 'track', id: String(t.id), folderId: String(f.id), depth: depth + 1 });
          }
        }
      }
    };

    walk('', 0);
    return out;
  }, [expandedFolderIds, folderTracks, foldersByParentId]);

  const handleSelectExplorerItem = useCallback(
    (item: { kind: 'folder' | 'track'; id: string; folderId?: string }, e: MouseEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;

      setFocusedExplorerItem(item as any);

      // VS Code style: Mixed selection is allowed.
      // If no modifier, clear others and select this one.
      if (!meta && !shift) {
        if (item.kind === 'folder') {
          setSelectedFolderIds(new Set([item.id]));
          setSelectedTrackIds(new Set());
          setSelectedFolderId(item.id);
          setActiveTrackFolderId(item.id);
          setFolderSelectionAnchorId(item.id);
          setTrackSelectionAnchorId(null);
        } else {
          setSelectedTrackIds(new Set([item.id]));
          setSelectedFolderIds(new Set());
          setActiveTrackFolderId(item.folderId || null);
          setTrackSelectionAnchorId(item.id);
          setFolderSelectionAnchorId(null);
        }
        return;
      }

      const items = visibleExplorerItems;
      const currentIndex = items.findIndex((it) => it.kind === item.kind && it.id === item.id);
      if (currentIndex === -1) return;

      if (shift) {
        // Shift selection needs a stable anchor. 
        // We use either folderSelectionAnchorId or trackSelectionAnchorId depending on what was last clicked/anchored.
        // If we have mixed anchors (rare), prefer the one matching the current item kind, or fallback to the first selected item.

        let anchorIndex = -1;
        // Try to find the anchor in the visible list
        if (folderSelectionAnchorId) {
          anchorIndex = items.findIndex(it => it.kind === 'folder' && it.id === folderSelectionAnchorId);
        }
        if (anchorIndex === -1 && trackSelectionAnchorId) {
          anchorIndex = items.findIndex(it => it.kind === 'track' && it.id === trackSelectionAnchorId);
        }

        // If no anchor found, default to the current item (effectively single select)
        if (anchorIndex === -1) {
          anchorIndex = currentIndex;
        }

        const start = Math.min(anchorIndex, currentIndex);
        const end = Math.max(anchorIndex, currentIndex);

        const nextFolders = new Set(meta ? selectedFolderIds : []);
        const nextTracks = new Set(meta ? selectedTrackIds : []);

        // Logic: specific to VS Code behavior
        // If you Shift+Click, it selects the range. 
        // BUT if you held Meta before, it keeps previous selection? VS Code usually clears unless you Cmd+Shift?
        // Actually VS Code Shift+Click extends selection from anchor to target.
        // Existing selection outside range is preserved ONLY if it was "multi-cursor" style, but usually simple Shift+Select replaces.
        // However, standard OS behavior usually clears disjoint selections unless Cmd is held.
        // Let's implement: Shift+Click clears everything else and selects range [Anchor, Target].
        // If Meta+Shift+Click, it adds range to existing.

        if (!meta) {
          nextFolders.clear();
          nextTracks.clear();
        }

        for (let i = start; i <= end; i++) {
          const it = items[i];
          if (it.kind === 'folder') nextFolders.add(it.id);
          else nextTracks.add(it.id);
        }

        setSelectedFolderIds(nextFolders);
        setSelectedTrackIds(nextTracks);
        return;
      }

      if (meta) {
        // Toggle behavior
        if (item.kind === 'folder') {
          const next = new Set(selectedFolderIds);
          if (next.has(item.id)) {
            next.delete(item.id);
            if (folderSelectionAnchorId === item.id) setFolderSelectionAnchorId(null);
          } else {
            next.add(item.id);
            setFolderSelectionAnchorId(item.id);
          }
          setSelectedFolderIds(next);
        } else {
          const next = new Set(selectedTrackIds);
          if (next.has(item.id)) {
            next.delete(item.id);
            if (trackSelectionAnchorId === item.id) setTrackSelectionAnchorId(null);
          } else {
            next.add(item.id);
            setTrackSelectionAnchorId(item.id);
          }
          setSelectedTrackIds(next);
        }
        setFocusedExplorerItem(item as any); // Update focus to clicked item
        return;
      }
    },
    [visibleExplorerItems, selectedFolderIds, selectedTrackIds, folderSelectionAnchorId, trackSelectionAnchorId]
  );

  const focusExplorerItem = useCallback(
    (
      item:
        | { kind: 'folder'; id: string }
        | { kind: 'track'; id: string; folderId: string }
    ) => {
      setFocusedExplorerItem(item);

      // Auto-select on focus (VS Code default behavior for navigation)
      // This makes Arrow keys change selection.
      if (item.kind === 'folder') {
        setSelectedFolderId(item.id);
        setActiveTrackFolderId(item.id);
        setSelectedTrackIds(new Set());
        setTrackSelectionAnchorId(null);
        setSelectedFolderIds(new Set([item.id]));
        setFolderSelectionAnchorId(item.id);
      } else {
        setSelectedFolderId(item.folderId);
        setActiveTrackFolderId(item.folderId);
        setSelectedFolderIds(new Set([item.folderId]));
        // Clear other tracks? Yes for single select navigation
        setSelectedTrackIds(new Set([item.id]));
        setTrackSelectionAnchorId(item.id);
        setFolderSelectionAnchorId(item.folderId);
      }
    },
    []
  );

  const handleDropOnFolder = useCallback(
    async (targetFolderId: string | null, e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverFolderId(null);

      const items = Array.from(e.dataTransfer?.items || []);
      const hasDirectoryEntry = items.some((it) => {
        try {
          const entry = (it as any).webkitGetAsEntry?.();
          return Boolean(entry && entry.isDirectory);
        } catch {
          return false;
        }
      });

      if (onImportFolder && hasDirectoryEntry) {
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
            // eslint-disable-next-line no-constant-condition
            while (true) {
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

        // Drop onto empty space: create a new root folder for each dropped top-level directory.
        if (!targetFolderId) {
          let createdAny = false;
          for (const it of items) {
            const entry = (it as any).webkitGetAsEntry?.();
            if (!entry || !entry.isDirectory) continue;

            let parentId: string | null = null;
            try {
              const created = await foldersAPI.create(String(entry.name || 'Folder'), undefined);
              parentId = String(created.id);
              setFolders((prev) => [...prev, created as any]);
              createdAny = true;
            } catch (err) {
              console.error('Failed to create parent folder for drop import', err);
              continue;
            }

            const collected = await readEntry(entry, '', false);
            if (collected.length > 0 && parentId) {
              await onImportFolder(collected, parentId);
            }
          }

          if (!createdAny) {
            toast.error('Drop a folder here to import');
          }

          try {
            const data = await foldersAPI.getAll();
            setFolders(data as any);
          } catch {
            // ignore
          }
          return;
        }

        // Drop onto an existing folder: preserve the folder name as a nested subfolder.
        const collected: File[] = [];
        for (const it of items) {
          const entry = (it as any).webkitGetAsEntry?.();
          if (!entry) continue;
          const files = await readEntry(entry, '', true);
          collected.push(...files);
        }

        if (collected.length === 0) {
          toast.error('No files found in that folder');
          return;
        }

        await onImportFolder(collected, targetFolderId);
        try {
          const data = await foldersAPI.getAll();
          setFolders(data as any);
        } catch {
          // ignore
        }
        return;
      }

      const rawTracks = e.dataTransfer.getData('application/x-redio-tracks');
      if (rawTracks) {
        try {
          const payload = JSON.parse(rawTracks);
          const sourceFolderId = payload?.sourceFolderId;
          const trackIds: string[] = Array.isArray(payload?.trackIds) ? payload.trackIds : [];
          if (trackIds.length === 0) return;

          // targetFolderId null means drop on root background
          if (String(sourceFolderId) === String(targetFolderId)) return;

          // For files at root, we need to handle them specially if the backend supports it,
          // but based on current code, audio files REQUIRE a folder.
          if (!targetFolderId) {
            toast.error('Files must be inside a folder');
            return;
          }

          await foldersAPI.moveTracks({ sourceFolderId: sourceFolderId || '', targetFolderId, trackIds });

          setFolderTracks((prev) => {
            const next = { ...prev };
            if (sourceFolderId) {
              const src = prev[sourceFolderId] || [];
              const moveSet = new Set(trackIds);
              next[sourceFolderId] = src.filter((t: Track) => !moveSet.has(t.id));
            }

            const dst = prev[targetFolderId] || [];
            // Ideally we'd fetch the full track objects from somewhere or have them in payload
            // For now, assume optimistic update is handled by the useEffect(tracks) or refresh logic
            return next;
          });

          setRecentlyMovedFolderId(targetFolderId);
          setRecentlyMovedTrackIds(new Set(trackIds));
          window.setTimeout(() => {
            setRecentlyMovedFolderId(null);
            setRecentlyMovedTrackIds(new Set());
          }, 900);
        } catch {
          // ignore
        }
      }



      const rawFolder = e.dataTransfer.getData('application/x-redio-folder');
      if (rawFolder) {
        try {
          const payload = JSON.parse(rawFolder);
          const movingFolderIds: string[] = Array.isArray(payload?.folderIds)
            ? payload.folderIds.map((x: any) => String(x))
            : payload?.folderId
              ? [String(payload.folderId)]
              : [];

          if (movingFolderIds.length === 0) return;

          const destParentId = String(targetFolderId || '');

          for (const movingFolderId of movingFolderIds) {
            if (movingFolderId === destParentId) {
              toast.error('Cannot move folder into itself');
              return;
            }

            const descendants = folderDescendantsMap.get(movingFolderId);
            if (descendants && descendants.has(destParentId)) {
              toast.error('Cannot move folder into its subfolder');
              return;
            }
          }

          for (const movingFolderId of movingFolderIds) {
            await foldersAPI.setParent(movingFolderId, destParentId);
          }

          setFolders((prev) =>
            prev.map((f) =>
              movingFolderIds.includes(String(f.id))
                ? ({ ...f, parent_id: destParentId } as any)
                : f
            )
          );

          toast.success(movingFolderIds.length === 1 ? 'Moved folder' : `Moved ${movingFolderIds.length} folders`);
        } catch {
          // ignore
        }
      }
    },
    [folderDescendantsMap, onImportFolder]
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
    (trackId: string, folderId: string, e: React.MouseEvent) => {
      // We must use the passed folderId because activeTrackFolderId might be stale 
      // if clicking a track in a non-active folder.
      handleSelectExplorerItem({ kind: 'track', id: trackId, folderId }, e as any);
    },
    [handleSelectExplorerItem]
  );

  const getTrackDragPayload = useCallback(
    (trackId: string, sourceFolderId?: string) => {
      const folderId = sourceFolderId || undefined;
      const payload = selectedTrackIds.has(trackId)
        ? { trackIds: Array.from(selectedTrackIds), sourceFolderId: folderId }
        : { trackIds: [trackId], sourceFolderId: folderId };

      return payload;
    },
    [selectedTrackIds]
  );

  const getFolderDragPayload = useCallback(
    (folderId: string) => {
      const payload = selectedFolderIds.has(folderId)
        ? { folderIds: Array.from(selectedFolderIds) }
        : { folderIds: [folderId] };
      return payload;
    },
    [selectedFolderIds]
  );

  // ...

  const handleRemoveFolderTrack = useCallback(
    (trackId: string) => {
      onRemoveTrack(trackId);
    },
    [onRemoveTrack]
  );

  const handleDeleteSelectedTracks = useCallback(async () => {
    if (selectedTrackIds.size === 0) return;

    const count = selectedTrackIds.size;
    const confirmMessage = count === 1
      ? 'Delete this selected track?'
      : `Delete ${count} selected tracks?`;

    // Optimistic prompt? Or rely on App.tsx ConfirmDialog?
    // App.tsx uses onRemoveTracks -> state -> ConfirmDialog.
    // So we just call onRemoveTracks.
    // If we want a local confirm, we can do it, but App.tsx handles it.
    // Wait, App.tsx has a ConfirmDialog for `tracksToRemove`.
    // So if we call `onRemoveTracks`, it sets state and shows dialog.
    // So we DON'T need `confirm()` here.

    if (onRemoveTracks) {
      onRemoveTracks(Array.from(selectedTrackIds));
      // We should clear selection? Maybe after confirmation?
      // App.tsx doesn't callback on cancel.
      // But if we don't clear, and user delete, selection remains?
      // Let's clear selection immediately as "optimistic" UI action of "initiating delete".
      // Or wait. VS Code keeps selection if you cancel?
      // If App.tsx dialog cancels, we don't know.
      // Better to NOT clear selection here. Let user clear it or auto-clear on items removal (which happens via props check).
    } else {
      // Fallback for logic without onRemoveTracks
      if (!confirm(confirmMessage)) return;
      Array.from(selectedTrackIds).forEach(trackId => {
        onRemoveTrack(trackId);
      });
      setSelectedTrackIds(new Set());
      setTrackSelectionAnchorId(null);
    }
  }, [selectedTrackIds, onRemoveTrack, onRemoveTracks]);

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
      const descendants = folderDescendantsMap.get(String(folderId)) || new Set<string>();
      const idsToRemove = new Set<string>([String(folderId), ...Array.from(descendants)]);

      setFolders((prev) => prev.filter((f) => !idsToRemove.has(String(f.id))));
      setFolderTracks((prev) => {
        const next = { ...prev };
        idsToRemove.forEach((id) => {
          delete next[id];
        });
        return next;
      });
      setExpandedFolderIds((prev) => prev.filter((id) => !idsToRemove.has(String(id))));

      setSelectedFolderIds((prev) => {
        const next = new Set(prev);
        idsToRemove.forEach((id) => next.delete(id));
        return next;
      });

      if (selectedFolderId && idsToRemove.has(String(selectedFolderId))) {
        setSelectedFolderId(null);
      }
      if (activeTrackFolderId && idsToRemove.has(String(activeTrackFolderId))) {
        setActiveTrackFolderId(null);
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

  const renderFolderNodes = useCallback(
    (parentId: string, depth: number): React.ReactNode => {
      const nodes = foldersByParentId.get(parentId) || [];
      return nodes.map((folder) => {
        const id = String(folder.id);
        const expanded = expandedFolderIds.includes(id);
        const tracksInFolder = folderTracks[id] || [];
        const trackCount = tracksInFolder.length;

        return (
          <motion.div
            key={id}
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
                  draggable
                  onDragStart={(e) => {
                    try {
                      const payload = getFolderDragPayload(id);
                      e.dataTransfer.setData('application/x-redio-folder', JSON.stringify(payload));
                      e.dataTransfer.effectAllowed = 'move';
                    } catch {
                      // ignore
                    }
                  }}
                  onPointerDown={(e) => {
                    const isSelected = selectedFolderId === id;
                    if (e.metaKey || e.ctrlKey || e.shiftKey || !isSelected) {
                      handleSelectExplorerItem({ kind: 'folder', id }, e as any);
                    }
                  }}
                  onClick={(e) => {
                    const isSelected = selectedFolderId === id;
                    if (isSelected && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
                      handleSelectExplorerItem({ kind: 'folder', id }, e as any);
                    }
                    toggleFolderExpanded(id);
                  }}
                  onDragEnter={() => setDragOverFolderId(id)}
                  onDragLeave={(e) => {
                    const next = e.relatedTarget as Node | null;
                    if (!next || !e.currentTarget.contains(next)) setDragOverFolderId(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    void handleDropOnFolder(id, e);
                  }}
                  style={{ paddingLeft: `${8 + depth * 16}px` }}
                  className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-left transition-all duration-200 ease-out hover:shadow-md border border-transparent ${selectedFolderId === id
                    ? 'bg-sky-200 text-sky-950 dark:bg-sky-700/70 dark:text-white shadow-sm border border-sky-300/50 dark:border-sky-600/50'
                    : dragOverFolderId === id
                      ? 'bg-sky-100 dark:bg-sky-800/50 text-foreground shadow-sm border border-sky-200/50 dark:border-sky-700/30'
                      : 'bg-transparent hover:bg-sky-200/55 text-foreground dark:hover:bg-sky-700/35 dark:text-foreground hover:border-sky-300/35 dark:hover:border-sky-500/25 border border-transparent hover:shadow-sm'
                    }`}
                >
                  {expanded ? (
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  )}
                  <Folder className="w-4 h-4 text-muted-foreground" />
                  <span
                    className={
                      depth === 0
                        ? 'flex-1 truncate font-semibold text-sm select-text'
                        : 'flex-1 truncate text-sm select-text'
                    }
                  >
                    {folder.name}
                  </span>
                  {trackCount > 0 && (
                    <span className="text-[10px] text-muted-foreground select-text">
                      {trackCount} track{trackCount === 1 ? '' : 's'}
                    </span>
                  )}
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => handleOpenNewSubfolderDialog(id)}>New Subfolder</ContextMenuItem>
                <ContextMenuItem
                  onClick={() => {
                    setPendingFolderForUpload(id);
                    fileInputRef.current?.click();
                  }}
                >
                  Add Files
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleRenameFolder(folder)}>Rename Folder</ContextMenuItem>
                <ContextMenuItem onClick={() => handleDeleteFolder(id)} className="text-destructive">
                  Delete Folder
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>

            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div
                  key={`${id}-expanded`}
                  initial={reduceMotion || !hasMounted ? false : { opacity: 0, height: 0, scale: 0.98 }}
                  animate={reduceMotion || !hasMounted ? undefined : { opacity: 1, height: 'auto', scale: 1 }}
                  exit={reduceMotion || !hasMounted ? undefined : { opacity: 0, height: 0, scale: 0.98 }}
                  transition={reduceMotion ? undefined : { duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="space-y-0.5 overflow-hidden origin-top"
                >
                  {renderFolderNodes(id, depth + 1)}

                  <div style={{ marginLeft: `${(depth + 1) * 16}px` }} className="pt-1">
                    {folderLoadingIds.has(id) ? (
                      <div className="text-[11px] text-muted-foreground/80 pl-5 py-0.5">Loading…</div>
                    ) : tracksInFolder.length === 0 ? (
                      <div className="text-[11px] text-muted-foreground/80 pl-5 py-0.5">No tracks in this folder</div>
                    ) : (
                      <VirtualizedFolderTrackList
                        tracks={tracksInFolder}
                        folderId={id}
                        selectedTrackIds={activeTrackFolderId === id ? selectedTrackIds : new Set()}
                        recentlyMovedTrackIds={recentlyMovedFolderId === id ? recentlyMovedTrackIds : undefined}
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
      });
    },
    [
      activeTrackFolderId,
      expandedFolderIds,
      folderLoadingIds,
      folderTracks,
      foldersByParentId,
      getFolderDragPayload,
      getTrackDragPayload,
      handleDropOnFolder,
      handleRemoveFolderTrack,
      handleRenameFolder,
      handleSelectExplorerItem,
      handleSelectFolderTrack,
      handleDeleteFolder,
      handleOpenNewSubfolderDialog,
      hasMounted,
      onAddToPlaylist,
      onAddToQueue,
      playlists,
      recentlyMovedFolderId,
      recentlyMovedTrackIds,
      reduceMotion,
      selectedFolderId,
      selectedTrackIds,
      toggleFolderExpanded,
    ]
  );

  const handleExplorerKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      // Select All (Cmd+A / Ctrl+A)
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        const allFolders = new Set<string>();
        const allTracks = new Set<string>();
        visibleExplorerItems.forEach(it => {
          if (it.kind === 'folder') allFolders.add(it.id);
          else allTracks.add(it.id);
        });
        setSelectedFolderIds(allFolders);
        setSelectedTrackIds(allTracks);
        return;
      }

      // Deletion
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // If we have mixed selection, we might want to prompt or handle carefully
        // Currently we have explicit 'handleDeleteSelectedTracks'
        if (selectedTrackIds.size > 0 && selectedFolderIds.size === 0) {
          e.preventDefault();
          void handleDeleteSelectedTracks();
        } else if (selectedFolderIds.size > 0) {
          // Folder deletion usually requires explicit confirm per folder or batch
          // For safety, let's just toast if multiple folders selected, or handle single
          if (selectedFolderIds.size === 1) {
            e.preventDefault();
            void handleDeleteFolder(Array.from(selectedFolderIds)[0]);
          } else {
            toast.error("Batch folder deletion not supported yet.");
          }
        }
        return;
      }

      if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Enter', 'Home', 'End'].includes(e.key)) return;
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

      e.preventDefault();

      // Navigation Logic
      if (e.key === 'Home') {
        focusExplorerItem(visibleExplorerItems[0]);
        return;
      }

      if (e.key === 'End') {
        focusExplorerItem(visibleExplorerItems[visibleExplorerItems.length - 1]);
        return;
      }

      if (e.key === 'Enter') {
        if (focusedExplorerItem?.kind === 'folder') {
          void toggleFolderExpanded(focusedExplorerItem.id);
        } else if (focusedExplorerItem?.kind === 'track') {
          // Find track object
          const tId = focusedExplorerItem.id;
          const tFolderId = focusedExplorerItem.folderId;
          const track = folderTracks[tFolderId]?.find(t => t.id === tId);
          if (track) {
            onAddToQueue(track);
          }
        }
        return;
      }

      if (e.key === 'ArrowRight') {
        if (focusedExplorerItem?.kind === 'folder') {
          if (!expandedFolderIds.includes(focusedExplorerItem.id)) {
            void toggleFolderExpanded(focusedExplorerItem.id);
          } else {
            // Format: if expanded, move to first child if exists
            const nextIndex = currentIndex + 1;
            if (nextIndex < visibleExplorerItems.length) {
              focusExplorerItem(visibleExplorerItems[nextIndex]);
            }
          }
        }
        return;
      }

      if (e.key === 'ArrowLeft') {
        if (focusedExplorerItem?.kind === 'folder') {
          if (expandedFolderIds.includes(focusedExplorerItem.id)) {
            void toggleFolderExpanded(focusedExplorerItem.id);
          } else {
            // Move to parent? Current flattening doesn't easily show parent index, 
            // but we can assume parent is above.
            // For now, simpler behavior: Collapse if expanded, otherwise stay.
          }
        } else if (focusedExplorerItem?.kind === 'track') {
          // Move to parent folder
          const pFolderId = focusedExplorerItem.folderId;
          const pIndex = visibleExplorerItems.findIndex(it => it.kind === 'folder' && it.id === pFolderId);
          if (pIndex !== -1) {
            focusExplorerItem(visibleExplorerItems[pIndex]);
          }
        }
        return;
      }

      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const base = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = Math.min(visibleExplorerItems.length - 1, Math.max(0, base + dir));
      const nextItem = visibleExplorerItems[nextIndex];

      focusExplorerItem(nextItem);

      // Shift+Arrow selection extension
      if (e.shiftKey) {
        // If moving selection, we need to update selected set based on anchor
        // Reuse handleSelectExplorerItem logic?
        // It's tricky to emulate "click". 
        // Let's manually trigger selection update
        const anchorId = focusedExplorerItem?.kind === 'folder' ? folderSelectionAnchorId : trackSelectionAnchorId;
        // Simple improvement: Just select the item we moved to if Shift not held? 
        // Actually VS Code moves toggle with key.
      } else {
        // If no modifier, Arrow key moves SELECTION too (not just focus)
        // focusExplorerItem handles selection set update implicitly!
      }
    },
    [focusExplorerItem, focusedExplorerItem, toggleFolderExpanded, visibleExplorerItems, selectedTrackIds, selectedFolderIds, folderTracks]
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

  const commonDragStart = (e: DragEvent, type: 'track' | 'folder', count: number) => {
    if (dragGhostRef.current) {
      setDragGhostCount(count);
      // Clone for drag image
      const ghost = dragGhostRef.current.cloneNode(true) as HTMLElement;
      ghost.style.position = 'absolute';
      ghost.style.top = '-1000px';
      ghost.innerText = `${count} items`;
      ghost.style.backgroundColor = '#0ea5e9'; // sky-500
      ghost.style.color = 'white';
      ghost.style.padding = '4px 8px';
      ghost.style.borderRadius = '4px';
      ghost.style.fontSize = '12px';
      ghost.style.fontWeight = 'bold';
      ghost.style.display = 'block';
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 0, 0);
      setTimeout(() => document.body.removeChild(ghost), 0);
    }
  };



  // ... rest of the component

  return (
    <div className="h-full flex flex-col bg-background border-r border-border relative">
      <div ref={dragGhostRef} className="hidden absolute top-0 left-0 bg-sky-500 text-white px-2 py-1 rounded text-xs font-bold pointer-events-none z-50">
        {dragGhostCount} items
      </div>
      {/* Library Header */}
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Library</h2>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 p-0"
              onClick={handleOpenNewFolderDialog}
              title="New Folder"
            >
              <FolderPlus className="w-5 h-5" />
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

            <input
              ref={folderInputRef}
              type="file"
              multiple
              accept=".mp3,.wav,.ogg,.m4a,.flac"
              className="hidden"
              onChange={async (e) => {
                const files = e.target.files ? Array.from(e.target.files) : [];
                if (files.length > 0 && onImportFolder) {
                  await onImportFolder(files, selectedFolderId || undefined);
                }
                e.target.value = '';
              }}
              {...({ webkitdirectory: true } as any)}
            />
          </div>
        </div>

        {importProgress && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="truncate pr-3">{importProgress.label}</span>
              <span>{Math.round(importProgress.percent)}%</span>
            </div>
            <Progress value={importProgress.percent} />
          </div>
        )}

        {/* Multi-select toolbar */}
        {selectedTrackIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-center justify-between px-2.5 py-2 bg-muted/40 border border-border rounded-md"
          >
            <span className="text-[12px] font-medium text-foreground flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-primary rounded-full"></span>
              {selectedTrackIds.size} selected
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDeleteSelectedTracks}
                className="h-7 px-2 text-[11px] font-medium"
              >
                Delete Selected
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSelectedTrackIds(new Set());
                  setTrackSelectionAnchorId(null);
                }}
                className="h-7 px-2 text-[11px] font-medium"
              >
                Clear
              </Button>
            </div>
          </motion.div>
        )}
      </div>

      {/* Search and sort controls removed per request; Library now shows a simple folder tree without filters. */}

      {/* Folder List (VS Code style) */}
      {folders.length > 0 && (
        <div
          className={`flex-1 overflow-y-auto px-2 py-2 space-y-1 border-t border-border scroll-thin outline-none transition-colors duration-200 ${dragOverFolderId === 'root' ? 'bg-sky-50/50 dark:bg-sky-900/10' : ''
            }`}
          tabIndex={0}
          onKeyDown={handleExplorerKeyDown}
          onDragOver={(e) => {
            e.preventDefault();
            if (!dragOverFolderId) setDragOverFolderId('root');
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDragOverFolderId(null);
          }}
          onDrop={(e) => {
            void handleDropOnFolder(null, e);
          }}
        >
          <AnimatePresence mode="popLayout">
            {renderFolderNodes('', 0)}
          </AnimatePresence>
        </div>
      )}

      {/* New/Rename Folder Modal (custom, non-Radix to avoid focus issues) */}
      <AnimatePresence>
        {folderDialogOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => {
              closeFolderDialog();
            }}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={reduceMotion ? undefined : { opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={reduceMotion ? undefined : { duration: 0.2, ease: 'easeOut' }}
          >
            <motion.div
              className="w-full max-w-lg rounded-xl border border-border/60 bg-background text-foreground shadow-2xl p-6"
              onClick={(e) => e.stopPropagation()}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.96, y: 8 }}
              animate={reduceMotion ? undefined : { opacity: 1, scale: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 0.96, y: 8 }}
              transition={reduceMotion ? undefined : { duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
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
                    className="bg-white text-slate-900 placeholder:text-slate-500 border-slate-300 focus-visible:ring-primary/30 focus-visible:border-primary dark:bg-input/40 dark:text-foreground dark:placeholder:text-muted-foreground/80 dark:border-input transition-all duration-200 focus:scale-[1.02]"
                  />
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={closeFolderDialog}
                    className="transition-all duration-200 hover:scale-105 active:scale-95"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    type="submit"
                    className="transition-all duration-200 hover:scale-105 active:scale-95"
                  >
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