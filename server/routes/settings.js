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

    res.json({ ok: true, settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
