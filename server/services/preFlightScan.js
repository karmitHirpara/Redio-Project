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

    if (p.startsWith('/uploads/')) {
        const rel = p.slice(9); // remove '/uploads/'
        // The slash in '/uploads/playlists' might be duplicated if uploadsRootDir already ends with slash
        const resolved = path.join(uploadsRootDir, rel);
        // console.log(`[resolveTrackAbsolutePath DEBUG] input: "${p}"`);
        // console.log(`[resolveTrackAbsolutePath DEBUG] rel: "${rel}"`);
        // console.log(`[resolveTrackAbsolutePath DEBUG] uploadsRootDir: "${uploadsRootDir}"`);
        // console.log(`[resolveTrackAbsolutePath DEBUG] resolved: "${resolved}"`);
        return resolved;
    }

    // /uploads_queue is not under uploadsRootDir; we cannot resolve reliably here.
    if (p.startsWith('/uploads_queue/')) {
        return null;
    }

    return path.join(uploadsRootDir, p);
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
 * 1. Removes any tracks from the DB where the physical file is missing.
 */
export async function runStartupSync(uploadsDir) {
    try {
        logger.info('[Sync] Starting startup pre-flight scan...');
        const tracks = await query('SELECT id, file_path FROM tracks');
        let removedCount = 0;

        const allowDelete = process.env.PREFLIGHT_DELETE_ORPHANS === '1';

        for (const track of tracks) {
            if (!track.file_path) continue;

            const absolutePath = resolveTrackAbsolutePath(track.file_path, uploadsDir);
            if (!absolutePath) {
                continue;
            }

            if (!fs.existsSync(absolutePath)) {
                const baseName = path.basename(absolutePath);
                if (allowDelete) {
                    console.log(`[Sync] Orphaned DB record found for missing file: ${baseName}. Removing track...`);
                    await run('DELETE FROM tracks WHERE id = ?', [track.id]);
                    removedCount++;
                } else {
                    console.log(`[Sync] Missing file on disk (not deleting): ${baseName}`);
                }
            }
        }

        logger.info(`[Sync] Pre-flight scan complete. Removed ${removedCount} orphaned track records.`);
        return { removedCount };
    } catch (err) {
        console.error('[Sync] Error during startup scan:', err);
        return { removedCount: 0, error: err.message };
    }
}
