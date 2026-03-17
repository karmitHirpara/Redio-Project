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

        const processBatch = async () => {
            while (fileQueue.length > 0) {
                const file = fileQueue.shift();
                if (!file) break;

                const validation = isValidUploadFile(file);
                if (!validation.ok) {
                    failed += 1;
                    continue;
                }

                const formData = new FormData();
                formData.append('file', file);

                try {
                    const uploadData = await apiClient.request<any>('/tracks/upload', {
                        method: 'POST',
                        body: formData,
                        allowedStatuses: [409],
                    });

                    if (uploadData?.existingTrack) {
                        const existingTrack = uploadData.existingTrack;
                        if (existingTrack?.id) {
                            importedItems.push({ trackId: String(existingTrack.id), fileName: file.name });
                            imported += 1;
                        } else {
                            failed += 1;
                        }
                        continue;
                    }

                    if (!uploadData?.id) {
                        failed += 1;
                        continue;
                    }

                    const mapped: Track = {
                        id: uploadData.id,
                        name: uploadData.name,
                        artist: uploadData.artist,
                        duration: uploadData.duration || 0,
                        size: uploadData.size,
                        filePath: resolveUploadsUrl(uploadData.filePath || uploadData.file_path),
                        hash: uploadData.hash,
                        dateAdded: uploadData.date_added ? new Date(uploadData.date_added) : new Date(),
                    };
                    setTracks((prev) => [mapped, ...prev]);
                    importedItems.push({ trackId: mapped.id, fileName: file.name });
                    imported += 1;
                } catch (err) {
                    console.error('Failed to import track', err);
                    failed += 1;
                }
            }
        };

        const workers = [];
        for (let i = 0; i < Math.min(BATCH_SIZE, files.length); i++) {
            workers.push(processBatch());
        }
        await Promise.all(workers);

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
    }, [isValidUploadFile, resolveUploadsUrl, setTracks]);

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

        for (const [pathKey, groupFiles] of groups.entries()) {
            const parts = pathKey ? pathKey.split('/').filter(Boolean) : [];
            const folderId = await getOrCreateFolderIdForPath(parts);
            const itemsToAttach: { trackId: string; fileName?: string }[] = [];

            for (const file of groupFiles) {
                try {
                    const formData = new FormData();
                    formData.append('file', file);

                    const uploadData = await apiClient.request<any>('/tracks/upload', {
                        method: 'POST',
                        body: formData,
                        allowedStatuses: [409],
                    });

                    let newId: string | null = null;

                    if (uploadData?.existingTrack) {
                        const existingTrack = uploadData.existingTrack;
                        if (existingTrack?.id) {
                            newId = String(existingTrack.id);
                        }
                    } else if (uploadData?.id) {
                        const mapped: Track = {
                            id: uploadData.id,
                            name: uploadData.name,
                            artist: uploadData.artist,
                            duration: uploadData.duration || 0,
                            size: uploadData.size,
                            filePath: resolveUploadsUrl(uploadData.filePath || uploadData.file_path),
                            hash: uploadData.hash,
                            dateAdded: uploadData.date_added ? new Date(uploadData.date_added) : new Date(),
                        };
                        setTracks((prev) => [mapped, ...prev]);
                        newId = mapped.id;
                        if ((!uploadData.duration || uploadData.duration === 0) && mapped.filePath) {
                            hydrateTrackDurationInLibrary(mapped.id, mapped.filePath);
                        }
                    }

                    if (newId) itemsToAttach.push({ trackId: newId, fileName: file.name });
                } catch (err) {
                    console.error('Failed to import folder file', err);
                    failed += 1;
                } finally {
                    processed += 1;
                    setLibraryImportProgress({
                        percent: Math.min(100, (processed / total) * 100),
                        label: `Importing… ${processed}/${total}`,
                    });
                }

                if (processed % 10 === 0) {
                    await yieldToBrowser();
                }
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
