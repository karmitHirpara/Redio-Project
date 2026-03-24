import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { query as queryLibrary, get as getLibrary } from '../config/database.js';
import { query, run, get } from '../config/queueDatabase.js';
import { sha256File, getDuration } from '../services/audio.js';

const router = express.Router();

export async function enqueueTrackCopy({
  trackId,
  fromPlaylist,
  orderPosition,
}) {
  // Check if track exists in library DB
  const track = await getLibrary('SELECT * FROM tracks WHERE id = ?', [trackId]);
  if (!track) {
    const err = new Error('Track not found');
    err.status = 404;
    throw err;
  }

  const rawUploadPath = process.env.UPLOAD_PATH || 'uploads';
  const uploadsDir = path.isAbsolute(rawUploadPath)
    ? rawUploadPath
    : path.join(process.cwd(), rawUploadPath);

  const rawQueueUploadPath = process.env.QUEUE_UPLOAD_PATH || '';
  const queueUploadsDir = rawQueueUploadPath
    ? (path.isAbsolute(rawQueueUploadPath) ? rawQueueUploadPath : path.join(process.cwd(), rawQueueUploadPath))
    : path.join(path.dirname(uploadsDir), 'queue_uploads');

  if (!fs.existsSync(queueUploadsDir)) {
    fs.mkdirSync(queueUploadsDir, { recursive: true });
  }

  const libraryFilePath = String(track.file_path || '');
  if (!libraryFilePath.startsWith('/uploads/')) {
    const err = new Error('Track file_path is invalid');
    err.status = 400;
    throw err;
  }

  const rel = libraryFilePath.slice('/uploads/'.length);
  const srcAbs = path.resolve(uploadsDir, rel);
  if (!srcAbs.startsWith(path.resolve(uploadsDir) + path.sep)) {
    const err = new Error('Invalid track path');
    err.status = 400;
    throw err;
  }
  if (!fs.existsSync(srcAbs)) {
    const err = new Error('Track file not found on disk');
    err.status = 404;
    throw err;
  }

  const queueId = uuidv4();
  const originalFileName = path.basename(rel);
  const itemDir = path.join(queueUploadsDir, queueId);
  if (!fs.existsSync(itemDir)) fs.mkdirSync(itemDir, { recursive: true });
  const destAbs = path.join(itemDir, originalFileName);
  fs.copyFileSync(srcAbs, destAbs);

  const size = fs.statSync(destAbs).size;
  const duration = await getDuration(destAbs);
  const hash = await sha256File(destAbs);
  const queueFilePath = `/uploads_queue/${queueId}/${originalFileName}`;

  const position = Number.isFinite(orderPosition)
    ? Number(orderPosition)
    : ((await get('SELECT MAX(order_position) as max FROM queue_items'))?.max ?? -1) + 1;

  await run(
    `INSERT INTO queue_items (id, source_track_id, name, artist, duration, size, file_path, hash, from_playlist, order_position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      queueId,
      trackId,
      track.name,
      track.artist,
      Number(duration || 0),
      Number(size || 0),
      queueFilePath,
      hash,
      fromPlaylist || null,
      position,
    ],
  );

  return await get('SELECT * FROM queue_items WHERE id = ?', [queueId]);
}

export const emitQueueUpdated = async (app) => {
  const broadcastEvent = app.get('broadcastEvent');
  if (typeof broadcastEvent !== 'function') return;

  try {
    const queueItems = await query(`
      SELECT *
      FROM queue_items
      ORDER BY order_position
    `);

    const formatted = queueItems.map(item => ({
      id: item.id,
      track: {
        id: item.source_track_id || item.id,
        name: item.name,
        artist: item.artist,
        duration: item.duration,
        size: item.size,
        filePath: item.file_path
      },
      fromPlaylist: item.from_playlist,
      order: item.order_position
    }));

    const settingsRow = await get('SELECT mode FROM queue_settings WHERE id = 1');
    const settings = { mode: settingsRow?.mode || 'AUTO' };

    broadcastEvent({ type: 'queue-updated', queue: formatted, settings });
  } catch (error) {
    console.error('Failed to emit queue-updated event', error);
  }
};

// Get queue settings
router.get('/settings', async (req, res) => {
  try {
    const row = await get('SELECT mode FROM queue_settings WHERE id = 1');
    res.json({ mode: row?.mode || 'AUTO' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update queue settings
router.put('/settings', async (req, res) => {
  try {
    const { mode } = req.body;
    if (mode !== 'AUTO' && mode !== 'LIVE') {
      return res.status(400).json({ error: 'Invalid mode. Must be AUTO or LIVE.' });
    }
    
    await run('UPDATE queue_settings SET mode = ? WHERE id = 1', [mode]);
    await emitQueueUpdated(req.app);
    res.json({ message: 'Settings updated successfully', mode });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get queue
router.get('/', async (req, res) => {
  try {
    const queueItems = await query(`
      SELECT *
      FROM queue_items
      ORDER BY order_position
    `);

    const formatted = queueItems.map(item => ({
      id: item.id,
      track: {
        id: item.source_track_id || item.id,
        name: item.name,
        artist: item.artist,
        duration: item.duration,
        size: item.size,
        filePath: item.file_path
      },
      fromPlaylist: item.from_playlist,
      order: item.order_position
    }));

    const settingsRow = await get('SELECT mode FROM queue_settings WHERE id = 1');
    const settings = { mode: settingsRow?.mode || 'AUTO' };

    res.json({ queue: formatted, settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add to queue
router.post('/', async (req, res) => {
  try {
    const { trackId, fromPlaylist } = req.body;
    if (!trackId) {
      return res.status(400).json({ error: 'Track ID is required' });
    }

    const item = await enqueueTrackCopy({ trackId: String(trackId), fromPlaylist: fromPlaylist || null });
    const response = {
      id: item.id,
      track: {
        id: item.source_track_id || item.id,
        name: item.name,
        artist: item.artist,
        duration: item.duration,
        size: item.size,
        filePath: item.file_path
      },
      fromPlaylist: item.from_playlist,
      order: item.order_position
    };

    // Broadcast updated queue state
    await emitQueueUpdated(req.app);

    res.status(201).json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reorder queue
router.put('/reorder', async (req, res) => {
  try {
    const { queueIds } = req.body;
    if (!Array.isArray(queueIds)) {
      return res.status(400).json({ error: 'Queue IDs array is required' });
    }

    for (let i = 0; i < queueIds.length; i++) {
      await run(
        'UPDATE queue_items SET order_position = ? WHERE id = ?',
        [i, queueIds[i]]
      );
    }

    await emitQueueUpdated(req.app);

    res.json({ message: 'Queue reordered successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove from queue
router.delete('/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM queue_items WHERE id = ?', [req.params.id]);
    const result = await run('DELETE FROM queue_items WHERE id = ?', [req.params.id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    try {
      const rawQueueUploadPath = process.env.QUEUE_UPLOAD_PATH || '';
      const queueUploadsDir = rawQueueUploadPath
        ? (path.isAbsolute(rawQueueUploadPath) ? rawQueueUploadPath : path.join(process.cwd(), rawQueueUploadPath))
        : '';
      if (queueUploadsDir && existing?.id) {
        const itemDir = path.join(queueUploadsDir, String(existing.id));
        if (fs.existsSync(itemDir)) {
          fs.rmSync(itemDir, { recursive: true, force: true });
        }
      }
    } catch {
      // ignore
    }

    // Reorder remaining items
    const remaining = await query('SELECT id FROM queue_items ORDER BY order_position');
    for (let i = 0; i < remaining.length; i++) {
      await run('UPDATE queue_items SET order_position = ? WHERE id = ?', [i, remaining[i].id]);
    }

    await emitQueueUpdated(req.app);

    res.json({ message: 'Item removed from queue' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear queue
router.delete('/', async (req, res) => {
  try {
    const items = await query('SELECT id FROM queue_items');
    await run('DELETE FROM queue_items');

    try {
      const rawQueueUploadPath = process.env.QUEUE_UPLOAD_PATH || '';
      const queueUploadsDir = rawQueueUploadPath
        ? (path.isAbsolute(rawQueueUploadPath) ? rawQueueUploadPath : path.join(process.cwd(), rawQueueUploadPath))
        : '';
      if (queueUploadsDir) {
        for (const it of items) {
          const itemDir = path.join(queueUploadsDir, String(it.id));
          if (fs.existsSync(itemDir)) {
            fs.rmSync(itemDir, { recursive: true, force: true });
          }
        }
      }
    } catch {
      // ignore
    }

    await emitQueueUpdated(req.app);

    res.json({ message: 'Queue cleared' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
