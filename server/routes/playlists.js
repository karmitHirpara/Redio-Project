import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, run, get } from '../config/database.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const router = express.Router();

// Ensure we use the same uploads directory base as server/routes/tracks.js
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rawUploadPath = process.env.UPLOAD_PATH || 'uploads';
const uploadsDir = path.isAbsolute(rawUploadPath)
  ? rawUploadPath
  : path.join(__dirname, '..', rawUploadPath);

const playlistsDir = path.join(uploadsDir, 'playlists');
if (!fs.existsSync(playlistsDir)) fs.mkdirSync(playlistsDir, { recursive: true });

const resolveUploadPath = (filePathOrName) => {
  const normalized = String(filePathOrName || '').startsWith('/uploads/')
    ? String(filePathOrName).slice(9)
    : String(filePathOrName || '');
  const resolved = path.resolve(uploadsDir, normalized);
  const root = path.resolve(uploadsDir) + path.sep;
  if (!resolved.startsWith(root)) {
    throw new Error('Invalid upload path: outside of uploads dir');
  }
  return resolved;
};

const sanitizePlaylistFolderName = (name, fallback) => {
  const cleaned = String(name || '').replace(/[^a-zA-Z0-9 _-]/g, '').trim();
  return cleaned || String(fallback || 'playlist');
};

const trashPath = (rootDir) => path.join(rootDir, '.__trash');

const moveToTrashOrUnlink = (absPath, trashDir) => {
  if (!absPath) return false;
  try {
    if (!fs.existsSync(absPath)) return false;
    fs.mkdirSync(trashDir, { recursive: true });
    const base = path.basename(absPath);
    const dest = path.join(trashDir, `${Date.now()}_${Math.random().toString(16).slice(2)}_${base}`);
    try {
      fs.renameSync(absPath, dest);
      return true;
    } catch {
      try {
        fs.unlinkSync(absPath);
        return true;
      } catch {
        return false;
      }
    }
  } catch {
    return false;
  }
};

// Get all playlists with tracks (optimized to avoid N+1 queries)
router.get('/', async (req, res) => {
  try {
    // Load all playlists first
    const playlists = await query('SELECT * FROM playlists ORDER BY created_at DESC');

    if (playlists.length === 0) {
      return res.json([]);
    }

    const playlistIds = playlists.map((p) => p.id);

    // Load all tracks for these playlists in a single joined query
    const trackRows = await query(
      `SELECT pt.playlist_id, pt.position, t.*
       FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id IN (${playlistIds.map(() => '?').join(',')})
       ORDER BY pt.playlist_id, pt.position`,
      playlistIds,
    );

    // Group tracks by playlist_id
    const tracksByPlaylist = new Map();
    for (const row of trackRows) {
      const { playlist_id, position, ...track } = row;
      const arr = tracksByPlaylist.get(playlist_id) || [];
      arr.push({ ...track, position });
      tracksByPlaylist.set(playlist_id, arr);
    }

    // Attach tracks and durations
    for (const playlist of playlists) {
      const tracks = tracksByPlaylist.get(playlist.id) || [];
      playlist.tracks = tracks;
      playlist.duration = tracks.reduce((sum, track) => sum + (track.duration || 0), 0);
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

// Preview recursive delete (used to decide whether to show confirmation)
router.get('/:id/delete-preview', async (req, res) => {
  try {
    const playlistId = String(req.params.id || '').trim();
    const playlist = await get('SELECT * FROM playlists WHERE id = ?', [playlistId]);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    const scheduled = await get(
      `SELECT COUNT(*) as cnt
       FROM schedules
       WHERE playlist_id = ? AND status = 'pending'`,
      [playlistId],
    );
    const scheduledCount = Number(scheduled?.cnt || 0);

    const trackRows = await query(
      `SELECT t.id, t.file_path
       FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ?`,
      [playlistId],
    );
    const tracks = Array.isArray(trackRows) ? trackRows : [];
    const playlistFolder = sanitizePlaylistFolderName(playlist.name, playlist.id);
    const playlistPrefix = `/uploads/playlists/${playlistFolder}/`;
    const mediaCount = tracks.filter((t) => String(t.file_path || '').startsWith(playlistPrefix)).length;

    return res.json({
      playlistId,
      trackCount: tracks.length,
      mediaCount,
      scheduledCount,
      requiresConfirmation: mediaCount > 0 || scheduledCount > 0,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Recursive delete that removes playlist-owned media + DB records.
// If media exists or playlist is scheduled, caller must pass ?force=1
router.delete('/:id/recursive', async (req, res) => {
  try {
    const playlistId = String(req.params.id || '').trim();
    const playlist = await get('SELECT * FROM playlists WHERE id = ?', [playlistId]);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    if (playlist.locked) {
      return res.status(403).json({ error: 'Cannot delete locked playlist' });
    }

    const scheduled = await get(
      `SELECT COUNT(*) as cnt
       FROM schedules
       WHERE playlist_id = ? AND status = 'pending'`,
      [playlistId],
    );
    const scheduledCount = Number(scheduled?.cnt || 0);

    const trackRows = await query(
      `SELECT t.id, t.file_path
       FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ?`,
      [playlistId],
    );
    const tracks = Array.isArray(trackRows) ? trackRows : [];

    const playlistFolder = sanitizePlaylistFolderName(playlist.name, playlist.id);
    const playlistPrefix = `/uploads/playlists/${playlistFolder}/`;
    const mediaTracks = tracks.filter((t) => String(t.file_path || '').startsWith(playlistPrefix));
    const hasMedia = mediaTracks.length > 0;
    const force = String(req.query.force || '') === '1';

    if ((hasMedia || scheduledCount > 0) && !force) {
      return res.status(409).json({
        error: 'Playlist contains media files and/or is scheduled. Confirmation required.',
        requiresConfirmation: true,
        trackCount: tracks.length,
        mediaCount: mediaTracks.length,
        scheduledCount,
      });
    }

    const deletedTrackIds = [];
    const deletedFileCount = { ok: 0, failed: 0 };
    const trashDir = trashPath(uploadsDir);

    await run('BEGIN IMMEDIATE TRANSACTION');
    try {
      // Move media files to trash first (helps avoid interrupting any active playback).
      for (const t of mediaTracks) {
        const rel = String(t.file_path || '');
        if (!rel) continue;
        try {
          const abs = resolveUploadPath(rel);
          const ok = moveToTrashOrUnlink(abs, trashDir);
          if (ok) deletedFileCount.ok += 1;
          else deletedFileCount.failed += 1;
        } catch {
          deletedFileCount.failed += 1;
        }
      }

      // Remove schedule entries pointing at this playlist.
      await run('DELETE FROM schedules WHERE playlist_id = ?', [playlistId]);

      // Delete playlist_tracks first.
      await run('DELETE FROM playlist_tracks WHERE playlist_id = ?', [playlistId]);

      // Delete playlist-owned track rows.
      for (const t of mediaTracks) {
        const id = String(t.id || '');
        if (!id) continue;
        await run('DELETE FROM tracks WHERE id = ?', [id]);
        deletedTrackIds.push(id);
      }

      // Finally delete playlist.
      await run('DELETE FROM playlists WHERE id = ?', [playlistId]);

      await run('COMMIT');
    } catch (e) {
      await run('ROLLBACK');
      throw e;
    }

    // Remove playlist folder directory structure on disk.
    try {
      const playlistAbsDir = path.join(playlistsDir, playlistFolder);
      if (fs.existsSync(playlistAbsDir)) {
        const dest = path.join(trashDir, `${Date.now()}_${Math.random().toString(16).slice(2)}_${playlistFolder}`);
        try {
          fs.renameSync(playlistAbsDir, dest);
        } catch {
          fs.rmSync(playlistAbsDir, { recursive: true, force: true });
        }
      }
    } catch {
    }

    // Async cleanup of trash directory.
    setImmediate(() => {
      try {
        if (fs.existsSync(trashDir)) {
          fs.rmSync(trashDir, { recursive: true, force: true });
        }
      } catch {
      }
    });

    try {
      const broadcastEvent = req.app.get('broadcastEvent');
      if (typeof broadcastEvent === 'function') {
        broadcastEvent({ type: 'playlistsUpdated', reason: 'playlist-recursive-deleted', playlistId });
      }
    } catch {
    }

    return res.json({
      ok: true,
      playlistId,
      deletedTrackIds,
      deletedFiles: deletedFileCount,
      scheduledCount,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
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

    const playlistFolder = sanitizePlaylistFolderName(playlist.name, playlist.id);
    const playlistAbsDir = path.join(playlistsDir, playlistFolder);
    if (!fs.existsSync(playlistAbsDir)) fs.mkdirSync(playlistAbsDir, { recursive: true });

    // Add tracks
    for (const sourceTrackId of trackIds) {
      const source = await get('SELECT * FROM tracks WHERE id = ?', [sourceTrackId]);
      if (!source) continue;

      const rel = String(source.file_path || '');
      if (!rel) continue;

      const srcAbs = resolveUploadPath(rel);
      if (!fs.existsSync(srcAbs)) continue;

      const baseFileName = path.basename(rel);
      const ext = path.extname(baseFileName);
      const baseStem = path.basename(baseFileName, ext);

      let destFileName = baseFileName;
      let destAbs = path.join(playlistAbsDir, destFileName);
      let copyIndex = 0;
      while (fs.existsSync(destAbs)) {
        copyIndex += 1;
        destFileName = `${baseStem} (${copyIndex})${ext}`;
        destAbs = path.join(playlistAbsDir, destFileName);
      }

      fs.copyFileSync(srcAbs, destAbs);
      const st = fs.statSync(destAbs);

      const newTrackId = uuidv4();
      const newRel = `/uploads/playlists/${playlistFolder}/${destFileName}`;

      await run(
        `INSERT INTO tracks (id, name, artist, duration, size, file_path, hash, original_filename)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newTrackId,
          source.name,
          source.artist,
          Number(source.duration || 0),
          Number(st.size || 0),
          newRel,
          source.hash,
          source.original_filename || baseFileName,
        ]
      );

      await run(
        'INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
        [req.params.id, newTrackId, position++]
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

    const playlistId = String(req.params.id || '');
    const trackId = String(req.params.trackId || '');
    if (!playlistId || !trackId) {
      return res.status(400).json({ error: 'Missing playlistId or trackId' });
    }

    const track = await get('SELECT * FROM tracks WHERE id = ?', [trackId]);

    await run('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?', [playlistId, trackId]);

    // Only delete the underlying track+file if it is a playlist-owned copy and
    // no other playlist_tracks row references it.
    if (track && String(track.file_path || '').startsWith('/uploads/playlists/')) {
      const refs = await get('SELECT COUNT(*) as cnt FROM playlist_tracks WHERE track_id = ?', [trackId]);
      const count = Number(refs?.cnt || 0);
      if (count <= 0) {
        try {
          const abs = resolveUploadPath(String(track.file_path || ''));
          if (abs && fs.existsSync(abs)) fs.unlinkSync(abs);
        } catch {
          // ignore file deletion errors
        }
        await run('DELETE FROM tracks WHERE id = ?', [trackId]);
      }
    }

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
