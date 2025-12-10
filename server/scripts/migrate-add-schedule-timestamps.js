import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(dirname(__dirname), process.env.DATABASE_PATH || 'database.sqlite');

const db = new sqlite3.Database(dbPath);

console.log('Running migration to add timestamp columns to schedules and playback_history...');

const runAlter = (sql, label) => {
  db.run(sql, (err) => {
    if (err) {
      if (/duplicate column/i.test(err.message)) {
        console.log(`- Column for ${label} already exists, skipping`);
      } else {
        console.error(`- Failed to apply migration step for ${label}:`, err.message);
      }
    } else {
      console.log(`- Added column(s) for ${label}`);
    }
  });
};

db.serialize(() => {
  db.run('BEGIN TRANSACTION');

  // Add timestamp columns to schedules if they do not exist yet.
  runAlter('ALTER TABLE schedules ADD COLUMN updated_at DATETIME', 'schedules.updated_at');
  runAlter('ALTER TABLE schedules ADD COLUMN fired_at DATETIME', 'schedules.fired_at');
  runAlter('ALTER TABLE schedules ADD COLUMN completed_at DATETIME', 'schedules.completed_at');

  // Ensure playback_history has updated_at as well (harmless if already present).
  runAlter('ALTER TABLE playback_history ADD COLUMN updated_at DATETIME', 'playback_history.updated_at');

  db.run('COMMIT', (err) => {
    if (err) {
      console.error('Migration commit failed:', err.message);
    } else {
      console.log('Migration for schedule timestamps completed successfully.');
      console.log(`Database: ${dbPath}`);
    }
    db.close();
  });
});
