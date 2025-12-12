import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { query, run, get } from '../config/database.js';

const router = express.Router();

// Ensure we use the same uploads directory as the main server (server.js)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// If UPLOAD_PATH is absolute, use it as-is; otherwise resolve relative to this file
const rawUploadPath = process.env.UPLOAD_PATH || 'uploads';
const uploadsDir = path.isAbsolute(rawUploadPath)
  ? rawUploadPath
  : path.join(__dirname, '..', rawUploadPath);

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
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

    const srcPath = path.join(uploadsDir, path.basename(existing.file_path || ''));
    if (!fs.existsSync(srcPath)) {
      return res.status(404).json({ error: 'Source audio file not found on disk' });
    }

    const ext = path.extname(srcPath) || '.mp3';
    const newFileName = `${uuidv4()}${ext}`;
    const destPath = path.join(uploadsDir, newFileName);

    fs.copyFileSync(srcPath, destPath);

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
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Calculate file hash
    const fileBuffer = fs.readFileSync(req.file.path);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Check if file already exists
    const existing = await get('SELECT * FROM tracks WHERE hash = ?', [hash]);
    if (existing) {
      // If the DB says we already have this audio but the underlying file
      // is missing on disk, treat this upload as a repair: keep the new
      // file, update file_path for the existing track, and return it.
      const existingFilePath = path.join(
        uploadsDir,
        path.basename(existing.file_path || '')
      );

      if (!fs.existsSync(existingFilePath)) {
        const newRelativePath = `/uploads/${path.basename(req.file.filename)}`;

        await run('UPDATE tracks SET file_path = ? WHERE id = ?', [
          newRelativePath,
          existing.id,
        ]);

        const repaired = await get('SELECT * FROM tracks WHERE id = ?', [existing.id]);
        return res.status(200).json(repaired);
      }

      // True duplicate: underlying file exists already. Remove the freshly
      // uploaded file and signal a duplicate to the caller.
      fs.unlinkSync(req.file.path);
      return res.status(409).json({
        error: 'Duplicate file',
        existingTrack: existing,
      });
    }

    const trackId = uuidv4();
    const { name, artist, duration } = req.body;

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
      fs.unlinkSync(req.file.path);
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
    const filePath = path.join(uploadsDir, path.basename(track.file_path || ''));
    if (track.file_path) {
      const refRow = await get(
        'SELECT COUNT(*) as count FROM tracks WHERE file_path = ?',
        [track.file_path],
      );
      const refCount = refRow?.count ?? 0;
      if (refCount <= 1 && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
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
