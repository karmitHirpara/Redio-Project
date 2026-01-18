import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(dirname(__dirname), process.env.DATABASE_PATH || 'database.sqlite');

const db = new sqlite3.Database(dbPath);

console.log('Running migration to add original_filename column to tracks...');

db.serialize(() => {
  db.run('BEGIN TRANSACTION');

  db.run('ALTER TABLE tracks ADD COLUMN original_filename TEXT', (err) => {
    if (err && !/duplicate column/i.test(err.message)) {
      console.error('Failed to add original_filename column:', err.message);
    }
  });

  // Backfill original_filename from file_path basename if empty
  db.each('SELECT id, file_path, original_filename FROM tracks', (err, row) => {
    if (err) {
      console.error('Error reading tracks for backfill:', err.message);
      return;
    }
    if (!row.original_filename && row.file_path) {
      const base = path.basename(row.file_path);
      db.run('UPDATE tracks SET original_filename = ? WHERE id = ?', [base, row.id]);
    }
  }, () => {
    db.run('COMMIT', (err2) => {
      if (err2) {
        console.error('Migration commit failed:', err2.message);
      } else {
        console.log('Migration completed successfully.');
        console.log(`Database: ${dbPath}`);
      }
      db.close();
    });
  });
});
