import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import path, { dirname, join } from 'path';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rawDbPath = process.env.DATABASE_PATH || 'database.sqlite';
const dbPath = path.isAbsolute(rawDbPath) ? rawDbPath : join(dirname(__dirname), rawDbPath);

const dbDir = dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Remove existing database
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log('Removed existing database');
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Tracks table
  db.run(`
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      duration INTEGER NOT NULL,
      size INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      original_filename TEXT,
      hash TEXT NOT NULL,
      exists_on_disk INTEGER DEFAULT 1,
      cue_in REAL DEFAULT 0,
      cue_out REAL DEFAULT NULL,
      date_added DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Playlists table
  db.run(`
    CREATE TABLE playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      locked BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Playlist tracks junction table
  db.run(`
    CREATE TABLE playlist_tracks (
      playlist_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
      PRIMARY KEY (playlist_id, track_id)
    )
  `);

  // Queue table
  db.run(`
    CREATE TABLE queue (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL,
      from_playlist TEXT,
      order_position INTEGER NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
    )
  `);

  // Schedules table
  db.run(`
    CREATE TABLE schedules (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL,
      type TEXT NOT NULL,
      date_time DATETIME,
      queue_song_id TEXT,
      trigger_position TEXT,
      lock_playlist BOOLEAN DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME,
      fired_at DATETIME,
      completed_at DATETIME,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
    )
  `);

  // Playback history table
  db.run(`
    CREATE TABLE playback_history (
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

  // Indexes for performance
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_queue_order
    ON queue (order_position)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_schedules_status_date
    ON schedules (status, date_time)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_history_track_time
    ON playback_history (track_id, played_at)
  `);

  // Insert demo data
  console.log('Creating tables...');

  // Demo tracks
  const trackStmt = db.prepare(`
    INSERT INTO tracks (id, name, artist, duration, size, file_path, original_filename, hash, exists_on_disk)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const demoTracks = [
    ['track1', 'Summer Vibes', 'DJ Solar', 215, 5242880, '/demo/summer-vibes.mp3', 'summer-vibes.mp3', 'hash1', 0],
    ['track2', 'Midnight Drive', 'The Nocturnes', 198, 4718592, '/demo/midnight-drive.mp3', 'midnight-drive.mp3', 'hash2', 0],
    ['track3', 'Electric Dreams', 'Synthwave Station', 267, 6291456, '/demo/electric-dreams.mp3', 'electric-dreams.mp3', 'hash3', 0],
    ['track4', 'Morning Coffee', 'Acoustic Blend', 183, 4404019, '/demo/morning-coffee.mp3', 'morning-coffee.mp3', 'hash4', 0],
    ['track5', 'Rush Hour', 'Urban Beats', 201, 4823449, '/demo/rush-hour.mp3', 'rush-hour.mp3', 'hash5', 0]
  ];


  demoTracks.forEach(track => trackStmt.run(track));
  trackStmt.finalize();

  // Demo playlists
  const demoPlaylists = [
    ['playlist1', 'Morning Show', 0],
    ['playlist2', 'Evening Drive', 0],
    ['playlist3', 'Late Night Mix', 1]
  ];

  const playlistStmt = db.prepare(`
    INSERT INTO playlists (id, name, locked)
    VALUES (?, ?, ?)
  `);

  demoPlaylists.forEach(playlist => playlistStmt.run(playlist));
  playlistStmt.finalize();

  // Demo playlist tracks
  const demoPlaylistTracks = [
    ['playlist1', 'track4', 0],
    ['playlist1', 'track1', 1],
    ['playlist2', 'track2', 0],
    ['playlist2', 'track3', 1],
    ['playlist2', 'track5', 2]
  ];

  const playlistTrackStmt = db.prepare(`
    INSERT INTO playlist_tracks (playlist_id, track_id, position)
    VALUES (?, ?, ?)
  `);

  demoPlaylistTracks.forEach(pt => playlistTrackStmt.run(pt));
  playlistTrackStmt.finalize();

  console.log('Database initialized successfully!');
  console.log(`Location: ${dbPath}`);
});

db.close();
