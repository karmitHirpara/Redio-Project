import { get, query, run } from '../config/database.js';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import logger from './logger.js';

const execPromise = util.promisify(exec);

function resolveTrackAbsolutePath(rawFilePath, uploadsRootDir) {
    if (!rawFilePath || typeof rawFilePath !== 'string') return null;
    if (!uploadsRootDir || typeof uploadsRootDir !== 'string') return null;

    let p = rawFilePath.trim();
    if (!p) return null;

    // Convert accidental URLs to pathnames.
    if (/^https?:\/\//i.test(p) || /^file:\/\//i.test(p)) {
        try {
            const u = new URL(p);
            p = u.pathname || '';
        } catch {
            return null;
        }
    }

    if (path.isAbsolute(p)) return path.normalize(p);

    // Normalize uploadsRootDir to be absolute and without trailing slash/relative parts
    const normalizedRoot = path.resolve(uploadsRootDir);

    if (p.startsWith('/uploads/')) {
        const rel = p.slice(9); // remove '/uploads/'
        return path.join(normalizedRoot, rel);
    }

    if (p.startsWith('uploads/')) {
        const rel = p.slice(8);
        return path.join(normalizedRoot, rel);
    }

    return path.join(normalizedRoot, p);
}

/**
 * Validates a track's physical and logical integrity.
 * Checks: 
 * 1. Database record exists
 * 2. File exists on disk
 * 3. Duration is non-zero
 * 4. File is decodable (FFmpeg probe)
 */
export async function validateTrack(trackId) {
    try {
        const track = await get('SELECT * FROM tracks WHERE id = ?', [trackId]);
        if (!track) {
            return { ok: false, error: 'Track not found in database' };
        }

        if (!track.file_path && !track.filePath) {
            return { ok: false, error: 'No file path defined for track' };
        }

        const filePath = track.filePath || track.file_path;

        const rawUploadPath = process.env.UPLOAD_PATH || 'uploads';
        // When running via 'npm run dev' from workspace root, process.cwd() is the root.
        // The server files and 'uploads' folder are inside the 'server/' directory.
        const uploadsDir = path.isAbsolute(rawUploadPath)
            ? rawUploadPath
            : path.join(process.cwd(), 'server', rawUploadPath);
        const normalizedUploadsDir = path.normalize(uploadsDir);

        const absolutePath = resolveTrackAbsolutePath(filePath, normalizedUploadsDir);

        if (!absolutePath) {
            return { ok: false, error: `Invalid file path: ${filePath}` };
        }

        // 1. Check physical existence
        if (!fs.existsSync(absolutePath)) {
            return { ok: false, error: `File missing on disk: ${filePath}` };
        }

        // 2. Check metadata
        if (!track.duration || track.duration <= 0) {
            return { ok: false, error: 'Track has invalid or zero duration' };
        }

        // 3. Quick FFmpeg probe (decodability check)
        // We only check the first 0.5s to keep it fast
        try {
            await execPromise(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${absolutePath}"`);
        } catch (ffErr) {
            return { ok: false, error: `Codec/Header integrity failure: ${ffErr.message}` };
        }

        return { ok: true };
    } catch (err) {
        return { ok: false, error: `Validation system error: ${err.message}` };
    }
}

/**
 * Synchronizes the database with the file system on startup.
 * Updates 'exists_on_disk' flag for all tracks.
 */
export async function runStartupScan(uploadsDir) {
    try {
        const normalizedUploadsDir = path.resolve(uploadsDir);
        logger.info(`[Sync] Starting startup pre-flight scan using: ${normalizedUploadsDir}`);
        
        const tracks = await query('SELECT id, file_path, name FROM tracks');
        let unavailableCount = 0;
        let availableCount = 0;

        for (const track of tracks) {
            if (!track.file_path) continue;

            const absolutePath = resolveTrackAbsolutePath(track.file_path, normalizedUploadsDir);
            const exists = absolutePath && fs.existsSync(absolutePath);

            if (exists) {
                availableCount++;
                // If it was marked as missing, mark it available now
                await run('UPDATE tracks SET exists_on_disk = 1 WHERE id = ?', [track.id]);
            } else {
                unavailableCount++;
                await run('UPDATE tracks SET exists_on_disk = 0 WHERE id = ?', [track.id]);
                const baseName = track.name || (absolutePath ? path.basename(absolutePath) : 'Unknown');
                logger.warn(`[Sync] Audio file missing for track: ${baseName} (ID: ${track.id}) - Path: ${absolutePath}`);
            }
        }

        logger.info(`[Sync] Pre-flight scan complete. Available: ${availableCount}, Missing: ${unavailableCount}`);
        return { availableCount, unavailableCount };
    } catch (err) {
        logger.error('[Sync] Error during startup scan:', err);
        return { error: err.message };
    }
}
