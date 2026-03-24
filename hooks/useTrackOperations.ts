import { useCallback } from 'react';
import { toast } from 'sonner';
import { Track } from '../types'; // Assuming types exist or will be extracted
import { apiClient, foldersAPI } from '../services/api';

const ALLOWED_UPLOAD_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
    'audio/ogg', 'audio/flac', 'audio/x-flac', 'audio/mp4',
    'audio/aac', 'video/mp4', 'application/ogg',
]);

const BATCH_SIZE = 4;

export const useTrackOperations = (
    setTracks: React.Dispatch<React.SetStateAction<Track[]>>,
    setLibraryImportProgress: React.Dispatch<React.SetStateAction<{ percent: number; label: string } | null>>,
    resolveUploadsUrl: (path: string) => string,
    hydrateTrackDurationInLibrary: (id: string, path: string) => void
) => {
    const isValidUploadFile = useCallback((file: File) => {
        if (!file) return { ok: false as const, reason: 'Invalid file' };
        const lower = String(file.name || '').toLowerCase();
        const dot = lower.lastIndexOf('.');
        const ext = dot >= 0 ? lower.slice(dot) : '';
        if (!ext || !ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
            return { ok: false as const, reason: 'Invalid file type' };
        }
        const mime = String((file as any).type || '').toLowerCase();
        if (mime && !mime.startsWith('audio/') && !ALLOWED_UPLOAD_MIME_TYPES.has(mime)) {
            return { ok: false as const, reason: 'Invalid file type' };
        }
        return { ok: true as const, reason: '' };
    }, []);

    const getFolderPathParts = useCallback((file: File): string[] => {
        const rel = String((file as any).webkitRelativePath || '');
        if (!rel) return [];
        const parts = rel.split('/').filter(Boolean);
        if (parts.length <= 1) return [];
        return parts.slice(0, -1);
    }, []);

    const handleImportTracks = useCallback(async (files: File[], folderId?: string) => {
        let imported = 0;
        let failed = 0;
        const importedItems: { trackId: string; fileName?: string }[] = [];
        const fileQueue = [...files];
        const UI_BATCH_SIZE = 10; // Batch up to 10 files per request

        while (fileQueue.length > 0) {
            const batchFiles = fileQueue.splice(0, UI_BATCH_SIZE);
            const formData = new FormData();
            batchFiles.forEach(f => formData.append('file', f));

            try {
                const response = await apiClient.request<any>('/tracks/upload', {
                    method: 'POST',
                    body: formData,
                    allowedStatuses: [207, 409],
                });

                const results = response.results || [];
                const errors = response.errors || [];

                for (const resItem of results) {
                    if (resItem.id) {
                        const mapped: Track = {
                            id: resItem.id,
                            name: resItem.name,
                            artist: resItem.artist,
                            duration: resItem.duration || 0,
                            size: resItem.size,
                            filePath: resolveUploadsUrl(resItem.filePath || resItem.file_path),
                            hash: resItem.hash,
                            dateAdded: resItem.date_added ? new Date(resItem.date_added) : new Date(),
                        };
                        setTracks((prev) => {
                           if (prev.some(t => t.id === mapped.id)) return prev;
                           return [mapped, ...prev];
                        });
                        importedItems.push({ trackId: mapped.id, fileName: mapped.name });
                        imported += 1;
                        if ((!resItem.duration || resItem.duration === 0) && mapped.filePath) {
                            hydrateTrackDurationInLibrary(mapped.id, mapped.filePath);
                        }
                    } else if (resItem.error === 'Duplicate file' && resItem.existingTrack) {
                        importedItems.push({ trackId: String(resItem.existingTrack.id), fileName: resItem.existingTrack.name });
                        imported += 1;
                    }
                }
                failed += errors.length;
            } catch (err) {
                console.error('Failed to import tracks batch', err);
                failed += batchFiles.length;
            }
        }

        if (folderId && importedItems.length > 0) {
            try {
                await foldersAPI.attachTracks(folderId, importedItems);
            } catch (err) {
                console.error('Failed to attach tracks to folder', err);
            }
            window.dispatchEvent(new Event('redio:library-resync'));
        }

        if (imported > 0 || failed > 0) {
            toast.success('Import complete', {
                description: `${imported} imported, ${failed} failed`,
            });
        }
    }, [isValidUploadFile, resolveUploadsUrl, setTracks, hydrateTrackDurationInLibrary]);

    const handleImportFolder = useCallback(async (files: File[], parentFolderId?: string) => {
        if (!parentFolderId) {
            toast.error('Select a folder first, then import a folder into that folder.');
            return;
        }

        const supported = (files || []).filter((f) => isValidUploadFile(f).ok);
        if (supported.length === 0) {
            toast.error('No supported audio files found in that folder');
            return;
        }

        setLibraryImportProgress({ percent: 0, label: 'Preparing folder import…' });

        const pathToFolderId = new Map<string, string>();
        const getOrCreateFolderIdForPath = async (parts: string[]): Promise<string> => {
            const key = parts.join('/');
            if (!key) return parentFolderId;
            const cached = pathToFolderId.get(key);
            if (cached) return cached;
            const parentParts = parts.slice(0, -1);
            const leaf = parts[parts.length - 1];
            const parentId = parentParts.length ? await getOrCreateFolderIdForPath(parentParts) : parentFolderId;
            const created = await foldersAPI.create(leaf, parentId);
            pathToFolderId.set(key, created.id);
            return created.id;
        };

        const groups = new Map<string, File[]>();
        for (const f of supported) {
            const parts = getFolderPathParts(f);
            const key = parts.join('/');
            const arr = groups.get(key) || [];
            arr.push(f);
            groups.set(key, arr);
        }

        const total = supported.length;
        let processed = 0;
        let failed = 0;

        const yieldToBrowser = async () => {
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        };

        const UI_BATCH_SIZE = 10;
        for (const [pathKey, groupFiles] of groups.entries()) {
            const parts = pathKey ? pathKey.split('/').filter(Boolean) : [];
            const folderId = await getOrCreateFolderIdForPath(parts);
            const itemsToAttach: { trackId: string; fileName?: string }[] = [];

            const fileQueue = [...groupFiles];
            while (fileQueue.length > 0) {
                const batchFiles = fileQueue.splice(0, UI_BATCH_SIZE);
                const formData = new FormData();
                batchFiles.forEach(f => formData.append('file', f));

                try {
                    const response = await apiClient.request<any>('/tracks/upload', {
                        method: 'POST',
                        body: formData,
                        allowedStatuses: [207, 409],
                    });

                    const results = response.results || [];
                    const errors = response.errors || [];

                    for (const resItem of results) {
                        if (resItem.id) {
                             const mapped: Track = {
                                id: resItem.id,
                                name: resItem.name,
                                artist: resItem.artist,
                                duration: resItem.duration || 0,
                                size: resItem.size,
                                filePath: resolveUploadsUrl(resItem.filePath || resItem.file_path),
                                hash: resItem.hash,
                                dateAdded: resItem.date_added ? new Date(resItem.date_added) : new Date(),
                            };
                            setTracks((prev) => {
                                if (prev.some(t => t.id === mapped.id)) return prev;
                                return [mapped, ...prev];
                            });
                            itemsToAttach.push({ trackId: mapped.id, fileName: mapped.name });
                            if ((!resItem.duration || resItem.duration === 0) && mapped.filePath) {
                                hydrateTrackDurationInLibrary(mapped.id, mapped.filePath);
                            }
                        } else if (resItem.error === 'Duplicate file' && resItem.existingTrack) {
                            itemsToAttach.push({ trackId: String(resItem.existingTrack.id), fileName: resItem.existingTrack.name });
                        }
                        processed += 1;
                    }
                    failed += errors.length;
                    processed += errors.length;
                } catch (err) {
                    console.error('Failed to import folder batch', err);
                    failed += batchFiles.length;
                    processed += batchFiles.length;
                }

                setLibraryImportProgress({
                    percent: Math.min(100, (processed / total) * 100),
                    label: `Importing… ${processed}/${total}`,
                });
                await yieldToBrowser();
            }

            if (itemsToAttach.length > 0) {
                try {
                    await foldersAPI.attachTracks(folderId, itemsToAttach);
                } catch (err) {
                    console.error('Failed to attach imported tracks to folder', err);
                }
            }
        }

        setLibraryImportProgress(null);
        window.dispatchEvent(new Event('redio:library-resync'));
        if (failed > 0) {
            toast.error('Folder import finished with errors', { description: `${failed} failed` });
        } else {
            toast.success('Folder import complete');
        }
    }, [isValidUploadFile, getFolderPathParts, setLibraryImportProgress, setTracks, resolveUploadsUrl, hydrateTrackDurationInLibrary]);

    return {
        isValidUploadFile,
        getFolderPathParts,
        handleImportTracks,
        handleImportFolder,
    };
};
