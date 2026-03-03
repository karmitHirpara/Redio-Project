import express from 'express';
import { query } from '../config/database.js';

const router = express.Router();

const normalizeQuery = (raw) => String(raw || '').trim();

const buildFtsPrefixQuery = (q) => {
  const tokens = String(q || '')
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);

  if (tokens.length === 0) return '';

  const escaped = tokens.map((t) => t.replace(/"/g, '""'));
  return escaped.map((t) => `"${t}"*`).join(' AND ');
};

router.get('/library/search', async (req, res) => {
  const q = normalizeQuery(req.query.q);
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '200'), 10) || 200, 1), 1000);

  if (!q) {
    return res.json({ results: [] });
  }

  try {
    let rows = [];
    try {
      const ftsQ = buildFtsPrefixQuery(q);
      rows = await query(
        `WITH matched AS (
          SELECT track_id
          FROM tracks_fts
          WHERE tracks_fts MATCH ?
          LIMIT ?
        ),
        folder_paths AS (
          WITH RECURSIVE fp(id, parent_id, path) AS (
            SELECT f.id, f.parent_id, f.name
            FROM folders f
            WHERE f.parent_id = ''
            UNION ALL
            SELECT f2.id, f2.parent_id, fp.path || ' / ' || f2.name
            FROM folders f2
            JOIN fp ON fp.id = f2.parent_id
          )
          SELECT id, path FROM fp
        )
        SELECT
          t.id,
          t.name,
          t.artist,
          t.duration,
          t.size,
          t.file_path,
          t.hash,
          t.date_added,
          ft.folder_id,
          f.name AS folder_name,
          COALESCE(p.path, f.name) AS folder_path
        FROM matched m
        JOIN tracks t ON t.id = m.track_id
        LEFT JOIN folder_tracks ft ON ft.track_id = t.id
        LEFT JOIN folders f ON f.id = ft.folder_id
        LEFT JOIN folder_paths p ON p.id = f.id
        ORDER BY t.name COLLATE NOCASE
        LIMIT ?`,
        [ftsQ, limit, limit],
      );
    } catch {
      const like = `%${q}%`;
      rows = await query(
        `WITH folder_paths AS (
          WITH RECURSIVE fp(id, parent_id, path) AS (
            SELECT f.id, f.parent_id, f.name
            FROM folders f
            WHERE f.parent_id = ''
            UNION ALL
            SELECT f2.id, f2.parent_id, fp.path || ' / ' || f2.name
            FROM folders f2
            JOIN fp ON fp.id = f2.parent_id
          )
          SELECT id, path FROM fp
        )
        SELECT
          t.id,
          t.name,
          t.artist,
          t.duration,
          t.size,
          t.file_path,
          t.hash,
          t.date_added,
          ft.folder_id,
          f.name AS folder_name,
          COALESCE(p.path, f.name) AS folder_path
        FROM tracks t
        LEFT JOIN folder_tracks ft ON ft.track_id = t.id
        LEFT JOIN folders f ON f.id = ft.folder_id
        LEFT JOIN folder_paths p ON p.id = f.id
        WHERE
          t.name LIKE ? COLLATE NOCASE OR
          t.artist LIKE ? COLLATE NOCASE OR
          t.original_filename LIKE ? COLLATE NOCASE
        ORDER BY t.name COLLATE NOCASE
        LIMIT ?`,
        [like, like, like, limit],
      );
    }

    return res.json({ results: rows || [] });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Search failed' });
  }
});

export default router;
