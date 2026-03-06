import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { query, run, get } from '../config/database.js';
import { emitQueueUpdated } from './queue.js';
import { isS3UploadStorage, s3PutFile, s3ObjectExists, s3DeleteObject, s3CopyObject, s3KeyFromUploadsPath } from '../services/objectStorage.js';
import { sha256File, getDuration } from '../services/audio.js';

const router = express.Router();

// Ensure we use the same uploads directory as the main server (server.js)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// If UPLOAD_PATH is absolute, use it as-is; otherwise resolve relative to this file
const rawUploadPath = process.env.UPLOAD_PATH || 'uploads';
const uploadsDir = path.isAbsolute(rawUploadPath)
  ? rawUploadPath
  : path.join(__dirname, '..', rawUploadPath);

const libraryDir = path.join(uploadsDir, 'library');
const playlistsDir = path.join(uploadsDir, 'playlists');

const useS3 = isS3UploadStorage();

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(libraryDir)) fs.mkdirSync(libraryDir, { recursive: true });
if (!fs.existsSync(playlistsDir)) fs.mkdirSync(playlistsDir, { recursive: true });

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 0);

const ALLOWED_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);

// Note: browsers sometimes report M4A as video/mp4.
const ALLOWED_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/flac',
  'audio/x-flac',
  'audio/mp4',
  'audio/aac',
  'video/mp4',
  'application/ogg',
]);

const isAllowedMime = (mime) => {
  if (!mime || typeof mime !== 'string') return false;
  if (mime.startsWith('audio/')) return true;
  return ALLOWED_MIME_TYPES.has(mime);
};

const normalizeExt = (originalName, mimeType) => {
  const raw = path.extname(String(originalName || '')).toLowerCase();
  if (raw) {
    return ALLOWED_EXTENSIONS.has(raw) ? raw : '';
  }

  // Fallback mapping based on MIME type when extension is missing/unknown.
  switch (String(mimeType || '').toLowerCase()) {
    case 'audio/mpeg':
    case 'audio/mp3':
      return '.mp3';
    case 'audio/wav':
    case 'audio/x-wav':
      return '.wav';
    case 'audio/ogg':
    case 'application/ogg':
      return '.ogg';
    case 'audio/flac':
    case 'audio/x-flac':
      return '.flac';
    case 'audio/mp4':
    case 'video/mp4':
    case 'audio/aac':
      return '.m4a';
    default:
      return '';
  }
};

const resolveUploadPath = (filePathOrName) => {
  // filePathOrName is typically like "/uploads/library/foo.mp3" or just "foo.mp3"
  // For safety, resolve against `uploadsDir` strictly.
  const normalized = filePathOrName.startsWith('/uploads/')
    ? filePathOrName.slice(9)
    : filePathOrName;
  const resolved = path.resolve(uploadsDir, normalized);
  const root = path.resolve(uploadsDir) + path.sep;
  if (!resolved.startsWith(root)) {
    throw new Error('Invalid upload path: outside of uploads dir');
  }
  return resolved;
};

const hashingDiskStorage = {
  _handleFile: (req, file, cb) => {
    try {
      // NOTE: Multer storage is primarily for manual HTTP uploads.
      // E.g. drops in Library. Files go directly to `library/` folder.
      let baseName = path.basename(file.originalname, path.extname(file.originalname));
      const safeExt = normalizeExt(file.originalname, file.mimetype);

      let finalName = `${baseName}${safeExt}`;
      let finalPath = path.join(libraryDir, finalName);

      // Handle OS collisions natively - append (1), (2) etc.
      let copyCount = 0;
      while (fs.existsSync(finalPath)) {
        copyCount++;
        finalName = `${baseName} (${copyCount})${safeExt}`;
        finalPath = path.join(libraryDir, finalName);
      }

      const hash = crypto.createHash('sha256');
      let size = 0;

      file.stream.on('data', (chunk) => {
        size += chunk.length;
        hash.update(chunk);
      });

      const outStream = fs.createWriteStream(finalPath);
      outStream.on('error', cb);
      file.stream.on('error', cb);

      outStream.on('finish', () => {
        const sha256 = hash.digest('hex');
        const relativePath = `library/${finalName}`;
        cb(null, {
          destination: uploadsDir,
          filename: relativePath,
          path: finalPath,
          size,
          sha256,
        });
      });

      file.stream.pipe(outStream);
    } catch (err) {
      cb(err);
    }
  },
  _removeFile: (req, file, cb) => {
    try {
      if (file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch {
      // ignore
    }
    cb(null);
  },
};



const uploadConfig = {
  storage: hashingDiskStorage,
  fileFilter: (req, file, cb) => {
    const ext = normalizeExt(file.originalname, file.mimetype);
    if (!ext || !ALLOWED_EXTENSIONS.has(ext) || !isAllowedMime(file.mimetype)) {
      cb(new Error('Invalid file type. Only audio files are allowed.'));
      return;
    }
    cb(null, true);
  },
};

if (Number.isFinite(MAX_UPLOAD_BYTES) && MAX_UPLOAD_BYTES > 0) {
  uploadConfig.limits = { fileSize: MAX_UPLOAD_BYTES };
}

const upload = multer(uploadConfig);

// Get all tracks with pagination support
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 0;
    const offset = parseInt(req.query.offset, 10) || 0;

    // DO NOT allow arbitrary search in playlists dir from general Library queries
    let sql = `SELECT * FROM tracks WHERE file_path NOT LIKE '/uploads/playlists/%' ORDER BY date_added DESC`;
    const params = [];

    if (limit > 0) {
      sql += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }

    const tracks = await query(sql, params);
    res.json(tracks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a real file copy of an existing track with special naming rules.
// If the existing track name already ends with "(number)", append " copy".
// Otherwise, generate an OS-style numbered name: "Name (1)", "Name (2)", ...
router.post('/copy', async (req, res) => {
  try {
    const { sourceTrackId } = req.body;

    if (!sourceTrackId) {
      return res.status(400).json({ error: 'sourceTrackId is required' });
    }

    const existing = await get('SELECT * FROM tracks WHERE id = ?', [sourceTrackId]);
    if (!existing) {
      return res.status(404).json({ error: 'Source track not found' });
    }

    const originalName = existing.name || 'Track';

    // If name already ends with "(number)", just append " copy".
    let newName;
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

      const nextIndex = maxIndex + 1;
      newName = `${baseName} (${nextIndex})`;
    }

    const ext = path.extname(String(existing.file_path || '')) || '.mp3';
    const newFileName = `${uuidv4()}${ext}`;

    if (useS3) {
      const srcKey = s3KeyFromUploadsPath(existing.file_path || '');
      const destKey = s3KeyFromUploadsPath(newFileName);
      const ok = await s3ObjectExists(srcKey);
      if (!ok) {
        return res.status(404).json({ error: 'Source audio file not found in object storage' });
      }
      await s3CopyObject({ sourceKey: srcKey, destKey });
    } else {
      const srcPath = resolveUploadPath(existing.file_path || '');
      if (!fs.existsSync(srcPath)) {
        return res.status(404).json({ error: 'Source audio file not found on disk' });
      }

      const destPath = resolveUploadPath(newFileName);
      fs.copyFileSync(srcPath, destPath);
    }

    const trackId = uuidv4();
    const newRelativePath = `/uploads/${newFileName}`;

    await run(
      `INSERT INTO tracks (id, name, artist, duration, size, file_path, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        trackId,
        newName,
        existing.artist,
        existing.duration,
        existing.size,
        newRelativePath,
        existing.hash,
      ],
    );

    const track = await get('SELECT * FROM tracks WHERE id = ?', [trackId]);
    res.status(201).json(track);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create an alias track that reuses the same audio file but with a new name
router.post('/alias', async (req, res) => {
  try {
    const { baseTrackId, aliasName } = req.body;

    if (!baseTrackId) {
      return res.status(400).json({ error: 'baseTrackId is required' });
    }

    const existing = await get('SELECT * FROM tracks WHERE id = ?', [baseTrackId]);
    if (!existing) {
      return res.status(404).json({ error: 'Base track not found' });
    }

    // If the caller provided an explicit aliasName (used for folder-level
    // duplicate handling), trust it and skip OS-style numbering logic here.
    let newName;
    if (aliasName && typeof aliasName === 'string' && aliasName.trim()) {
      newName = aliasName.trim();
    } else {
      const originalName = existing.name || 'Track';

      // If the current name already ends with "(number)", follow your rule and
      // append " copy" instead of bumping the number. This matches /tracks/copy
      // so duplicates look like the OS (e.g. "Tum Prem Ho (4) copy").
      if (/\(\d+\)\s*$/.test(originalName)) {
        newName = `${originalName} copy`;
      } else {
        const baseName = originalName;

        // Find all tracks that share the same audio (same hash) so aliases for
        // this file use OS-style sequential names: "Name", "Name (1)", ...
        const sameHashTracks = await query('SELECT name FROM tracks WHERE hash = ?', [existing.hash]);

        // Escape special characters in baseName for use in the regex.
        const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`^${escapedBase}(?: \\((\\d+)\\))?$`);
        let maxIndex = 0;
        for (const row of sameHashTracks) {
          const name = row.name || '';
          const match = name.match(pattern);
          if (!match) continue;
          const idx = match[1] ? parseInt(match[1], 10) : 0;
          if (!Number.isNaN(idx)) {
            maxIndex = Math.max(maxIndex, idx);
          }
        }

        const nextIndex = maxIndex + 1;
        newName = maxIndex === 0 ? baseName : `${baseName} (${nextIndex})`;
      }
    }

    const trackId = uuidv4();

    await run(
      `INSERT INTO tracks (id, name, artist, duration, size, file_path, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        trackId,
        newName,
        existing.artist,
        existing.duration,
        existing.size,
        existing.file_path,
        existing.hash,
      ],
    );

    const track = await get('SELECT * FROM tracks WHERE id = ?', [trackId]);
    res.status(201).json(track);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single track
router.get('/:id', async (req, res) => {
  try {
    const track = await get('SELECT * FROM tracks WHERE id = ?', [req.params.id]);
    if (!track) {
      return res.status(404).json({ error: 'Track not found' });
    }
    res.json(track);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Edit an existing track by trimming audio in-place (local disk only)
router.post('/:id/edit', async (req, res) => {
  try {
    if (useS3) {
      return res.status(400).json({ error: 'Edit Song is not supported in S3 storage mode' });
    }

    const id = String(req.params.id || '');
    const startSecondsRaw = req.body?.startSeconds;
    const endSecondsRaw = req.body?.endSeconds;
    const mode = req.body?.mode || 'overwrite';
    // The client sends the "context" so backend knows if it should fork to playlist isolates
    const playlistContext = req.body?.playlistContext || null;

    if (!id) return res.status(400).json({ error: 'Missing track id' });
    const hasTrim = startSecondsRaw !== undefined || endSecondsRaw !== undefined;
    if (!hasTrim) {
      return res.status(400).json({ error: 'Provide startSeconds and endSeconds' });
    }

    const track = await get('SELECT * FROM tracks WHERE id = ?', [id]);
    if (!track) {
      return res.status(404).json({ error: 'Track not found' });
    }

    const rel = String(track.file_path || '');
    if (!rel) {
      return res.status(400).json({ error: 'Track has no file_path' });
    }

    const absInput = resolveUploadPath(rel);
    if (!fs.existsSync(absInput)) {
      return res.status(404).json({ error: 'Audio file not found on disk' });
    }

    if (!ffmpegPath) {
      return res.status(500).json({ error: 'FFmpeg binary not available' });
    }

    const ext = path.extname(absInput).toLowerCase();
    const tmpOut = `${absInput}.tmp-${uuidv4()}${ext || ''}`;

    // Encode settings by extension. We re-encode for consistent trimming.
    const encodeArgs = (() => {
      if (ext === '.mp3') return ['-c:a', 'libmp3lame', '-q:a', '2'];
      if (ext === '.wav') return ['-c:a', 'pcm_s16le'];
      if (ext === '.ogg') return ['-c:a', 'libvorbis', '-q:a', '5'];
      if (ext === '.flac') return ['-c:a', 'flac'];
      if (ext === '.m4a' || ext === '.mp4' || ext === '.aac') return ['-c:a', 'aac', '-b:a', '192k'];
      // Fallback: let ffmpeg choose
      return [];
    })();

    let args;
    let durationSeconds;


    const start = Number(startSecondsRaw);
    const end = Number(endSecondsRaw);
    if (!Number.isFinite(start) || start < 0) {
      return res.status(400).json({ error: 'startSeconds must be a number >= 0' });
    }
    if (!Number.isFinite(end) || end <= 0) {
      return res.status(400).json({ error: 'endSeconds must be a number > 0' });
    }
    if (end <= start) {
      return res.status(400).json({ error: 'endSeconds must be greater than startSeconds' });
    }

    durationSeconds = Math.max(0, end - start);

    // Use -ss after -i for accuracy.
    args = [
      '-y',
      '-i',
      absInput,
      '-ss',
      String(start),
      '-t',
      String(durationSeconds),
      ...encodeArgs,
      tmpOut,
    ];

    await new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath, args, { windowsHide: true });
      let stderr = '';
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      child.on('error', (e) => reject(e));
      child.on('close', (code) => {
        if (code === 0) return resolve();
        reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      });
    });

    if (!fs.existsSync(tmpOut)) {
      return res.status(500).json({ error: 'Failed to write trimmed audio file' });
    }

    const stat = fs.statSync(tmpOut);
    const newHash = await sha256File(tmpOut);
    const newDuration = Math.max(0, Math.round(Number(durationSeconds || 0)));

    // PLAYLIST-SCOPED OVERWRITE:
    // When editing from within a playlist, overwrite must only affect the
    // exact track instance being edited (track id + file_path). Do not perform
    // any global name/filename collision detection across the DB.
    if (mode === 'overwrite' && playlistContext && playlistContext.playlistId) {
      try {
        // Replace the existing file contents in-place.
        // On most platforms rename is atomic if same volume.
        if (fs.existsSync(absInput)) {
          try {
            fs.unlinkSync(absInput);
          } catch {
            // ignore
          }
        }
        fs.renameSync(tmpOut, absInput);
      } catch (e) {
        try {
          if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
        } catch {
          // ignore
        }
        throw e;
      }

      await run('UPDATE tracks SET duration = ?, size = ?, hash = ? WHERE id = ?', [
        newDuration,
        stat.size,
        newHash,
        id,
      ]);

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
        if (!match) continue;
        const idx = match[1] ? parseInt(match[1], 10) : 0;
        if (!Number.isNaN(idx)) {
          maxIndex = Math.max(maxIndex, idx);
        }
      }

      const newName = maxIndex > 0 ? `${prefix} (${maxIndex + 1})` : hasEdit ? `${prefix} (1)` : prefix;
      const fileExt = path.extname(absInput) || '.mp3';
      const cleanFileName = newName.replace(/[^a-zA-Z0-9 _-]/g, '') + fileExt;

      let finalDir = libraryDir;
      let virtualPathType = 'library';

      if (playlistContext && playlistContext.playlistId) {
        // Find playlist name for physical folder
        const pObj = await get('SELECT name FROM playlists WHERE id = ?', [playlistContext.playlistId]);
        const pName = pObj?.name ? pObj.name.replace(/[^a-zA-Z0-9 _-]/g, '') : playlistContext.playlistId;
        finalDir = path.join(playlistsDir, pName);
        virtualPathType = `playlists/${pName}`;
        if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });
      }

      let destPath = path.join(finalDir, cleanFileName);
      let duplicateIndex = 1;
      while (fs.existsSync(destPath)) {
        const fallbackName = `${cleanFileName.replace(fileExt, '')} (${duplicateIndex})${fileExt}`;
        destPath = path.join(finalDir, fallbackName);
        duplicateIndex++;
      }

      fs.renameSync(tmpOut, destPath);
      const newRelativePath = `/uploads/${virtualPathType}/${path.basename(destPath)}`;

      if (mode === 'duplicate') {
        const trackId = uuidv4();
        await run(
          `INSERT INTO tracks (id, name, artist, duration, size, file_path, hash)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            trackId,
            newName,
            track.artist,
            newDuration,
            stat.size,
            newRelativePath,
            newHash,
          ]
        );

        // Auto-relink if this was triggered inside a playlist
        if (playlistContext && playlistContext.playlistId && playlistContext.position !== undefined) {
          const pt = await get('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? AND position = ?', [playlistContext.playlistId, playlistContext.position]);
          if (pt && pt.track_id === track.id) {
            await run('UPDATE playlist_tracks SET track_id = ? WHERE playlist_id = ? AND position = ?', [trackId, playlistContext.playlistId, playlistContext.position]);
          }
        }

        const duplicated = await get('SELECT * FROM tracks WHERE id = ?', [trackId]);
        return res.status(201).json(duplicated);
      }

      // mode === 'overwrite'
      if (!(playlistContext && playlistContext.playlistId)) {
        // Library Separation: If this track is in use by playlists, we must clone the original
        // DB record to preserve the unedited physical file for the playlists, and let the library
        // track point to the new overwritten file.
        const inUseByPlaylists = await query('SELECT DISTINCT playlist_id FROM playlist_tracks WHERE track_id = ?', [id]);

        if (inUseByPlaylists && inUseByPlaylists.length > 0) {
          // Clone original track for playlists to use
          const clonedId = uuidv4();
          await run(
            `INSERT INTO tracks (id, name, artist, duration, size, file_path, hash, original_filename)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [clonedId, track.name, track.artist, track.duration, track.size, track.file_path, track.hash, track.original_filename]
          );
          // Remap playlists to use the cloned track (which points to the untouched physical file)
          await run(`UPDATE playlist_tracks SET track_id = ? WHERE track_id = ?`, [clonedId, id]);
        } else {
          // Safe to delete old physical file, no playlists rely on it!
          try {
            if (fs.existsSync(absInput)) fs.unlinkSync(absInput);
          } catch {
            // ignore
          }
        }
      }

      // Update library track to point to the newly cut file!
      await run('UPDATE tracks SET name = ?, duration = ?, size = ?, hash = ?, file_path = ? WHERE id = ?', [
        newName,
        newDuration,
        stat.size,
        newHash,
        newRelativePath,
        id,
      ]);

      const updated = await get('SELECT * FROM tracks WHERE id = ?', [id]);
      return res.json(updated);
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Upload track
router.post('/upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();

    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large' });
    }

    return res.status(400).json({ error: err?.message || 'Upload failed' });
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const uploadedPath = req.file.path || resolveUploadPath(req.file.filename);

    // Hash is computed during streaming upload when using hashingDiskStorage.
    // Fallback to a streaming read if it is not available.
    const hash = req.file.sha256 || (await sha256File(uploadedPath));

    // Check if file already exists
    const existing = await get('SELECT * FROM tracks WHERE hash = ?', [hash]);
    if (existing) {
      if (useS3) {
        const existingKey = s3KeyFromUploadsPath(existing.file_path || '');
        const ok = await s3ObjectExists(existingKey);

        if (!ok) {
          await s3PutFile({ key: existingKey, filePath: uploadedPath, contentType: req.file.mimetype });
          fs.unlinkSync(uploadedPath);
          const repaired = await get('SELECT * FROM tracks WHERE id = ?', [existing.id]);
          return res.status(200).json(repaired);
        }

        fs.unlinkSync(uploadedPath);
        return res.status(409).json({
          error: 'Duplicate file',
          existingTrack: existing,
        });
      }

      // local disk mode
      const existingFilePath = resolveUploadPath(existing.file_path || '');

      if (!fs.existsSync(existingFilePath)) {
        const newRelativePath = `/uploads/${path.basename(req.file.filename)}`;

        await run('UPDATE tracks SET file_path = ? WHERE id = ?', [
          newRelativePath,
          existing.id,
        ]);

        const repaired = await get('SELECT * FROM tracks WHERE id = ?', [existing.id]);
        return res.status(200).json(repaired);
      }

      fs.unlinkSync(uploadedPath);
      return res.status(409).json({
        error: 'Duplicate file',
        existingTrack: existing,
      });
    }

    const trackId = uuidv4();
    let { name, artist, duration } = req.body;

    // MISSION-CRITICAL: If duration is missing, detect it on the backend.
    // This offloads work from the frontend and ensures persistence.
    if (!duration || parseInt(duration) === 0) {
      duration = await getDuration(uploadedPath);
    }

    if (useS3) {
      const key = s3KeyFromUploadsPath(req.file.filename);
      await s3PutFile({ key, filePath: uploadedPath, contentType: req.file.mimetype });
      fs.unlinkSync(uploadedPath);
    }

    await run(
      `INSERT INTO tracks (id, name, artist, duration, size, file_path, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        trackId,
        name || path.basename(req.file.originalname, path.extname(req.file.originalname)),
        artist || 'Unknown Artist',
        parseInt(duration) || 0,
        req.file.size,
        `/uploads/${req.file.filename}`,
        hash
      ]
    );

    const track = await get('SELECT * FROM tracks WHERE id = ?', [trackId]);
    res.status(201).json(track);
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file) {
      try {
        const uploadedPath = resolveUploadPath(req.file.filename);
        if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
      } catch {
        // ignore cleanup errors
      }
    }
    res.status(500).json({ error: error.message });
  }
});

// Delete track
router.delete('/:id', async (req, res) => {
  try {
    const track = await get('SELECT * FROM tracks WHERE id = ?', [req.params.id]);
    if (!track) {
      return res.status(404).json({ error: 'Track not found' });
    }

    // Only delete the underlying audio file if no other tracks reference
    // the same file_path. This ensures duplicate/alias entries that share
    // audio continue to work until the last reference is removed.
    if (track.file_path) {
      const refRow = await get(
        'SELECT COUNT(*) as count FROM tracks WHERE file_path = ?',
        [track.file_path],
      );
      const refCount = refRow?.count ?? 0;
      if (refCount <= 1) {
        if (useS3) {
          try {
            const key = s3KeyFromUploadsPath(track.file_path);
            await s3DeleteObject(key);
          } catch {
            // ignore storage delete errors
          }
        } else {
          const filePath = resolveUploadPath(track.file_path || '');
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      }
    }

    // Delete from database (cascades to playlist_tracks and queue)
    await run('DELETE FROM tracks WHERE id = ?', [req.params.id]);

    // Broadcast updated queue state since track deletion cascades to queue
    await emitQueueUpdated(req.app);

    res.json({ message: 'Track deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
