import { useCallback } from 'react';
import { toast } from 'sonner';
import { Track, Playlist } from '../types';
import { playlistsAPI } from '../services/api';

export const usePlaylistOperations = (
    playlists: Playlist[],
    setPlaylists: React.Dispatch<React.SetStateAction<Playlist[]>>,
    setTracks: React.Dispatch<React.SetStateAction<Track[]>>,
    normalizeServerTrack: (t: any) => Track,
    setPlaylistNameDialog: (dialog: any) => void,
    setDeletePlaylistConfirm: (confirm: any) => void
) => {
    const handleCreatePlaylist = useCallback(async () => {
        setPlaylistNameDialog({ mode: 'create', name: '' });
    }, [setPlaylistNameDialog]);

    const handleRenamePlaylist = useCallback(async (playlistId: string) => {
        const playlist = playlists.find((p) => p.id === playlistId);
        if (!playlist) return;
        setPlaylistNameDialog({ mode: 'rename', playlistId, name: playlist.name });
    }, [playlists, setPlaylistNameDialog]);

    const handleDeletePlaylist = useCallback(async (playlistId: string) => {
        try {
            const playlist = playlists.find((p) => p.id === playlistId);
            if (!playlist) return;

            const preview = await playlistsAPI.deletePreview(playlistId);
            const requires = Boolean(preview?.requiresConfirmation);
            const trackCount = Number(preview?.trackCount || 0);
            const mediaCount = Number(preview?.mediaCount || 0);
            const scheduledCount = Number(preview?.scheduledCount || 0);

            if (requires) {
                setDeletePlaylistConfirm({
                    playlistId,
                    name: playlist.name,
                    trackCount,
                    mediaCount,
                    scheduledCount,
                });
                return;
            }

            await playlistsAPI.deleteRecursive(playlistId, false);
            setPlaylists((prev) => prev.filter((p) => p.id !== playlistId));
        } catch (err: any) {
            toast.error(err?.message || 'Failed to delete playlist');
        }
    }, [playlists, setPlaylists, setDeletePlaylistConfirm]);

    const confirmDeletePlaylist = useCallback(async (pending: { playlistId: string }) => {
        try {
            await playlistsAPI.deleteRecursive(pending.playlistId, true);
            setPlaylists((prev) => prev.filter((p) => p.id !== pending.playlistId));
            setDeletePlaylistConfirm(null);
        } catch (err: any) {
            toast.error(err?.message || 'Failed to delete playlist');
        }
    }, [setPlaylists, setDeletePlaylistConfirm]);

    const handleToggleLockPlaylist = useCallback(async (playlistId: string) => {
        const playlist = playlists.find((p) => p.id === playlistId);
        if (!playlist) return;
        const locked = !playlist.locked;
        try {
            await playlistsAPI.update(playlistId, { locked });
            setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? { ...p, locked } : p)));
        } catch (err: any) {
            toast.error(err?.message || 'Failed to update playlist');
        }
    }, [playlists, setPlaylists]);

    const setPlaylistLocked = useCallback(async (playlistId: string, locked: boolean): Promise<boolean> => {
        const prev = playlists;
        setPlaylists((p) => p.map((x) => (x.id === playlistId ? { ...x, locked } : x)));
        try {
            await playlistsAPI.update(playlistId, { locked });
            return true;
        } catch (_err) {
            setPlaylists(prev);
            return false;
        }
    }, [playlists, setPlaylists]);

    const handleDuplicatePlaylist = useCallback(async (playlistId: string) => {
        const playlist = playlists.find((p) => p.id === playlistId);
        if (!playlist) return;
        try {
            const created = await playlistsAPI.create(`${playlist.name} Copy`);
            const trackIds = (playlist.tracks || []).map((t) => t.id);
            if (trackIds.length > 0) {
                await playlistsAPI.addTracks(created.id, trackIds);
            }
            const fetched = await playlistsAPI.getById(created.id);
            const fetchedTracks: Track[] = (fetched?.tracks || []).map((t: any) => normalizeServerTrack(t));
            const duration = fetchedTracks.reduce((sum, t) => sum + (t.duration || 0), 0);
            setPlaylists((prev) => [...prev, { ...(fetched as any), tracks: fetchedTracks, duration } as any]);

            setTracks((prev) => {
                const byId = new Map(prev.map((t) => [t.id, t] as const));
                for (const t of fetchedTracks) byId.set(t.id, t);
                return Array.from(byId.values());
            });
        } catch (err: any) {
            toast.error(err?.message || 'Failed to duplicate playlist');
        }
    }, [playlists, setPlaylists, setTracks, normalizeServerTrack]);

    return {
        handleCreatePlaylist,
        handleRenamePlaylist,
        handleDeletePlaylist,
        confirmDeletePlaylist,
        handleToggleLockPlaylist,
        setPlaylistLocked,
        handleDuplicatePlaylist,
    };
};
