import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { TrackService } from '../services/track.service.js';
import { query, run, get } from '../config/database.js';
import { resolveUploadPath, uploadsDir } from '../utils/paths.js';
import { isS3UploadStorage, s3KeyFromUploadsPath, s3PutFile, s3ObjectExists, s3DeleteObject } from '../services/objectStorage.js';
import { sha256File, getDuration } from '../services/audio.js';
import { emitQueueUpdated } from '../routes/queue.js';
import { trackSchema, trackEditSchema } from '../validators/track.validator.js';

const libraryDir = path.join(uploadsDir, 'library');
const playlistsDir = path.join(uploadsDir, 'playlists');
const useS3 = isS3UploadStorage();

const sanitizePlaylistFolderName = (name, fallback) => {
  const cleaned = String(name || '').replace(/[^a-zA-Z0-9 _-]/g, '').trim();
  return cleaned || String(fallback || 'playlist');
};

export const TrackController = {
  getAll: async (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 0;
      const offset = parseInt(req.query.offset, 10) || 0;
      const onlyExisting = req.query.all !== 'true';
      const tracks = await TrackService.getAllTracks(limit, offset, onlyExisting);
      res.json(tracks);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  getById: async (req, res) => {
    try {
      const track = await TrackService.getTrackById(req.params.id);
      if (!track) {
        return res.status(404).json({ error: 'Track not found' });
      }
      res.json(track);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  copy: async (req, res) => {
    try {
      const { sourceTrackId } = req.body;
      if (!sourceTrackId) return res.status(400).json({ error: 'sourceTrackId is required' });

      const track = await TrackService.copyTrack(sourceTrackId, 'suffix');
      res.status(201).json(track);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  alias: async (req, res) => {
    try {
      const { baseTrackId, aliasName } = req.body;
      if (!baseTrackId) return res.status(400).json({ error: 'baseTrackId is required' });
      if (!aliasName) return res.status(400).json({ error: 'aliasName is required' });

      const track = await TrackService.createAlias(baseTrackId, aliasName);
      res.status(201).json(track);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  edit: async (req, res) => {
    try {
      if (useS3) {
        return res.status(400).json({ error: 'Edit Song is not supported in S3 storage mode' });
      }

      const id = String(req.params.id || '');
      const validation = trackEditSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Invalid request data',
          details: validation.error.format()
        });
      }

      const { startSeconds: startSecondsRaw, endSeconds: endSecondsRaw, mode, playlistContext } = validation.data;
      if (!id) return res.status(400).json({ error: 'Missing track id' });

      const track = await get('SELECT * FROM tracks WHERE id = ?', [id]);
      if (!track) return res.status(404).json({ error: 'Track not found' });

      const rel = String(track.file_path || '');
      if (!rel) return res.status(400).json({ error: 'Track has no file_path' });

      const absInput = resolveUploadPath(rel);
      if (!fs.existsSync(absInput)) return res.status(404).json({ error: 'Audio file not found on disk' });

      if (!ffmpegPath) return res.status(500).json({ error: 'FFmpeg binary not available' });

      const ext = path.extname(absInput).toLowerCase();
      const tmpOut = `${absInput}.tmp-${uuidv4()}${ext || ''}`;

      const encodeArgs = (() => {
        if (ext === '.mp3') return ['-c:a', 'libmp3lame', '-q:a', '2'];
        if (ext === '.wav') return ['-c:a', 'pcm_s16le'];
        if (ext === '.ogg') return ['-c:a', 'libvorbis', '-q:a', '5'];
        if (ext === '.flac') return ['-c:a', 'flac'];
        if (ext === '.m4a' || ext === '.mp4' || ext === '.aac') return ['-c:a', 'aac', '-b:a', '192k'];
        return [];
      })();

      const start = Number(startSecondsRaw);
      const end = Number(endSecondsRaw);
      if (!Number.isFinite(start) || start < 0) return res.status(400).json({ error: 'startSeconds must be a number >= 0' });
      if (!Number.isFinite(end) || end <= 0) return res.status(400).json({ error: 'endSeconds must be a number > 0' });
      if (end <= start) return res.status(400).json({ error: 'endSeconds must be greater than startSeconds' });

      const durationSeconds = Math.max(0, end - start);
      const args = ['-y', '-i', absInput, '-ss', String(start), '-t', String(durationSeconds), ...encodeArgs, tmpOut];

      await new Promise((resolve, reject) => {
        const child = spawn(ffmpegPath, args, { windowsHide: true });
        let stderr = '';
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        child.on('error', (e) => reject(e));
        child.on('close', (code) => {
          if (code === 0) return resolve();
          reject(new Error(stderr || `ffmpeg exited with code ${code}`));
        });
      });

      if (!fs.existsSync(tmpOut)) return res.status(500).json({ error: 'Failed to write trimmed audio file' });

      const stat = fs.statSync(tmpOut);
      const newHash = await sha256File(tmpOut);
      const newDuration = Math.max(0, Math.round(Number(durationSeconds || 0)));

      if (mode === 'overwrite' && playlistContext && playlistContext.playlistId) {
        try {
          if (fs.existsSync(absInput)) fs.unlinkSync(absInput);
          fs.renameSync(tmpOut, absInput);
        } catch (e) {
          if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
          throw e;
        }
        await run('UPDATE tracks SET duration = ?, size = ?, hash = ? WHERE id = ?', [newDuration, stat.size, newHash, id]);
        const updated = await get('SELECT * FROM tracks WHERE id = ?', [id]);
        return res.json(updated);
      }

      if (mode === 'duplicate' || mode === 'overwrite') {
        const originalName = track.name || 'Track';
        const baseNameRaw = originalName.replace(/\s*\(\d+\)\s*$/, '').trim();
        const baseName = baseNameRaw.endsWith(' edit') ? baseNameRaw.slice(0, -5).trim() : baseNameRaw;
        const prefix = `${baseName} edit`;
        const escapedBase = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`^${escapedBase}(?: \\((\\d+)\\))?$`);

        const rows = await query('SELECT name FROM tracks WHERE name LIKE ?', [`${prefix}%`]);
        let maxIndex = 0;
        let hasEdit = false;
        for (const row of rows) {
          const name = row.name || '';
          if (name === prefix) hasEdit = true;
          const match = name.match(pattern);
          if (match) {
            const idx = match[1] ? parseInt(match[1], 10) : 0;
            if (!Number.isNaN(idx)) maxIndex = Math.max(maxIndex, idx);
          }
        }

        const newName = maxIndex > 0 ? `${prefix} (${maxIndex + 1})` : hasEdit ? `${prefix} (1)` : prefix;
        const fileExt = path.extname(absInput) || '.mp3';
        const cleanFileName = newName.replace(/[^a-zA-Z0-9 _-]/g, '') + fileExt;

        let finalDir = libraryDir;
        let virtualPathType = 'library';

        if (playlistContext && playlistContext.playlistId) {
          const pObj = await get('SELECT name FROM playlists WHERE id = ?', [playlistContext.playlistId]);
          const pFolder = sanitizePlaylistFolderName(pObj?.name || 'playlist', playlistContext.playlistId);
          finalDir = path.join(playlistsDir, pFolder);
          virtualPathType = `playlists/${pFolder}`;
          if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });
        }

        let destPath = path.join(finalDir, cleanFileName);
        let duplicateIndex = 1;
        while (fs.existsSync(destPath)) {
          destPath = path.join(finalDir, `${cleanFileName.replace(fileExt, '')} (${duplicateIndex})${fileExt}`);
          duplicateIndex++;
        }

        fs.renameSync(tmpOut, destPath);
        const newRelativePath = `/uploads/${virtualPathType}/${path.basename(destPath)}`;

        if (mode === 'duplicate') {
          const trackId = uuidv4();
          await run(`INSERT INTO tracks (id, name, artist, duration, size, file_path, hash) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [trackId, newName, track.artist, newDuration, stat.size, newRelativePath, newHash]);
          if (playlistContext && playlistContext.playlistId && playlistContext.position !== undefined) {
            const pt = await get('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? AND position = ?', [playlistContext.playlistId, playlistContext.position]);
            if (pt && pt.track_id === track.id) {
              await run('UPDATE playlist_tracks SET track_id = ? WHERE playlist_id = ? AND position = ?', [trackId, playlistContext.playlistId, playlistContext.position]);
            }
          }
          const duplicated = await get('SELECT * FROM tracks WHERE id = ?', [trackId]);
          return res.status(201).json(duplicated);
        }

        if (!(playlistContext && playlistContext.playlistId)) {
          const inUseByPlaylists = await query('SELECT DISTINCT playlist_id FROM playlist_tracks WHERE track_id = ?', [id]);
          if (inUseByPlaylists && inUseByPlaylists.length > 0) {
            const clonedId = uuidv4();
            await run(`INSERT INTO tracks (id, name, artist, duration, size, file_path, hash, original_filename) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [clonedId, track.name, track.artist, track.duration, track.size, track.file_path, track.hash, track.original_filename]);
            await run(`UPDATE playlist_tracks SET track_id = ? WHERE track_id = ?`, [clonedId, id]);
          } else {
            try { if (fs.existsSync(absInput)) fs.unlinkSync(absInput); } catch {}
          }
        }

        await run('UPDATE tracks SET name = ?, duration = ?, size = ?, hash = ?, file_path = ? WHERE id = ?',
          [newName, newDuration, stat.size, newHash, newRelativePath, id]);
        const updated = await get('SELECT * FROM tracks WHERE id = ?', [id]);
        return res.json(updated);
      }
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  upload: async (req, res) => {
    const files = req.files || (req.file ? [req.file] : []);
    if (files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    const results = [];
    const errors = [];

    // Helper to process a single file
    const processFile = async (file) => {
      let uploadedPath = file.path || resolveUploadPath(file.filename);
      try {
        const hash = file.sha256 || (await sha256File(uploadedPath));
        
        // Check for duplicates
        const existing = await get('SELECT * FROM tracks WHERE hash = ?', [hash]);
        if (existing) {
          if (useS3) {
            const existingKey = s3KeyFromUploadsPath(existing.file_path || '');
            if (!(await s3ObjectExists(existingKey))) {
              await s3PutFile({ key: existingKey, filePath: uploadedPath, contentType: file.mimetype });
            }
          } else {
            const existingFilePath = resolveUploadPath(existing.file_path || '');
            if (!fs.existsSync(existingFilePath)) {
              await run('UPDATE tracks SET file_path = ? WHERE id = ?', [`/uploads/${path.basename(file.filename)}`, existing.id]);
              return { status: 200, data: await get('SELECT * FROM tracks WHERE id = ?', [existing.id]) };
            }
          }
          if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
          return { status: 409, data: { error: 'Duplicate file', existingTrack: existing } };
        }

        // Validate metadata (per-file metadata in body not fully supported yet by Multer arrays, 
        // fallback to defaults or global body values)
        const validation = trackSchema.safeParse(req.body);
        const { name, artist, duration: durationRaw } = validation.success ? validation.data : {};
        
        let duration = durationRaw;
        // If duration is not provided or zero, extract it (parallelizable)
        if (!duration || parseInt(duration) === 0) {
          duration = await getDuration(uploadedPath);
        }

        if (useS3) {
          await s3PutFile({ key: s3KeyFromUploadsPath(file.filename), filePath: uploadedPath, contentType: file.mimetype });
          if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
        }

        return {
          status: 201,
          dbInfo: {
            id: uuidv4(),
            name: name || path.basename(file.originalname, path.extname(file.originalname)),
            artist: artist || 'Unknown Artist',
            duration: parseInt(duration) || 0,
            size: file.size,
            file_path: `/uploads/${file.filename}`,
            hash
          }
        };
      } catch (err) {
        if (fs.existsSync(uploadedPath)) {
          try { fs.unlinkSync(uploadedPath); } catch {}
        }
        throw err;
      }
    };

    try {
      // Process all files in parallel (CPU/IO bound tasks)
      const processResults = await Promise.allSettled(files.map(file => processFile(file)));

      const tracksToInsert = [];
      
      for (let i = 0; i < processResults.length; i++) {
        const result = processResults[i];
        if (result.status === 'fulfilled') {
          if (result.value.dbInfo) {
            tracksToInsert.push(result.value.dbInfo);
          } else {
            results.push(result.value); // Already handled duplicates
          }
        } else {
          const fileName = files[i]?.originalname || 'Unknown file';
          const reason = result.reason?.message || String(result.reason || 'Unknown error');
          console.error(`[Upload] Failed to process ${fileName}:`, reason);
          errors.push({ filename: fileName, error: reason });
        }
      }

      // Batch DB insertion in a single transaction
      if (tracksToInsert.length > 0) {
        await run('BEGIN IMMEDIATE TRANSACTION');
        try {
          for (const t of tracksToInsert) {
            await run(
              `INSERT INTO tracks (id, name, artist, duration, size, file_path, hash) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [t.id, t.name, t.artist, t.duration, t.size, t.file_path, t.hash]
            );
          }
          await run('COMMIT');
          
          // Fetch the inserted records
          for (const t of tracksToInsert) {
            results.push({ status: 201, data: await get('SELECT * FROM tracks WHERE id = ?', [t.id]) });
          }
        } catch (dbErr) {
          await run('ROLLBACK');
          throw dbErr;
        }
      }

      const statusCode = errors.length > 0 ? 207 : results.some(r => r.status === 201) ? 201 : 200;
      res.status(statusCode).json({
        ok: errors.length < files.length,
        results: results.map(r => r.data || r),
        errors: errors.length > 0 ? errors : undefined
      });

    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  rename: async (req, res) => {
    try {
      const { newName } = req.body;
      if (!newName || typeof newName !== 'string') {
        return res.status(400).json({ error: 'Valid newName is required' });
      }

      if (useS3) {
        return res.status(400).json({ error: 'Physical rename is not supported in S3 storage mode' });
      }

      const id = req.params.id;
      const track = await get('SELECT * FROM tracks WHERE id = ?', [id]);
      if (!track) return res.status(404).json({ error: 'Track not found' });

      const rel = String(track.file_path || '');
      if (!rel) return res.status(400).json({ error: 'Track has no file_path' });

      const oldAbsPath = resolveUploadPath(rel);
      if (!fs.existsSync(oldAbsPath)) return res.status(404).json({ error: 'Audio file not found on disk' });

      // Sanitize the new name
      const sanitizedName = newName.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Untitled';
      const fileExt = path.extname(oldAbsPath) || '.mp3';
      
      const dirName = path.dirname(oldAbsPath);
      let newFileName = `${sanitizedName}${fileExt}`;
      let newAbsPath = path.join(dirName, newFileName);
      
      let copyIndex = 1;
      while (fs.existsSync(newAbsPath) && newAbsPath.toLowerCase() !== oldAbsPath.toLowerCase()) {
        newFileName = `${sanitizedName} (${copyIndex})${fileExt}`;
        newAbsPath = path.join(dirName, newFileName);
        copyIndex++;
      }

      if (newAbsPath.toLowerCase() === oldAbsPath.toLowerCase()) {
        // Just update DB if name changes but sanitized filename matches old one
        if (track.name !== newName) {
           await run('UPDATE tracks SET name = ? WHERE id = ?', [newName, id]);
           const updated = await get('SELECT * FROM tracks WHERE id = ?', [id]);
           req.app.get('broadcastEvent')?.({ type: 'tracksUpdated', trackIds: [id] });
           return res.json(updated);
        }
        return res.json(track);
      }

      const newRelativePath = `${path.dirname(rel).replace(/\\/g, '/')}/${newFileName}`;

      await run('BEGIN IMMEDIATE TRANSACTION');
      let osRenamed = false;

      try {
        fs.renameSync(oldAbsPath, newAbsPath);
        osRenamed = true;

        await run('UPDATE tracks SET name = ?, file_path = ? WHERE id = ?', [newName, newRelativePath, id]);
        await run('COMMIT');
        
        const updated = await get('SELECT * FROM tracks WHERE id = ?', [id]);
        req.app.get('broadcastEvent')?.({ type: 'tracksUpdated', trackIds: [id] });
        
        return res.json(updated);
      } catch (err) {
        await run('ROLLBACK');
        
        // If OS rename succeeded but DB failed, revert OS rename
        if (osRenamed) {
          try {
            fs.renameSync(newAbsPath, oldAbsPath);
          } catch (revertErr) {
            console.error('[Rename] CRITICAL: Failed to revert OS rename after DB error.', revertErr);
          }
        }
        throw err;
      }
      
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  delete: async (req, res) => {
    try {
      const track = await get('SELECT * FROM tracks WHERE id = ?', [req.params.id]);
      if (!track) return res.status(404).json({ error: 'Track not found' });

      if (track.file_path) {
        const refRow = await get('SELECT COUNT(*) as count FROM tracks WHERE file_path = ?', [track.file_path]);
        if ((refRow?.count ?? 0) <= 1) {
          if (useS3) { try { await s3DeleteObject(s3KeyFromUploadsPath(track.file_path)); } catch {} }
          else { const filePath = resolveUploadPath(track.file_path || ''); if (fs.existsSync(filePath)) fs.unlinkSync(filePath); }
        }
      }

      await run('DELETE FROM tracks WHERE id = ?', [req.params.id]);
      await emitQueueUpdated(req.app);
      res.json({ message: 'Track deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
};
