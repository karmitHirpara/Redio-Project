import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, run, get } from '../config/database.js';

const router = express.Router();

// Get all playlists with tracks
router.get('/', async (req, res) => {
  try {
    const playlists = await query('SELECT * FROM playlists ORDER BY created_at DESC');
    
    // Get tracks for each playlist
    for (let playlist of playlists) {
      const tracks = await query(`
        SELECT t.*, pt.position
        FROM tracks t
        JOIN playlist_tracks pt ON t.id = pt.track_id
        WHERE pt.playlist_id = ?
        ORDER BY pt.position
      `, [playlist.id]);
      
      playlist.tracks = tracks;
      playlist.duration = tracks.reduce((sum, track) => sum + track.duration, 0);
      playlist.locked = Boolean(playlist.locked);
    }
    
    res.json(playlists);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single playlist
router.get('/:id', async (req, res) => {
  try {
    const playlist = await get('SELECT * FROM playlists WHERE id = ?', [req.params.id]);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    const tracks = await query(`
      SELECT t.*, pt.position
      FROM tracks t
      JOIN playlist_tracks pt ON t.id = pt.track_id
      WHERE pt.playlist_id = ?
      ORDER BY pt.position
    `, [playlist.id]);

    playlist.tracks = tracks;
    playlist.duration = tracks.reduce((sum, track) => sum + track.duration, 0);
    playlist.locked = Boolean(playlist.locked);

    res.json(playlist);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create playlist
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Playlist name is required' });
    }

    // Check if name already exists
    const existing = await get('SELECT * FROM playlists WHERE name = ?', [name]);
    if (existing) {
      return res.status(409).json({ error: 'Playlist name already exists' });
    }

    const playlistId = uuidv4();
    await run(
      'INSERT INTO playlists (id, name) VALUES (?, ?)',
      [playlistId, name]
    );

    const playlist = await get('SELECT * FROM playlists WHERE id = ?', [playlistId]);
    playlist.tracks = [];
    playlist.duration = 0;
    playlist.locked = false;

    res.status(201).json(playlist);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update playlist
router.put('/:id', async (req, res) => {
  try {
    const { name, locked } = req.body;
    const playlist = await get('SELECT * FROM playlists WHERE id = ?', [req.params.id]);
    
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    if (playlist.locked && !locked) {
      // Can't modify locked playlist unless unlocking
      return res.status(403).json({ error: 'Playlist is locked' });
    }

    if (name) {
      // Check if new name already exists
      const existing = await get('SELECT * FROM playlists WHERE name = ? AND id != ?', [name, req.params.id]);
      if (existing) {
        return res.status(409).json({ error: 'Playlist name already exists' });
      }
      await run('UPDATE playlists SET name = ? WHERE id = ?', [name, req.params.id]);
    }

    if (locked !== undefined) {
      await run('UPDATE playlists SET locked = ? WHERE id = ?', [locked ? 1 : 0, req.params.id]);
    }

    const updated = await get('SELECT * FROM playlists WHERE id = ?', [req.params.id]);
    const tracks = await query(`
      SELECT t.*, pt.position
      FROM tracks t
      JOIN playlist_tracks pt ON t.id = pt.track_id
      WHERE pt.playlist_id = ?
      ORDER BY pt.position
    `, [updated.id]);

    updated.tracks = tracks;
    updated.duration = tracks.reduce((sum, track) => sum + track.duration, 0);
    updated.locked = Boolean(updated.locked);

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete playlist
router.delete('/:id', async (req, res) => {
  try {
    const playlist = await get('SELECT * FROM playlists WHERE id = ?', [req.params.id]);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    if (playlist.locked) {
      return res.status(403).json({ error: 'Cannot delete locked playlist' });
    }

    await run('DELETE FROM playlists WHERE id = ?', [req.params.id]);
    res.json({ message: 'Playlist deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add tracks to playlist
router.post('/:id/tracks', async (req, res) => {
  try {
    const { trackIds } = req.body;
    if (!Array.isArray(trackIds) || trackIds.length === 0) {
      return res.status(400).json({ error: 'Track IDs array is required' });
    }

    const playlist = await get('SELECT * FROM playlists WHERE id = ?', [req.params.id]);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    if (playlist.locked) {
      return res.status(403).json({ error: 'Playlist is locked' });
    }

    // Get current max position
    const maxPos = await get(
      'SELECT MAX(position) as max FROM playlist_tracks WHERE playlist_id = ?',
      [req.params.id]
    );
    let position = (maxPos?.max ?? -1) + 1;

    // Add tracks
    for (let trackId of trackIds) {
      // Check if track exists
      const track = await get('SELECT * FROM tracks WHERE id = ?', [trackId]);
      if (!track) continue;

      // Check if already in playlist
      const existing = await get(
        'SELECT * FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?',
        [req.params.id, trackId]
      );
      if (existing) continue;

      await run(
        'INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
        [req.params.id, trackId, position++]
      );
    }

    // Return updated playlist
    const tracks = await query(`
      SELECT t.*, pt.position
      FROM tracks t
      JOIN playlist_tracks pt ON t.id = pt.track_id
      WHERE pt.playlist_id = ?
      ORDER BY pt.position
    `, [req.params.id]);

    res.json({ tracks });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove track from playlist
router.delete('/:id/tracks/:trackId', async (req, res) => {
  try {
    const playlist = await get('SELECT * FROM playlists WHERE id = ?', [req.params.id]);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    if (playlist.locked) {
      return res.status(403).json({ error: 'Playlist is locked' });
    }

    await run(
      'DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?',
      [req.params.id, req.params.trackId]
    );

    res.json({ message: 'Track removed from playlist' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reorder playlist tracks
router.put('/:id/reorder', async (req, res) => {
  try {
    const { trackIds } = req.body;
    if (!Array.isArray(trackIds)) {
      return res.status(400).json({ error: 'Track IDs array is required' });
    }

    const playlist = await get('SELECT * FROM playlists WHERE id = ?', [req.params.id]);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    if (playlist.locked) {
      return res.status(403).json({ error: 'Playlist is locked' });
    }

    // Update positions
    for (let i = 0; i < trackIds.length; i++) {
      await run(
        'UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?',
        [i, req.params.id, trackIds[i]]
      );
    }

    res.json({ message: 'Playlist reordered successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
