import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import path, { dirname, join } from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rawDbPath = process.env.QUEUE_DATABASE_PATH || 'queue.sqlite';
const dbPath = path.isAbsolute(rawDbPath)
  ? rawDbPath
  : join(dirname(__dirname), rawDbPath);

export const resolvedQueueDbPath = dbPath;

const dbDir = dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

console.log('Queue SQLite DB path:', dbPath);

function ensureQueueSchema(database) {
  database.serialize(() => {
    database.run(`
      CREATE TABLE IF NOT EXISTS queue_items (
        id TEXT PRIMARY KEY,
        source_track_id TEXT,
        name TEXT,
        artist TEXT,
        duration INTEGER,
        size INTEGER,
        file_path TEXT,
        hash TEXT,
        from_playlist TEXT,
        order_position INTEGER NOT NULL,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    database.run('CREATE INDEX IF NOT EXISTS idx_queue_items_order ON queue_items (order_position)');
    database.run('CREATE INDEX IF NOT EXISTS idx_queue_items_source_track_id ON queue_items (source_track_id)');
  });
}

export let db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening queue SQLite database:', err.message);
    return;
  }
  console.log('Connected to queue SQLite database');
  ensureQueueSchema(db);
});

export async function reconnectQueueDatabase() {
  await new Promise((resolve) => {
    try {
      db.close(() => resolve());
    } catch {
      resolve();
    }
  });

  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Error reopening queue SQLite database:', err.message);
      return;
    }
    console.log('Reconnected to queue SQLite database');
    ensureQueueSchema(db);
  });
}

export function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

export function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

export default db;
