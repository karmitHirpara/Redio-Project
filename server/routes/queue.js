import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, run, get } from '../config/database.js';

const router = express.Router();

const emitQueueUpdated = async (app) => {
  const broadcastEvent = app.get('broadcastEvent');
  if (typeof broadcastEvent !== 'function') return;

  try {
    const queueItems = await query(`
      SELECT q.*, t.name, t.artist, t.duration, t.size, t.file_path
      FROM queue q
      JOIN tracks t ON q.track_id = t.id
      ORDER BY q.order_position
    `);

    const formatted = queueItems.map(item => ({
      id: item.id,
      track: {
        id: item.track_id,
        name: item.name,
        artist: item.artist,
        duration: item.duration,
        size: item.size,
        filePath: item.file_path
      },
      fromPlaylist: item.from_playlist,
      order: item.order_position
    }));

    broadcastEvent({ type: 'queue-updated', queue: formatted });
  } catch (error) {
    console.error('Failed to emit queue-updated event', error);
  }
};

// Get queue
router.get('/', async (req, res) => {
  try {
    const queueItems = await query(`
      SELECT q.*, t.name, t.artist, t.duration, t.size, t.file_path
      FROM queue q
      JOIN tracks t ON q.track_id = t.id
      ORDER BY q.order_position
    `);

    const formatted = queueItems.map(item => ({
      id: item.id,
      track: {
        id: item.track_id,
        name: item.name,
        artist: item.artist,
        duration: item.duration,
        size: item.size,
        filePath: item.file_path
      },
      fromPlaylist: item.from_playlist,
      order: item.order_position
    }));

    res.json(formatted);
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

    // Check if track exists
    const track = await get('SELECT * FROM tracks WHERE id = ?', [trackId]);
    if (!track) {
      return res.status(404).json({ error: 'Track not found' });
    }

    // Get current max position
    const maxPos = await get('SELECT MAX(order_position) as max FROM queue');
    const position = (maxPos?.max ?? -1) + 1;

    const queueId = uuidv4();
    await run(
      `INSERT INTO queue (id, track_id, from_playlist, order_position)
       VALUES (?, ?, ?, ?)`,
      [queueId, trackId, fromPlaylist || null, position]
    );

    const queueItem = await query(`
      SELECT q.*, t.name, t.artist, t.duration, t.size, t.file_path
      FROM queue q
      JOIN tracks t ON q.track_id = t.id
      WHERE q.id = ?
    `, [queueId]);

    const item = queueItem[0];
    const response = {
      id: item.id,
      track: {
        id: item.track_id,
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
        'UPDATE queue SET order_position = ? WHERE id = ?',
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
    const result = await run('DELETE FROM queue WHERE id = ?', [req.params.id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    // Reorder remaining items
    const remaining = await query('SELECT id FROM queue ORDER BY order_position');
    for (let i = 0; i < remaining.length; i++) {
      await run('UPDATE queue SET order_position = ? WHERE id = ?', [i, remaining[i].id]);
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
    await run('DELETE FROM queue');

    await emitQueueUpdated(req.app);

    res.json({ message: 'Queue cleared' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
