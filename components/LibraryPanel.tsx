import { useState, useRef, useEffect, useMemo } from 'react';
import { Folder, Plus, ChevronRight, ChevronDown } from 'lucide-react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Track, Playlist, LibraryFolder } from '../types';
import { TrackRow } from './TrackRow';
import { PlaylistFolder } from './PlaylistFolder';
import { motion } from 'motion/react';
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
  const [playlistSearch, setPlaylistSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>([]);
  const [folderTracks, setFolderTracks] = useState<Record<string, Track[]>>({});
  const [selectedFolderTrackId, setSelectedFolderTrackId] = useState<string | null>(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderNameInput, setFolderNameInput] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [pendingFolderForUpload, setPendingFolderForUpload] = useState<string | null>(null);

  // Load folders from backend
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/folders');
        if (!res.ok) return;
        const data = await res.json();
        setFolders(data);
      } catch (err) {
        console.error('Failed to load folders', err);
      }
    };
    load();
  }, []);

  // Keep expanded folder contents in sync when the global tracks list changes
  useEffect(() => {
    const refreshExpandedFolders = async () => {
      try {
        for (const folderId of expandedFolderIds) {
          const res = await fetch(`/api/folders/${folderId}/tracks`);
          if (!res.ok) continue;
          const raw = await res.json();
          const normalized: Track[] = (raw || []).map((t: any) => ({
            id: t.id,
            name: t.name,
            artist: t.artist,
            duration: t.duration || 0,
            size: t.size || 0,
            filePath: t.file_path,
            hash: t.hash,
            dateAdded: t.date_added ? new Date(t.date_added) : new Date(),
          }));
          setFolderTracks(prev => ({ ...prev, [folderId]: normalized }));
        }
      } catch (err) {
        console.error('Failed to refresh expanded folder tracks', err);
      }
    };

    if (expandedFolderIds.length > 0) {
      refreshExpandedFolders();
    }
  }, [tracks, expandedFolderIds]);

  const filteredPlaylists = useMemo(() => {
    return playlists.filter(playlist =>
      playlist.name.toLowerCase().includes(playlistSearch.toLowerCase())
    );
  }, [playlists, playlistSearch]);

  const handleOpenNewFolderDialog = () => {
    setEditingFolderId(null);
    setFolderNameInput('');
    setFolderDialogOpen(true);
  };

  const handleConfirmFolder = async () => {
    const trimmed = folderNameInput.trim();
    if (!trimmed) {
      setFolderDialogOpen(false);
      return;
    }

    try {
      if (editingFolderId) {
        const res = await fetch(`/api/folders/${editingFolderId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          alert(data?.error || 'Failed to rename folder');
          return;
        }
        const updated = await res.json();
        setFolders(prev => prev.map(f => (f.id === updated.id ? updated : f)));
      } else {
        const res = await fetch('/api/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          alert(data?.error || 'Failed to create folder');
          return;
        }
        const created = await res.json();
        setFolders(prev => [...prev, created]);
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
      const res = await fetch(`/api/folders/${folderId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error || 'Failed to delete folder');
        return;
      }
      setFolders(prev => prev.filter(f => f.id !== folderId));
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
    setExpandedFolderIds((prev) =>
      prev.includes(folderId) ? prev.filter(id => id !== folderId) : [...prev, folderId]
    );

    if (!folderTracks[folderId]) {
      try {
        const res = await fetch(`/api/folders/${folderId}/tracks`);
        if (!res.ok) return;
        const raw = await res.json();
        const normalized: Track[] = (raw || []).map((t: any) => ({
          id: t.id,
          name: t.name,
          artist: t.artist,
          duration: t.duration || 0,
          size: t.size || 0,
          filePath: t.file_path,
          hash: t.hash,
          dateAdded: t.date_added ? new Date(t.date_added) : new Date(),
        }));
        setFolderTracks(prev => ({ ...prev, [folderId]: normalized }));
      } catch (err) {
        console.error('Failed to load folder tracks', err);
      }
    }
  };

  return (
    <div className="h-full flex flex-col bg-background border-r border-border">
      {/* Library Header */}
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-foreground">Library</h2>
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
                  await onImportTracks(files, targetFolderId || undefined);

                  // If files were added to or for a folder, refresh its contents
                  if (targetFolderId) {
                    try {
                      const res = await fetch(`/api/folders/${targetFolderId}/tracks`);
                      if (res.ok) {
                        const raw = await res.json();
                        const normalized: Track[] = (raw || []).map((t: any) => ({
                          id: t.id,
                          name: t.name,
                          artist: t.artist,
                          duration: t.duration || 0,
                          size: t.size || 0,
                          filePath: t.file_path,
                          hash: t.hash,
                          dateAdded: t.date_added ? new Date(t.date_added) : new Date(),
                        }));
                        setFolderTracks(prev => ({ ...prev, [targetFolderId]: normalized }));
                      }
                    } catch (err) {
                      console.error('Failed to refresh folder tracks after upload', err);
                    }
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
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 border-t border-border scroll-thin">
        {folders.map(folder => {
          const expanded = expandedFolderIds.includes(folder.id);
          const tracksInFolder = folderTracks[folder.id] || [];
          const trackCount = tracksInFolder.length;
          return (
            <div key={folder.id} className="space-y-0.5">
              <ContextMenu>
                <ContextMenuTrigger>
                  <button
                    type="button"
                    onClick={() => toggleFolderExpanded(folder.id)}
                    className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs text-left transition-colors ${
                      selectedFolderId === folder.id
                        ? 'bg-accent/80 text-foreground'
                        : 'hover:bg-accent/40 text-foreground'
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

              {expanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22, ease: 'easeInOut' }}
                  className="ml-6 border-l border-border/40 pl-3 mt-1 space-y-0.5 overflow-hidden"
                >
                  {tracksInFolder.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground/80 pl-5 py-0.5">
                      No tracks in this folder
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {tracksInFolder.map((track) => (
                        <TrackRow
                          key={track.id}
                          track={track}
                          isLibrary
                          isSelected={selectedFolderTrackId === track.id}
                          onSelect={() => setSelectedFolderTrackId(track.id)}
                          onAddToQueue={onAddToQueue}
                          onAddToPlaylist={onAddToPlaylist}
                          playlists={playlists}
                          onRemove={async () => {
                            onRemoveTrack(track.id);
                          }}
                          showRemove
                        />
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          );
        })}
      </div>
    )}

      {/* New/Rename Folder Modal (custom, non-Radix to avoid focus issues) */}
      {folderDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => {
            setFolderDialogOpen(false);
            setEditingFolderId(null);
            setFolderNameInput('');
          }}
        >
          <div
            className="bg-background rounded-lg border shadow-lg p-4 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">
                {editingFolderId ? 'Rename Folder' : 'New Folder'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setFolderDialogOpen(false);
                  setEditingFolderId(null);
                  setFolderNameInput('');
                }}
                className="text-muted-foreground hover:text-foreground text-xs px-1"
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
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setFolderDialogOpen(false);
                  setEditingFolderId(null);
                  setFolderNameInput('');
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleConfirmFolder}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}