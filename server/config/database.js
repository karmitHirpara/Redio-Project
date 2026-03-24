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

function ensureCoreSchema(database) {
  // Ensure core tables exist for a fresh database (used by the packaged
  // Electron app) and then create helpful indexes. This is safe to run on
  // every startup.
  database.serialize(() => {
    database.run('PRAGMA journal_mode = WAL');
    database.run(`
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
        date_added DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

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
          if (countErr) return;
          const c = Number(row?.c || 0);
          if (c > 0) return;

          database.run(
            `INSERT INTO tracks_fts(track_id, name, artist, original_filename)
             SELECT id, name, artist, original_filename FROM tracks`,
            (fillErr) => {
              if (fillErr) {
                console.warn('Failed to backfill tracks_fts', fillErr.message);
              }
            },
          );
        });
      },
    );

    database.run(`
      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        locked INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    database.run(`
      CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlist_id TEXT NOT NULL,
        track_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
        PRIMARY KEY (playlist_id, track_id)
      )
    `);

    database.run(`
      CREATE TABLE IF NOT EXISTS queue (
        id TEXT PRIMARY KEY,
        track_id TEXT NOT NULL,
        from_playlist TEXT,
        order_position INTEGER NOT NULL,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
      )
    `);

    database.run(`
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

    // Lightweight migration: older installs may not have lock_playlist on schedules.
    database.all(`PRAGMA table_info(schedules)`, (pragmaErr, cols) => {
      if (pragmaErr) {
        console.error('Failed to inspect schedules table for migrations', pragmaErr.message);
        return;
      }

      const hasLockPlaylist = Array.isArray(cols) && cols.some((c) => c.name === 'lock_playlist');
      if (!hasLockPlaylist) {
        database.run(`ALTER TABLE schedules ADD COLUMN lock_playlist INTEGER DEFAULT 0`, (alterErr) => {
          if (alterErr) {
            console.error('Failed to add schedules.lock_playlist column', alterErr.message);
          }
        });
      }
    });

    // Migration: ensure tracks has exists_on_disk
    database.all(`PRAGMA table_info(tracks)`, (pragmaErr, cols) => {
      if (pragmaErr) {
        console.error('Failed to inspect tracks table for migrations', pragmaErr.message);
        return;
      }
      const hasExistsOnDisk = Array.isArray(cols) && cols.some((c) => c.name === 'exists_on_disk');
      if (!hasExistsOnDisk) {
        database.run(`ALTER TABLE tracks ADD COLUMN exists_on_disk INTEGER DEFAULT 1`, (alterErr) => {
          if (alterErr) {
            console.error('Failed to add tracks.exists_on_disk column', alterErr.message);
          }
        });
      }
    });

    database.run(`
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

    database.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    database.run(
      `INSERT OR IGNORE INTO settings (key, value) VALUES
        ('playback.transition_mode', 'gap'),
        ('playback.gap_seconds', '2'),
        ('playback.crossfade_seconds', '2')`,
    );

    database.run(`
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id TEXT NOT NULL DEFAULT ''
      )
    `);

    database.all(`PRAGMA table_info(folders)`, (pragmaErr, cols) => {
      if (pragmaErr) {
        console.error('Failed to inspect folders table for migrations', pragmaErr.message);
        return;
      }

      const hasParentId = Array.isArray(cols) && cols.some((c) => c.name === 'parent_id');
      if (hasParentId) {
        database.run(`UPDATE folders SET parent_id = '' WHERE parent_id IS NULL`);

        database.run(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_parent_name ON folders (parent_id, name COLLATE NOCASE)`
        );

        database.run(`CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders (parent_id)`);
        return;
      }

      // Migration from legacy folders schema (name globally UNIQUE, no parent_id)
      database.run('BEGIN IMMEDIATE TRANSACTION', (beginErr) => {
        if (beginErr) {
          console.error('Failed to start folders migration transaction', beginErr.message);
          return;
        }

        database.run(
          `CREATE TABLE IF NOT EXISTS folders__migrated (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT NOT NULL DEFAULT ''
          )`,
          (createErr) => {
            if (createErr) {
              console.error('Failed to create folders migration table', createErr.message);
              database.run('ROLLBACK');
              return;
            }

            database.run(
              `INSERT OR IGNORE INTO folders__migrated (id, name, parent_id)
               SELECT id, name, '' FROM folders`,
              (copyErr) => {
                if (copyErr) {
                  console.error('Failed to copy legacy folders data', copyErr.message);
                  database.run('ROLLBACK');
                  return;
                }

                database.run(`DROP TABLE folders`, (dropErr) => {
                  if (dropErr) {
                    console.error('Failed to drop legacy folders table', dropErr.message);
                    database.run('ROLLBACK');
                    return;
                  }

                  database.run(`ALTER TABLE folders__migrated RENAME TO folders`, (renameErr) => {
                    if (renameErr) {
                      console.error('Failed to rename migrated folders table', renameErr.message);
                      database.run('ROLLBACK');
                      return;
                    }

                    database.run(
                      `CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_parent_name ON folders (parent_id, name COLLATE NOCASE)`,
                      (idxErr) => {
                        if (idxErr) {
                          console.error('Failed to ensure folders unique index', idxErr.message);
                          database.run('ROLLBACK');
                          return;
                        }

                        database.run(
                          `CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders (parent_id)`,
                          (idx2Err) => {
                            if (idx2Err) {
                              console.error('Failed to ensure folders parent index', idx2Err.message);
                              database.run('ROLLBACK');
                              return;
                            }

                            database.run('COMMIT', (commitErr) => {
                              if (commitErr) {
                                console.error('Failed to commit folders migration', commitErr.message);
                              }
                            });
                          }
                        );
                      }
                    );
                  });
                });
              }
            );
          }
        );
      });
    });

    database.run(`
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

    database.all("SELECT name FROM sqlite_master WHERE type='table'", (e, rows) => {
      if (e) {
        console.error('Failed to inspect database tables for index creation', e.message);
        return;
      }
      const existingTables = new Set(rows.map((r) => r.name));
      indexSpecs.forEach(({ sql, table }) => {
        if (!existingTables.has(table)) return;
        database.run(sql, (err2) => {
          if (err2) {
            console.error('Failed to ensure index:', sql, err2.message);
          }
        });
      });
    });
  });
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
ensureCoreSchema(db);

export async function reconnectDatabase() {
  const previous = db;
  await new Promise((resolve) => previous.close(() => resolve()));
  db = await openDatabaseConnection();
  ensureCoreSchema(db);
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
