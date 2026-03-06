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

const libraryDir = path.join(uploadsDir, 'library');
if (!fs.existsSync(libraryDir)) fs.mkdirSync(libraryDir, { recursive: true });

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

const sanitizeFolderDirName = (name, id) => {
  const cleaned = String(name || '').replace(/[^a-zA-Z0-9 _-]/g, '').trim();
  const short = String(id || '').slice(0, 8);
  return cleaned ? `${cleaned}__${short}` : String(id || 'folder');
};

const ensureUniqueDestPath = (dirAbs, baseFileName) => {
  const ext = path.extname(baseFileName);
  const stem = path.basename(baseFileName, ext);
  let destFileName = baseFileName;
  let destAbs = path.join(dirAbs, destFileName);
  let n = 0;
  while (fs.existsSync(destAbs)) {
    n += 1;
    destFileName = `${stem} (${n})${ext}`;
    destAbs = path.join(dirAbs, destFileName);
  }
  return { destAbs, destFileName };
};

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

const getDescendantIds = async (folderId) => {
  const rows = await query(
    `WITH RECURSIVE descendants(id) AS (
      SELECT id FROM folders WHERE parent_id = ?
      UNION ALL
      SELECT f.id FROM folders f
      JOIN descendants d ON f.parent_id = d.id
    )
    SELECT id FROM descendants`,
    [folderId]
  );
  return (rows || []).map((r) => String(r.id));
};

const getFolderTrackRows = async (folderIds) => {
  if (!Array.isArray(folderIds) || folderIds.length === 0) return [];
  const rows = await query(
    `SELECT t.id, t.file_path
     FROM tracks t
     JOIN folder_tracks ft ON t.id = ft.track_id
     WHERE ft.folder_id IN (${folderIds.map(() => '?').join(',')})`,
    folderIds,
  );
  return Array.isArray(rows) ? rows : [];
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
    const childIds = await getDescendantIds(targetId);
    const idsToDelete = [targetId, ...childIds];

    await run('BEGIN IMMEDIATE TRANSACTION');
    try {
      for (const id of idsToDelete) {
        await run('DELETE FROM folder_tracks WHERE folder_id = ?', [id]);
      }

      for (const id of idsToDelete) {
        await run('DELETE FROM folders WHERE id = ?', [id]);
      }
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

// Preview recursive delete (used to decide whether to show confirmation)
router.get('/:id/delete-preview', async (req, res) => {
  try {
    const folder = await get('SELECT * FROM folders WHERE id = ?', [req.params.id]);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const targetId = String(req.params.id);
    const childIds = await getDescendantIds(targetId);
    const ids = [targetId, ...childIds];
    const tracks = await getFolderTrackRows(ids);
    const mediaCount = (tracks || []).filter((t) => String(t.file_path || '').trim()).length;

    return res.json({
      folderId: targetId,
      folderCount: ids.length,
      trackCount: tracks.length,
      mediaCount,
      requiresConfirmation: mediaCount > 0,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Recursive delete that removes media + DB records.
// If media exists, caller must pass ?force=1
router.delete('/:id/recursive', async (req, res) => {
  try {
    const folder = await get('SELECT * FROM folders WHERE id = ?', [req.params.id]);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const targetId = String(req.params.id);
    const childIds = await getDescendantIds(targetId);
    const idsToDelete = [targetId, ...childIds];
    const folderRows = await query(
      `SELECT id, name FROM folders WHERE id IN (${idsToDelete.map(() => '?').join(',')})`,
      idsToDelete,
    );
    const foldersToDelete = Array.isArray(folderRows) ? folderRows : [];
    const tracks = await getFolderTrackRows(idsToDelete);

    const mediaTracks = (tracks || []).filter((t) => String(t.file_path || '').trim());
    const hasMedia = mediaTracks.length > 0;
    const force = String(req.query.force || '') === '1';
    if (hasMedia && !force) {
      return res.status(409).json({
        error: 'Folder contains media files. Confirmation required.',
        requiresConfirmation: true,
        trackCount: tracks.length,
        mediaCount: mediaTracks.length,
        folderCount: idsToDelete.length,
      });
    }

    const deletedTrackIds = [];
    const deletedFileCount = { ok: 0, failed: 0 };
    const trashDir = trashPath(uploadsDir);

    await run('BEGIN IMMEDIATE TRANSACTION');
    try {
      // Remove physical files first (move to trash so current playback isn't interrupted).
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

      // Delete DB records.
      for (const id of idsToDelete) {
        await run('DELETE FROM folder_tracks WHERE folder_id = ?', [id]);
      }

      // Delete track rows referenced by this subtree.
      for (const t of tracks || []) {
        const trackId = String(t.id || '');
        if (!trackId) continue;
        await run('DELETE FROM tracks WHERE id = ?', [trackId]);
        deletedTrackIds.push(trackId);
      }

      for (const id of idsToDelete) {
        await run('DELETE FROM folders WHERE id = ?', [id]);
      }

      await run('COMMIT');
    } catch (e) {
      await run('ROLLBACK');
      throw e;
    }

    // Remove library folder directories on disk.
    try {
      for (const f of foldersToDelete) {
        const dirName = sanitizeFolderDirName(f.name, f.id);
        const folderAbsDir = path.join(libraryDir, dirName);
        if (!fs.existsSync(folderAbsDir)) continue;
        const dest = path.join(trashDir, `${Date.now()}_${Math.random().toString(16).slice(2)}_${dirName}`);
        try {
          fs.renameSync(folderAbsDir, dest);
        } catch {
          try {
            fs.rmSync(folderAbsDir, { recursive: true, force: true });
          } catch {
          }
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
        broadcastEvent({
          type: 'library-updated',
          reason: 'folder-recursive-deleted',
          folderId: targetId,
          folderIds: idsToDelete,
          trackIds: deletedTrackIds,
        });
      }
    } catch {
    }

    return res.json({
      ok: true,
      folderIds: idsToDelete,
      trackIds: deletedTrackIds,
      deletedFiles: deletedFileCount,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Get tracks for a folder with pagination support
router.get('/:id/tracks', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 0;
    const offset = parseInt(req.query.offset, 10) || 0;

    const folder = await get('SELECT * FROM folders WHERE id = ?', [req.params.id]);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    let sql = `
       SELECT t.*
       FROM tracks t
       JOIN folder_tracks ft ON t.id = ft.track_id
       WHERE ft.folder_id = ?
       ORDER BY t.date_added DESC
    `;
    const params = [req.params.id];

    if (limit > 0) {
      sql += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }

    const tracks = await query(sql, params);
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

    const folderDirName = sanitizeFolderDirName(folder.name, folder.id);
    const folderAbsDir = path.join(libraryDir, folderDirName);
    if (!fs.existsSync(folderAbsDir)) fs.mkdirSync(folderAbsDir, { recursive: true });

    for (const sourceTrackId of trackIds) {
      const source = await get('SELECT * FROM tracks WHERE id = ?', [sourceTrackId]);
      if (!source) continue;

      const rel = String(source.file_path || '');
      if (!rel) continue;
      const srcAbs = resolveUploadPath(rel);
      if (!fs.existsSync(srcAbs)) continue;

      const baseFileName = path.basename(rel);
      const { destAbs, destFileName } = ensureUniqueDestPath(folderAbsDir, baseFileName);

      fs.copyFileSync(srcAbs, destAbs);
      const st = fs.statSync(destAbs);

      const newTrackId = uuidv4();
      const newRel = `/uploads/library/${folderDirName}/${destFileName}`;

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
        ],
      );

      await run('INSERT INTO folder_tracks (folder_id, track_id) VALUES (?, ?)', [req.params.id, newTrackId]);
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

    const sourceDirName = sanitizeFolderDirName(sourceFolder.name, sourceFolder.id);
    const targetDirName = sanitizeFolderDirName(targetFolder.name, targetFolder.id);
    const targetAbsDir = path.join(libraryDir, targetDirName);
    if (!fs.existsSync(targetAbsDir)) fs.mkdirSync(targetAbsDir, { recursive: true });

    await run('BEGIN IMMEDIATE TRANSACTION');
    try {
      for (const trackId of trackIds) {
        const track = await get('SELECT * FROM tracks WHERE id = ?', [trackId]);
        if (!track) continue;

        // Move ownership means: move the physical file and update file_path on the same track row.
        const rel = String(track.file_path || '');
        if (rel) {
          const srcAbs = resolveUploadPath(rel);
          if (fs.existsSync(srcAbs)) {
            const baseFileName = path.basename(rel);
            const { destAbs, destFileName } = ensureUniqueDestPath(targetAbsDir, baseFileName);
            try {
              fs.renameSync(srcAbs, destAbs);
            } catch {
              fs.copyFileSync(srcAbs, destAbs);
              try {
                fs.unlinkSync(srcAbs);
              } catch {
                // ignore
              }
            }
            const newRel = `/uploads/library/${targetDirName}/${destFileName}`;
            await run('UPDATE tracks SET file_path = ? WHERE id = ?', [newRel, trackId]);
          }
        }

        await run('DELETE FROM folder_tracks WHERE folder_id = ? AND track_id = ?', [sourceFolderId, trackId]);
        await run('INSERT OR IGNORE INTO folder_tracks (folder_id, track_id) VALUES (?, ?)', [targetFolderId, trackId]);
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

    if (parentId === folderId) {
      return res.status(400).json({ error: 'Folder cannot be moved into itself' });
    }

    if (parentId !== '') {
      const newParent = await get('SELECT * FROM folders WHERE id = ?', [parentId]);
      if (!newParent) {
        return res.status(404).json({ error: 'Parent folder not found' });
      }

      // Prevent cycles (moving a folder into its own descendant)
      const descendants = await getDescendantIds(folderId);
      if (descendants.includes(parentId)) {
        return res.status(400).json({ error: 'Folder cannot be moved into its own subfolder' });
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
