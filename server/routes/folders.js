import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, run, get } from '../config/database.js';

const router = express.Router();

// Ensure tables exist
const init = async () => {
  await run(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS folder_tracks (
      folder_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      PRIMARY KEY (folder_id, track_id)
    )
  `);
};

init().catch(err => {
  console.error('Failed to init folders tables', err);
});

// Get all folders
router.get('/', async (req, res) => {
  try {
    const folders = await query('SELECT * FROM folders ORDER BY name COLLATE NOCASE');
    res.json(folders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create folder
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    const existing = await get('SELECT * FROM folders WHERE LOWER(name) = LOWER(?)', [name]);
    if (existing) {
      return res.status(409).json({ error: 'Folder name already exists' });
    }

    const id = uuidv4();
    await run('INSERT INTO folders (id, name) VALUES (?, ?)', [id, name]);

    const folder = await get('SELECT * FROM folders WHERE id = ?', [id]);
    res.status(201).json(folder);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rename folder
router.put('/:id', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    const folder = await get('SELECT * FROM folders WHERE id = ?', [req.params.id]);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const existing = await get(
      'SELECT * FROM folders WHERE LOWER(name) = LOWER(?) AND id != ?',
      [name, req.params.id]
    );
    if (existing) {
      return res.status(409).json({ error: 'Folder name already exists' });
    }

    await run('UPDATE folders SET name = ? WHERE id = ?', [name, req.params.id]);

    const updated = await get('SELECT * FROM folders WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete folder
router.delete('/:id', async (req, res) => {
  try {
    const folder = await get('SELECT * FROM folders WHERE id = ?', [req.params.id]);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    await run('DELETE FROM folder_tracks WHERE folder_id = ?', [req.params.id]);
    await run('DELETE FROM folders WHERE id = ?', [req.params.id]);

    res.json({ message: 'Folder deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get tracks for a folder
router.get('/:id/tracks', async (req, res) => {
  try {
    const folder = await get('SELECT * FROM folders WHERE id = ?', [req.params.id]);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const tracks = await query(
      `SELECT t.*
       FROM tracks t
       JOIN folder_tracks ft ON t.id = ft.track_id
       WHERE ft.folder_id = ?
       ORDER BY t.date_added DESC`,
      [req.params.id]
    );

    res.json(tracks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add tracks to folder
router.post('/:id/tracks', async (req, res) => {
  try {
    const { trackIds } = req.body;
    if (!Array.isArray(trackIds) || trackIds.length === 0) {
      return res.status(400).json({ error: 'trackIds array is required' });
    }

    const folder = await get('SELECT * FROM folders WHERE id = ?', [req.params.id]);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    for (const trackId of trackIds) {
      const track = await get('SELECT * FROM tracks WHERE id = ?', [trackId]);
      if (!track) continue;

      // Simple rule: the same track ID can only appear once in a folder,
      // but can be added freely to other folders. This is enforced by the
      // PRIMARY KEY (folder_id, track_id) plus INSERT OR IGNORE.
      await run(
        'INSERT OR IGNORE INTO folder_tracks (folder_id, track_id) VALUES (?, ?)',
        [req.params.id, trackId]
      );
    }

    res.json({ message: 'Tracks added to folder' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
