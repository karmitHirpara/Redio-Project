import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import path, { dirname, join } from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the database path. If DATABASE_PATH is absolute (as provided by the
// Electron main process for packaged builds), use it directly; otherwise
// resolve it relative to the server root for dev/server usage.
const rawDbPath = process.env.DATABASE_PATH || 'database.sqlite';
const dbPath = path.isAbsolute(rawDbPath)
  ? rawDbPath
  : join(dirname(__dirname), rawDbPath);

export const resolvedDbPath = dbPath;

// Ensure the directory for the SQLite file exists (important in packaged
// Electron builds where DATABASE_PATH points to the userData folder).
const dbDir = dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

console.log('SQLite DB path:', dbPath);

/**
 * Promisified database actions for use during initialization/migration.
 */
function dbRun(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function dbAll(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function ensureCoreSchema(database) {
  // Ensure core tables exist for a fresh database (used by the packaged
  // Electron app) and then create helpful indexes. This is safe to run on
  // every startup.
  await dbRun(database, `
      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        name TEXT,
        artist TEXT,
        duration INTEGER,
        size INTEGER,
        file_path TEXT,
        original_filename TEXT,
        hash TEXT,
        exists_on_disk INTEGER DEFAULT 1,
        cue_in REAL DEFAULT 0,
        cue_out REAL DEFAULT NULL,
        date_added DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

  // We still use serialize for the FTS/Triggers block as it doesn't return Promises
  // but we should ensure it completes. For simplicity, we'll keep the FTS logic
  // callback-based but wrap it in a Promise for ensureCoreSchema to await.
  await new Promise((resolve, reject) => {
    database.serialize(() => {
      database.run(
        `CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
          track_id UNINDEXED,
          name,
          artist,
          original_filename,
          tokenize='unicode61 remove_diacritics 2'
        )`,
        (ftsErr) => {
          if (ftsErr) {
            console.warn('FTS5 not available; library search will use fallback', ftsErr.message);
            resolve(); // Non-critical failure
            return;
          }

          database.run(
            `CREATE TRIGGER IF NOT EXISTS tracks_fts_ai AFTER INSERT ON tracks BEGIN
              INSERT INTO tracks_fts(track_id, name, artist, original_filename)
              VALUES (new.id, new.name, new.artist, new.original_filename);
            END;`,
          );

          database.run(
            `CREATE TRIGGER IF NOT EXISTS tracks_fts_ad AFTER DELETE ON tracks BEGIN
              DELETE FROM tracks_fts WHERE track_id = old.id;
            END;`,
          );

          database.run(
            `CREATE TRIGGER IF NOT EXISTS tracks_fts_au AFTER UPDATE ON tracks BEGIN
              DELETE FROM tracks_fts WHERE track_id = old.id;
              INSERT INTO tracks_fts(track_id, name, artist, original_filename)
              VALUES (new.id, new.name, new.artist, new.original_filename);
            END;`,
          );

          database.get('SELECT COUNT(1) AS c FROM tracks_fts', (countErr, row) => {
            if (countErr) {
              resolve();
              return;
            }
            const c = Number(row?.c || 0);
            if (c > 0) {
              resolve();
              return;
            }

            database.run(
              `INSERT INTO tracks_fts(track_id, name, artist, original_filename)
               SELECT id, name, artist, original_filename FROM tracks`,
              (fillErr) => {
                if (fillErr) {
                  console.warn('Failed to backfill tracks_fts', fillErr.message);
                }
                resolve();
              },
            );
          });
        },
      );
    });
  });

  await dbRun(database, `
      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        locked INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

  await dbRun(database, `
      CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlist_id TEXT NOT NULL,
        track_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
        PRIMARY KEY (playlist_id, track_id)
      )
    `);

  await dbRun(database, `
      CREATE TABLE IF NOT EXISTS queue (
        id TEXT PRIMARY KEY,
        track_id TEXT NOT NULL,
        from_playlist TEXT,
        order_position INTEGER NOT NULL,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
      )
    `);

  await dbRun(database, `
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL,
        type TEXT NOT NULL,
        date_time DATETIME,
        queue_song_id TEXT,
        trigger_position TEXT,
        lock_playlist INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        fired_at DATETIME,
        completed_at DATETIME,
        FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
      )
    `);

  // Migration: schedules.lock_playlist
  const scheduleCols = await dbAll(database, `PRAGMA table_info(schedules)`);
  const hasLockPlaylist = scheduleCols.some((c) => c.name === 'lock_playlist');
  if (!hasLockPlaylist) {
    await dbRun(database, `ALTER TABLE schedules ADD COLUMN lock_playlist INTEGER DEFAULT 0`);
  }

  // Migration: tracks.exists_on_disk and cues
  const trackCols = await dbAll(database, `PRAGMA table_info(tracks)`);
  const hasExistsOnDisk = trackCols.some((c) => c.name === 'exists_on_disk');
  if (!hasExistsOnDisk) {
    console.log('[Migration] Adding exists_on_disk column to tracks table...');
    await dbRun(database, `ALTER TABLE tracks ADD COLUMN exists_on_disk INTEGER DEFAULT 1`);
  }
  
  const hasCueIn = trackCols.some((c) => c.name === 'cue_in');
  if (!hasCueIn) {
    console.log('[Migration] Adding cue_in and cue_out columns to tracks table...');
    await dbRun(database, `ALTER TABLE tracks ADD COLUMN cue_in REAL DEFAULT 0`);
    await dbRun(database, `ALTER TABLE tracks ADD COLUMN cue_out REAL DEFAULT NULL`);
  }

  await dbRun(database, `
      CREATE TABLE IF NOT EXISTS playback_history (
        id TEXT PRIMARY KEY,
        track_id TEXT NOT NULL,
        played_at DATETIME NOT NULL,
        position_start INTEGER NOT NULL,
        position_end INTEGER NOT NULL,
        completed BOOLEAN NOT NULL,
        source TEXT NOT NULL,
        file_status TEXT NOT NULL,
        session_id TEXT,
        updated_at DATETIME,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL
      )
    `);

  await dbRun(database, `
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

  await dbRun(database, `INSERT OR IGNORE INTO settings (key, value) VALUES
        ('playback.transition_mode', 'gap'),
        ('playback.gap_seconds', '2'),
        ('playback.crossfade_seconds', '2')`);

  await dbRun(database, `
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id TEXT NOT NULL DEFAULT ''
      )
    `);

  const folderCols = await dbAll(database, `PRAGMA table_info(folders)`);
  const hasParentId = folderCols.some((c) => c.name === 'parent_id');

  if (hasParentId) {
    await dbRun(database, `UPDATE folders SET parent_id = '' WHERE parent_id IS NULL`);
    await dbRun(database, `CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_parent_name ON folders (parent_id, name COLLATE NOCASE)`);
    await dbRun(database, `CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders (parent_id)`);
  } else {
    // Migration from legacy folders
    console.log('[Migration] Migrating folders table schema...');
    await dbRun(database, 'BEGIN IMMEDIATE TRANSACTION');
    try {
      await dbRun(database, `CREATE TABLE IF NOT EXISTS folders__migrated (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT NOT NULL DEFAULT ''
          )`);
      await dbRun(database, `INSERT OR IGNORE INTO folders__migrated (id, name, parent_id)
               SELECT id, name, '' FROM folders`);
      await dbRun(database, `DROP TABLE folders`);
      await dbRun(database, `ALTER TABLE folders__migrated RENAME TO folders`);
      await dbRun(database, `CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_parent_name ON folders (parent_id, name COLLATE NOCASE)`);
      await dbRun(database, `CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders (parent_id)`);
      await dbRun(database, 'COMMIT');
    } catch (err) {
      console.error('Failed to migrate folders table', err);
      await dbRun(database, 'ROLLBACK');
    }
  }

  await dbRun(database, `
      CREATE TABLE IF NOT EXISTS folder_tracks (
        folder_id TEXT NOT NULL,
        track_id TEXT NOT NULL,
        PRIMARY KEY (folder_id, track_id)
      )
    `);

  const indexSpecs = [
    { sql: 'CREATE INDEX IF NOT EXISTS idx_playlists_created_at ON playlists (created_at)', table: 'playlists' },
    { sql: 'CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist_position ON playlist_tracks (playlist_id, position)', table: 'playlist_tracks' },
    { sql: 'CREATE INDEX IF NOT EXISTS idx_queue_track_id ON queue (track_id)', table: 'queue' },
    { sql: 'CREATE INDEX IF NOT EXISTS idx_queue_order ON queue (order_position)', table: 'queue' },
    { sql: 'CREATE INDEX IF NOT EXISTS idx_history_played_at ON playback_history (played_at)', table: 'playback_history' },
    { sql: 'CREATE INDEX IF NOT EXISTS idx_history_track_id ON playback_history (track_id)', table: 'playback_history' },
    { sql: 'CREATE INDEX IF NOT EXISTS idx_schedules_status_date_time ON schedules (status, date_time)', table: 'schedules' },
    { sql: 'CREATE INDEX IF NOT EXISTS idx_schedules_queue_song ON schedules (queue_song_id)', table: 'schedules' },
    { sql: 'CREATE INDEX IF NOT EXISTS idx_tracks_hash ON tracks (hash)', table: 'tracks' },
    { sql: 'CREATE INDEX IF NOT EXISTS idx_tracks_date_added ON tracks (date_added)', table: 'tracks' },
    { sql: 'CREATE INDEX IF NOT EXISTS idx_tracks_name ON tracks (name COLLATE NOCASE)', table: 'tracks' },
    { sql: 'CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks (artist COLLATE NOCASE)', table: 'tracks' },
  ];

  const tables = await dbAll(database, "SELECT name FROM sqlite_master WHERE type='table'");
  const existingTables = new Set(tables.map((r) => r.name));

  for (const { sql, table } of indexSpecs) {
    if (existingTables.has(table)) {
      await dbRun(database, sql);
    }
  }
}

function openDatabaseConnection() {
  return new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(connection);
    });
  });
}

export let db = await openDatabaseConnection().catch((err) => {
  console.error('Error opening database:', err.message);
  return new sqlite3.Database(dbPath);
});

console.log('Connected to SQLite database');
await ensureCoreSchema(db);

export async function reconnectDatabase() {
  const previous = db;
  await new Promise((resolve) => previous.close(() => resolve()));
  db = await openDatabaseConnection();
  await ensureCoreSchema(db);
  return db;
}

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
    db.run(sql, params, function (err) {
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
