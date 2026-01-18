import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(dirname(__dirname), process.env.DATABASE_PATH || 'database.sqlite');

const db = new sqlite3.Database(dbPath);

console.log('Running migration to drop UNIQUE constraint on tracks.hash...');

db.serialize(() => {
  db.run('BEGIN TRANSACTION');

  db.run(`
    CREATE TABLE tracks_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      duration INTEGER NOT NULL,
      size INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      hash TEXT NOT NULL,
      date_added DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    INSERT INTO tracks_new (id, name, artist, duration, size, file_path, hash, date_added)
    SELECT id, name, artist, duration, size, file_path, hash, date_added
    FROM tracks
  `);

  db.run('DROP TABLE tracks');
  db.run('ALTER TABLE tracks_new RENAME TO tracks');

  db.run('COMMIT', (err) => {
    if (err) {
      console.error('Migration failed:', err.message);
    } else {
      console.log('Migration completed successfully.');
      console.log(`Database: ${dbPath}`);
    }
    db.close();
  });
});
