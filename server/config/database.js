import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(dirname(__dirname), process.env.DATABASE_PATH || 'database.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');

    // Create helpful indexes if they do not exist yet. This is safe to run
    // on every startup and improves performance for common queries.
    const indexSpecs = [
      // Playlist-related
      { sql: 'CREATE INDEX IF NOT EXISTS idx_playlists_created_at ON playlists (created_at)', table: 'playlists' },
      { sql: 'CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist_position ON playlist_tracks (playlist_id, position)', table: 'playlist_tracks' },

      // Queue lookups
      { sql: 'CREATE INDEX IF NOT EXISTS idx_queue_track_id ON queue (track_id)', table: 'queue' },
      { sql: 'CREATE INDEX IF NOT EXISTS idx_queue_order ON queue ("order")', table: 'queue' },

      // History queries (ordered by played_at)
      { sql: 'CREATE INDEX IF NOT EXISTS idx_history_played_at ON history (played_at)', table: 'history' },

      // Schedule evaluations
      { sql: 'CREATE INDEX IF NOT EXISTS idx_schedules_status_date_time ON schedules (status, date_time)', table: 'schedules' },
      { sql: 'CREATE INDEX IF NOT EXISTS idx_schedules_queue_song ON schedules (queue_song_id)', table: 'schedules' },
    ];

    db.all("SELECT name FROM sqlite_master WHERE type='table'", (e, rows) => {
      if (e) {
        console.error('Failed to inspect database tables for index creation', e.message);
        return;
      }
      const existingTables = new Set(rows.map((r) => r.name));
      indexSpecs.forEach(({ sql, table }) => {
        if (!existingTables.has(table)) return;
        db.run(sql, (err2) => {
          if (err2) {
            console.error('Failed to ensure index:', sql, err2.message);
          }
        });
      });
    });
  }
});

// Promisify database operations
export const query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

export const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

export const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export default db;
