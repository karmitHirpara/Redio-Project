import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { query, run, get } from '../config/database.js';

export class TrackService {
    /**
     * Get all tracks with pagination and availability filtering
     */
    static async getAllTracks(limit = 0, offset = 0, onlyExisting = true) {
        let sql = `SELECT * FROM tracks WHERE file_path NOT LIKE '/uploads/playlists/%'`;
        const params = [];

        if (onlyExisting) {
            sql += ` AND exists_on_disk = 1`;
        }

        sql += ` ORDER BY date_added DESC`;

        if (limit > 0) {
            sql += ' LIMIT ? OFFSET ?';
            params.push(limit, offset);
        }
        return await query(sql, params);
    }

    /**
     * Create a real file copy of an existing track
     */
    static async copyTrack(sourceId, nameStrategy = 'suffix') {
        const existing = await this.getTrackById(sourceId);
        if (!existing) throw new Error('Source track not found');

        const originalName = existing.name || 'Track';
        let newName;

        if (nameStrategy === 'suffix') {
            if (/\(\d+\)\s*$/.test(originalName)) {
                newName = `${originalName} copy`;
            } else {
                const baseName = originalName;
                const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pattern = new RegExp(`^${escapedBase}(?: \\((\\d+)\\))?$`);

                const rows = await query('SELECT name FROM tracks WHERE name LIKE ?', [`${baseName}%`]);
                let maxIndex = 0;
                for (const row of rows) {
                    const name = row.name || '';
                    const match = name.match(pattern);
                    if (!match) continue;
                    const idx = match[1] ? parseInt(match[1], 10) : 0;
                    if (!Number.isNaN(idx)) {
                        maxIndex = Math.max(maxIndex, idx);
                    }
                }
                newName = `${baseName} (${maxIndex + 1})`;
            }
        } else {
            newName = `${originalName} (copy)`;
        }

        const ext = path.extname(String(existing.file_path || '')) || '.mp3';
        const newFileName = `${uuidv4()}${ext}`;
        const newRelativePath = `/uploads/library/${newFileName}`;

        // Storage logic
        const { isS3UploadStorage, s3CopyObject, s3KeyFromUploadsPath, s3ObjectExists } = await import('./objectStorage.js');
        const { resolveUploadPath } = await import('../utils/paths.js'); // Assuming we extract this or use a helper
        const fs = await import('fs');

        if (isS3UploadStorage()) {
            const srcKey = s3KeyFromUploadsPath(existing.file_path || '');
            const destKey = s3KeyFromUploadsPath(newRelativePath);
            if (!(await s3ObjectExists(srcKey))) throw new Error('Source audio not found in S3');
            await s3CopyObject({ sourceKey: srcKey, destKey });
        } else {
            const srcPath = resolveUploadPath(existing.file_path || '');
            const destPath = resolveUploadPath(newRelativePath);
            if (!fs.existsSync(srcPath)) throw new Error('Source audio not found on disk');
            fs.copyFileSync(srcPath, destPath);
        }

        const trackId = uuidv4();
        await run(
            `INSERT INTO tracks (id, name, artist, duration, size, file_path, hash)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [trackId, newName, existing.artist, existing.duration, existing.size, newRelativePath, existing.hash]
        );

        return await this.getTrackById(trackId);
    }

    /**
     * Create an alias (new DB entry, same file)
     */
    static async createAlias(baseTrackId, aliasName) {
        const existing = await this.getTrackById(baseTrackId);
        if (!existing) throw new Error('Base track not found');

        const trackId = uuidv4();
        await run(
            `INSERT INTO tracks (id, name, artist, duration, size, file_path, hash)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [trackId, aliasName, existing.artist, existing.duration, existing.size, existing.file_path, existing.hash]
        );

        return await this.getTrackById(trackId);
    }

    /**
     * Delete a track
     */
    static async deleteTrack(id) {
        const track = await this.getTrackById(id);
        if (!track) throw new Error('Track not found');
        // Logic for file deletion would go here...
        await run('DELETE FROM tracks WHERE id = ?', [id]);
        return { success: true };
    }
}
