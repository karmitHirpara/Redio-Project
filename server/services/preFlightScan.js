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

    // Standardize to forward slashes for prefix checking
    const standardized = p.replace(/\\/g, '/');

    if (standardized.startsWith('/uploads/')) {
        const rel = standardized.slice(9);
        return path.normalize(path.join(uploadsRootDir, rel));
    }

    if (standardized.startsWith('uploads/')) {
        const rel = standardized.slice(8);
        return path.normalize(path.join(uploadsRootDir, rel));
    }

    if (path.isAbsolute(p)) {
        return path.normalize(p);
    }

    // Fallback: join directly if no prefix matched but it's relative
    return path.normalize(path.join(uploadsRootDir, p));
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
        logger.info('[Sync] Starting startup pre-flight scan...');
        const tracks = await query('SELECT id, file_path FROM tracks');
        if (tracks.length === 0) {
            logger.info('[Sync] No tracks in database. Skipping scan.');
            return { availableCount: 0, unavailableCount: 0 };
        }

        let unavailableCount = 0;
        let availableCount = 0;

        await run('BEGIN IMMEDIATE TRANSACTION');
        try {
            for (const track of tracks) {
                if (!track.file_path) continue;

                const absolutePath = resolveTrackAbsolutePath(track.file_path, uploadsDir);
                const exists = absolutePath && fs.existsSync(absolutePath);

                await run('UPDATE tracks SET exists_on_disk = ? WHERE id = ?', [exists ? 1 : 0, track.id]);
                
                if (exists) {
                    availableCount++;
                } else {
                    unavailableCount++;
                    const fileName = absolutePath ? path.basename(absolutePath) : 'Unknown';
                    logger.warn(`[Sync] Audio file missing: ${fileName} (${track.id})`);
                }
            }
            await run('COMMIT');
        } catch (dbErr) {
            await run('ROLLBACK');
            throw dbErr;
        }

        logger.info(`[Sync] Pre-flight scan complete. Available: ${availableCount}, Missing: ${unavailableCount}`);
        return { availableCount, unavailableCount };
    } catch (err) {
        logger.error('[Sync] Error during startup scan:', err);
        return { error: err.message };
    }
}
