import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, run, get } from '../config/database.js';
import { emitQueueUpdated } from './queue.js';

const router = express.Router();

// Get recent playback history with pagination support
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;
    const history = await query(
      `SELECT * FROM (
         SELECT h.*, t.name as track_name, t.artist as track_artist
         FROM playback_history h
         LEFT JOIN tracks t ON h.track_id = t.id
         ORDER BY h.played_at DESC
         LIMIT ? OFFSET ?
       ) recent
       ORDER BY played_at DESC`,
      [limit, offset]
    );
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update an existing history entry (e.g. extend listening time or mark completed)
router.put('/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM playback_history WHERE id = ?', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ error: 'History entry not found' });
    }

    const {
      positionStart,
      positionEnd,
      completed,
    } = req.body;

    const newPositionStart = positionStart != null ? positionStart : existing.position_start;
    const newPositionEnd = positionEnd != null ? positionEnd : existing.position_end;
    const newCompleted =
      typeof completed === 'boolean' ? (completed ? 1 : 0) : existing.completed;

    await run(
      `UPDATE playback_history
       SET position_start = ?, position_end = ?, completed = ?
       WHERE id = ?`,
      [newPositionStart, newPositionEnd, newCompleted, req.params.id]
    );

    const updated = await get('SELECT * FROM playback_history WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a history entry
router.post('/', async (req, res) => {
  try {
    const {
      trackId,
      playedAt,
      positionStart,
      positionEnd,
      completed,
      source,
      fileStatus
    } = req.body;

    if (!trackId || !playedAt || positionStart == null || positionEnd == null || !source || !fileStatus) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const id = uuidv4();
    await run(
      `INSERT INTO playback_history
       (id, track_id, played_at, position_start, position_end, completed, source, file_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        trackId,
        playedAt,
        positionStart,
        positionEnd,
        completed ? 1 : 0,
        source,
        fileStatus
      ]
    );

    const entry = await get('SELECT * FROM playback_history WHERE id = ?', [id]);
    res.status(201).json(entry);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete all history entries
router.delete('/', async (req, res) => {
  try {
    const result = await run('DELETE FROM playback_history');
    console.log(`Cleared ${result.changes} history entries`);
    res.json({
      message: `Cleared ${result.changes} history entries`,
      count: result.changes
    });
  } catch (error) {
    console.error('Error clearing history:', error);
    res.status(500).json({ error: 'Failed to clear history' });
  }
});

// Delete a single history entry
router.delete('/:id', async (req, res) => {
  try {
    const result = await run('DELETE FROM playback_history WHERE id = ?', [req.params.id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'History entry not found' });
    }
    res.json({ message: 'History entry deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// History item actions: putBackToLibrary, addToQueue, deleteFromAll
router.post('/:id/actions', async (req, res) => {
  try {
    const { action } = req.body;
    const entry = await get('SELECT * FROM playback_history WHERE id = ?', [req.params.id]);
    if (!entry) {
      return res.status(404).json({ error: 'History entry not found' });
    }

    switch (action) {
      case 'addToQueue': {
        // Append track to the end of the queue
        const track = await get('SELECT * FROM tracks WHERE id = ?', [entry.track_id]);
        if (!track) {
          return res.status(404).json({ error: 'Track not found for this history entry' });
        }
        const { v4: uuid } = await import('uuid');
        const queueId = uuid();

        const maxPos = await get('SELECT MAX(order_position) as max FROM queue');
        const position = (maxPos?.max ?? -1) + 1;

        await run(
          `INSERT INTO queue (id, track_id, from_playlist, order_position)
           VALUES (?, ?, ?, ?)`,
          [queueId, entry.track_id, null, position]
        );

        // Broadcast updated queue state
        await emitQueueUpdated(req.app);

        return res.json({ message: 'Added to queue' });
      }
      case 'deleteFromAll': {
        // Remove track from library entirely; cascades to playlists and queue via FKs
        await run('DELETE FROM tracks WHERE id = ?', [entry.track_id]);
        return res.json({ message: 'Track removed from library, playlists, and queue' });
      }
      case 'putBackToLibrary': {
        // Basic placeholder: no-op if track already exists
        const track = await get('SELECT * FROM tracks WHERE id = ?', [entry.track_id]);
        if (track) {
          return res.json({ message: 'Track already in library' });
        }
        return res.status(400).json({ error: 'Re-import logic not implemented yet' });
      }
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
