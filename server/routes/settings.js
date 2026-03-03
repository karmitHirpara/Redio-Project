import express from 'express';
import { query, run } from '../config/database.js';

const router = express.Router();

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
      'folder_tracks', 'tracks_fts'
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

    // Trigger vacuum to optimize database after clearing
    // Run this asynchronously after response to avoid blocking
    setImmediate(() => {
      run('VACUUM').catch(() => {
        // Ignore vacuum errors
      });
    });

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
