import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, run, get } from '../config/database.js';

const router = express.Router();

// Ensure tables exist
const init = async () => {
  await run(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT NOT NULL DEFAULT ''
    )
  `);

  await run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_parent_name ON folders (parent_id, name COLLATE NOCASE)`
  );

  await run(`CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders (parent_id)`);

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

const normalizeParentId = (value) => {
  if (value == null) return '';
  const s = String(value).trim();
  return s;
};

const isRootParentId = (parentId) => parentId === '';

// Get all folders
router.get('/', async (req, res) => {
  try {
    const folders = await query('SELECT * FROM folders ORDER BY parent_id COLLATE NOCASE, name COLLATE NOCASE');
    res.json(folders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create folder
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    const parentId = normalizeParentId(req.body?.parentId);
    if (!name) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    if (!isRootParentId(parentId)) {
      const parent = await get('SELECT * FROM folders WHERE id = ?', [parentId]);
      if (!parent) {
        return res.status(404).json({ error: 'Parent folder not found' });
      }
      // Allow only one nesting level: parent must be a main folder (root parent)
      const parentParentId = normalizeParentId(parent.parent_id);
      if (!isRootParentId(parentParentId)) {
        return res.status(400).json({ error: 'Nested folders beyond one level are not allowed' });
      }
    }

    const existing = await get(
      'SELECT * FROM folders WHERE LOWER(name) = LOWER(?) AND parent_id = ?',
      [name, parentId]
    );
    if (existing) {
      return res.status(409).json({ error: 'Folder name already exists' });
    }

    const id = uuidv4();
    await run('INSERT INTO folders (id, name, parent_id) VALUES (?, ?, ?)', [id, name, parentId]);

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

    const parentId = normalizeParentId(folder.parent_id);

    const existing = await get(
      'SELECT * FROM folders WHERE LOWER(name) = LOWER(?) AND parent_id = ? AND id != ?',
      [name, parentId, req.params.id]
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

    const targetId = String(req.params.id);
    const childFolders = await query('SELECT id FROM folders WHERE parent_id = ?', [targetId]);
    const childIds = (childFolders || []).map((r) => String(r.id));
    const idsToDelete = [targetId, ...childIds];

    await run('BEGIN IMMEDIATE TRANSACTION');
    try {
      for (const id of idsToDelete) {
        await run('DELETE FROM folder_tracks WHERE folder_id = ?', [id]);
      }

      for (const id of childIds) {
        await run('DELETE FROM folders WHERE id = ?', [id]);
      }
      await run('DELETE FROM folders WHERE id = ?', [targetId]);
      await run('COMMIT');
    } catch (e) {
      await run('ROLLBACK');
      throw e;
    }

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

// Move tracks between folders (move operation)
router.post('/move-tracks', async (req, res) => {
  try {
    const { sourceFolderId, targetFolderId, trackIds } = req.body;

    if (!sourceFolderId || !targetFolderId) {
      return res.status(400).json({ error: 'sourceFolderId and targetFolderId are required' });
    }
    if (!Array.isArray(trackIds) || trackIds.length === 0) {
      return res.status(400).json({ error: 'trackIds array is required' });
    }
    if (String(sourceFolderId) === String(targetFolderId)) {
      return res.json({ message: 'No-op' });
    }

    const sourceFolder = await get('SELECT * FROM folders WHERE id = ?', [sourceFolderId]);
    if (!sourceFolder) {
      return res.status(404).json({ error: 'Source folder not found' });
    }

    const targetFolder = await get('SELECT * FROM folders WHERE id = ?', [targetFolderId]);
    if (!targetFolder) {
      return res.status(404).json({ error: 'Target folder not found' });
    }

    await run('BEGIN IMMEDIATE TRANSACTION');
    try {
      for (const trackId of trackIds) {
        await run('DELETE FROM folder_tracks WHERE folder_id = ? AND track_id = ?', [sourceFolderId, trackId]);
        await run(
          'INSERT OR IGNORE INTO folder_tracks (folder_id, track_id) VALUES (?, ?)',
          [targetFolderId, trackId]
        );
      }
      await run('COMMIT');
    } catch (e) {
      await run('ROLLBACK');
      throw e;
    }

    try {
      const broadcastEvent = req.app.get('broadcastEvent');
      if (typeof broadcastEvent === 'function') {
        broadcastEvent({
          type: 'library-updated',
          reason: 'tracks-moved',
          sourceFolderId,
          targetFolderId,
          trackIds,
        });
      }
    } catch {
      // ignore
    }

    res.json({ message: 'Tracks moved' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Move a folder to a different parent (used for moving subfolders between main folders)
router.put('/:id/parent', async (req, res) => {
  try {
    const folderId = String(req.params.id);
    const parentId = normalizeParentId(req.body?.parentId);

    const folder = await get('SELECT * FROM folders WHERE id = ?', [folderId]);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    // Prevent turning a main folder with children into a subfolder (would create sub-subfolders)
    const children = await query('SELECT id FROM folders WHERE parent_id = ?', [folderId]);
    if (Array.isArray(children) && children.length > 0 && parentId !== '') {
      return res.status(400).json({ error: 'Folders with subfolders cannot be moved under another folder' });
    }

    if (parentId !== '') {
      const newParent = await get('SELECT * FROM folders WHERE id = ?', [parentId]);
      if (!newParent) {
        return res.status(404).json({ error: 'Parent folder not found' });
      }

      const newParentParentId = normalizeParentId(newParent.parent_id);
      if (newParentParentId !== '') {
        return res.status(400).json({ error: 'Nested folders beyond one level are not allowed' });
      }
    }

    // Unique name constraint within new parent
    const existing = await get(
      'SELECT * FROM folders WHERE LOWER(name) = LOWER(?) AND parent_id = ? AND id != ?',
      [folder.name, parentId, folderId]
    );
    if (existing) {
      return res.status(409).json({ error: 'Folder name already exists' });
    }

    await run('UPDATE folders SET parent_id = ? WHERE id = ?', [parentId, folderId]);
    const updated = await get('SELECT * FROM folders WHERE id = ?', [folderId]);

    try {
      const broadcastEvent = req.app.get('broadcastEvent');
      if (typeof broadcastEvent === 'function') {
        broadcastEvent({
          type: 'library-updated',
          reason: 'folder-moved',
          folderId,
          parentId,
        });
      }
    } catch {
      // ignore
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
