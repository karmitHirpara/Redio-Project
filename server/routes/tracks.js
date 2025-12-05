import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { query, run, get } from '../config/database.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, process.env.UPLOAD_PATH || 'uploads');
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

// Create an alias track that reuses the same audio file but with a new name
router.post('/alias', async (req, res) => {
  try {
    const { baseTrackId } = req.body;

    if (!baseTrackId) {
      return res.status(400).json({ error: 'baseTrackId is required' });
    }

    const existing = await get('SELECT * FROM tracks WHERE id = ?', [baseTrackId]);
    if (!existing) {
      return res.status(404).json({ error: 'Base track not found' });
    }

    const baseName = existing.name || 'Track';

    // Find all tracks that share the same audio (same hash)
    const sameHashTracks = await query('SELECT name FROM tracks WHERE hash = ?', [existing.hash]);

    // Count how many existing names already use this base pattern ("Name", "Name 2", "Name 3", ...)
    const count = sameHashTracks.filter((row) => {
      const name = row.name || '';
      return name === baseName || name.startsWith(`${baseName} `);
    }).length;

    const aliasIndex = count + 1;
    const newName = aliasIndex === 1 ? baseName : `${baseName} ${aliasIndex}`;

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
        existing.hash
      ]
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
      // Remove uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(409).json({ 
        error: 'Duplicate file',
        existingTrack: existing 
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

    // Delete file if it exists
    const filePath = path.join(process.env.UPLOAD_PATH || 'uploads', path.basename(track.file_path));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete from database (cascades to playlist_tracks and queue)
    await run('DELETE FROM tracks WHERE id = ?', [req.params.id]);

    res.json({ message: 'Track deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
