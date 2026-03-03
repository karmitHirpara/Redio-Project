import { get } from '../config/database.js';
import fs from 'fs';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

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

        // 1. Check physical existence
        if (!fs.existsSync(filePath)) {
            return { ok: false, error: `File missing on disk: ${filePath}` };
        }

        // 2. Check metadata
        if (!track.duration || track.duration <= 0) {
            return { ok: false, error: 'Track has invalid or zero duration' };
        }

        // 3. Quick FFmpeg probe (decodability check)
        // We only check the first 0.5s to keep it fast
        try {
            await execPromise(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`);
        } catch (ffErr) {
            return { ok: false, error: `Codec/Header integrity failure: ${ffErr.message}` };
        }

        return { ok: true };
    } catch (err) {
        return { ok: false, error: `Validation system error: ${err.message}` };
    }
}
