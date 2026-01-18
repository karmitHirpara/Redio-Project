import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { query, run, get } from '../config/database.js';
import { isS3UploadStorage, s3PutFile, s3ObjectExists, s3DeleteObject, s3CopyObject, s3KeyFromUploadsPath } from '../services/objectStorage.js';

const router = express.Router();

// Ensure we use the same uploads directory as the main server (server.js)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// If UPLOAD_PATH is absolute, use it as-is; otherwise resolve relative to this file
const rawUploadPath = process.env.UPLOAD_PATH || 'uploads';
const uploadsDir = path.isAbsolute(rawUploadPath)
  ? rawUploadPath
  : path.join(__dirname, '..', rawUploadPath);

const useS3 = isS3UploadStorage();

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

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
  const base = path.basename(String(filePathOrName || ''));
  const resolved = path.resolve(uploadsDir, base);
  const root = path.resolve(uploadsDir) + path.sep;
  if (!resolved.startsWith(root)) {
    throw new Error('Invalid upload path');
  }
  return resolved;
};

const sha256File = (absolutePath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(absolutePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const safeExt = normalizeExt(file.originalname, file.mimetype);
    const uniqueName = `${uuidv4()}${safeExt}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = normalizeExt(file.originalname, file.mimetype);
    if (!ext || !ALLOWED_EXTENSIONS.has(ext) || !isAllowedMime(file.mimetype)) {
      cb(new Error('Invalid file type. Only audio files are allowed.'));
      return;
    }
    cb(null, true);
  }
});

// Get all tracks
router.get('/', async (req, res) => {
  try {
    const tracks = await query('SELECT * FROM tracks ORDER BY date_added DESC');
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

    const uploadedPath = resolveUploadPath(req.file.filename);

    // Calculate file hash without loading the entire file into memory.
    const hash = await sha256File(uploadedPath);

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
    const { name, artist, duration } = req.body;

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

    res.json({ message: 'Track deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
