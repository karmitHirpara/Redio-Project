import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, run, get } from '../config/database.js';

const router = express.Router();

// Get all schedules
router.get('/', async (req, res) => {
  try {
    const schedules = await query(`
      SELECT s.*, p.name as playlist_name
      FROM schedules s
      JOIN playlists p ON s.playlist_id = p.id
      WHERE s.status = 'pending'
      ORDER BY s.created_at DESC
    `);

    res.json(schedules);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create schedule
router.post('/', async (req, res) => {
  try {
    const { playlistId, type, dateTime, queueSongId, triggerPosition, lockPlaylist } = req.body;

    if (!playlistId || !type) {
      return res.status(400).json({ error: 'Playlist ID and type are required' });
    }

    // Check if playlist exists
    const playlist = await get('SELECT * FROM playlists WHERE id = ?', [playlistId]);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    // Validate schedule type
    if (type === 'datetime' && !dateTime) {
      return res.status(400).json({ error: 'Date/time is required for datetime schedules' });
    }

    if (type === 'song-trigger' && (!queueSongId || !triggerPosition)) {
      return res.status(400).json({ error: 'Queue song ID and trigger position are required for song triggers' });
    }

    const scheduleId = uuidv4();
    await run(
      `INSERT INTO schedules (id, playlist_id, type, date_time, queue_song_id, trigger_position, lock_playlist, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        scheduleId,
        playlistId,
        type,
        dateTime || null,
        queueSongId || null,
        triggerPosition || null,
        lockPlaylist ? 1 : 0,
      ]
    );

    const schedule = await query(`
      SELECT s.*, p.name as playlist_name
      FROM schedules s
      JOIN playlists p ON s.playlist_id = p.id
      WHERE s.id = ?
    `, [scheduleId]);

    res.status(201).json(schedule[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update schedule status
router.put('/:id', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    await run(
      'UPDATE schedules SET status = ? WHERE id = ?',
      [status, req.params.id]
    );

    const schedule = await query(`
      SELECT s.*, p.name as playlist_name
      FROM schedules s
      JOIN playlists p ON s.playlist_id = p.id
      WHERE s.id = ?
    `, [req.params.id]);

    if (schedule.length === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    res.json(schedule[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete schedule
router.delete('/:id', async (req, res) => {
  try {
    const result = await run('DELETE FROM schedules WHERE id = ?', [req.params.id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    res.json({ message: 'Schedule deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
