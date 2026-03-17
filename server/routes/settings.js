import express from 'express';
import { query, run } from '../config/database.js';
import { run as runQueue, reconnectQueueDatabase } from '../config/queueDatabase.js';
import { fileURLToPath } from 'url';
import path, { dirname, join } from 'path';
import fs from 'fs';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function resolveUploadsDir() {
  const rawUploadPath = process.env.UPLOAD_PATH || 'uploads';
  const serverRoot = join(__dirname, '..');
  return path.isAbsolute(rawUploadPath)
    ? rawUploadPath
    : join(serverRoot, rawUploadPath);
}

function resolveQueueUploadsDir(uploadsDir) {
  const rawQueueUploadPath = process.env.QUEUE_UPLOAD_PATH || '';
  const serverRoot = join(__dirname, '..');
  if (rawQueueUploadPath) {
    return path.isAbsolute(rawQueueUploadPath)
      ? rawQueueUploadPath
      : join(serverRoot, rawQueueUploadPath);
  }
  return join(dirname(uploadsDir), 'queue_uploads');
}

router.get('/settings', async (_req, res) => {
  try {
    const rows = await query(`SELECT key, value, updated_at FROM settings`);
    const settings = {};
    for (const row of rows || []) {
      settings[row.key] = row.value;
    }
    res.json({ settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const updates = req.body?.updates;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'updates object is required' });
    }

    const keys = Object.keys(updates);
    if (keys.length === 0) {
      return res.json({ ok: true, settings: {} });
    }

    for (const key of keys) {
      const value = updates[key];
      if (typeof key !== 'string' || !key) continue;
      await run(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        [key, String(value)],
      );
    }

    const rows = await query(
      `SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`,
      keys,
    );

    const settings = {};
    for (const row of rows || []) {
      settings[row.key] = row.value;
    }

    // If any playback-related settings were updated, broadcast an event
    if (keys.some(k => k.startsWith('playback.'))) {
      const broadcastEvent = req.app.get('broadcastEvent');
      if (typeof broadcastEvent === 'function') {
        broadcastEvent({ type: 'playback-state-updated', settings });
      }
    }

    res.json({ ok: true, settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/settings/factory-reset', async (req, res) => {
  try {
    // Begin transaction for atomic reset
    await run('BEGIN TRANSACTION');

    // Clear all data from tables but preserve schemas
    const tables = [
      'tracks', 'playlists', 'playlist_tracks', 'queue', 
      'schedules', 'playback_history', 'settings', 'folders', 
      'folder_tracks', 'tracks_fts', 'library_folders'
    ];

    for (const table of tables) {
      try {
        await run(`DELETE FROM ${table}`);
      } catch (error) {
        // Ignore errors for tables that might not exist (e.g., tracks_fts)
        if (!error.message.includes('no such table')) {
          throw error;
        }
      }
    }

    // Reset sequences and auto-increment counters
    try {
      await run('DELETE FROM sqlite_sequence');
    } catch (error) {
      // Ignore if sequence table doesn't exist
    }

    // Commit transaction
    await run('COMMIT');

    // Clear queue database (separate sqlite file)
    try {
      await runQueue('DELETE FROM queue_items');
      await runQueue('DELETE FROM sqlite_sequence WHERE name = "queue_items"');
    } catch {
      // ignore queue db reset failures
    }

    // Reconnect to clear cache/wal
    try {
      await reconnectQueueDatabase();
    } catch {
      // ignore
    }

    // Delete media files on disk (but keep backups folder intact)
    try {
      const uploadsDir = resolveUploadsDir();
      const libraryDir = join(uploadsDir, 'library');
      const playlistsDir = join(uploadsDir, 'playlists');
      const queueUploadsDir = resolveQueueUploadsDir(uploadsDir);

      if (fs.existsSync(libraryDir)) {
        fs.rmSync(libraryDir, { recursive: true, force: true });
        fs.mkdirSync(libraryDir, { recursive: true });
      }
      if (fs.existsSync(playlistsDir)) {
        fs.rmSync(playlistsDir, { recursive: true, force: true });
        fs.mkdirSync(playlistsDir, { recursive: true });
      }
      if (fs.existsSync(queueUploadsDir)) {
        fs.rmSync(queueUploadsDir, { recursive: true, force: true });
        fs.mkdirSync(queueUploadsDir, { recursive: true });
      }

      // Also clear any top-level files in uploads that aren't in subdirs (if any)
      const topFiles = fs.readdirSync(uploadsDir);
      for (const file of topFiles) {
        const fullPath = join(uploadsDir, file);
        if (file !== 'library' && file !== 'playlists' && file !== 'backups' && file !== 'queue_uploads') {
          if (fs.statSync(fullPath).isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(fullPath);
          }
        }
      }
    } catch {
      // ignore media wipe failures
    }

    // Trigger vacuum to optimize database after clearing
    // Run this asynchronously after response to avoid blocking
    setImmediate(() => {
      run('VACUUM').catch(() => {
        // Ignore vacuum errors
      });
    });

    const broadcastEvent = req.app?.get?.('broadcastEvent');
    if (typeof broadcastEvent === 'function') {
      try {
        broadcastEvent({ type: 'database-restored', mode: 'factory-reset' });
      } catch {
        // ignore
      }
    }

    res.json({ ok: true, message: 'Factory reset completed successfully' });
  } catch (error) {
    // Rollback on error
    try {
      await run('ROLLBACK');
    } catch (rollbackError) {
      // Ignore rollback errors
    }
    res.status(500).json({ error: error.message });
  }
});

export default router;
