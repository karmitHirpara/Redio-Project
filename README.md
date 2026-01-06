# Radio Automation System

A broadcast-grade radio automation platform with a modern React UI and a lightweight Node + SQLite backend.

## 🎯 Overview

This system delivers complete radio-style automation: audio library management, playlists, a flexible play queue, real-time scheduling, seamless playback with crossfades, and detailed playback history. All clients stay synchronized via WebSockets.

## 🚀 Core Features

### Library

- Upload audio into folders
- Duplicate detection via file hashing
- Auto-named alias handling (e.g. `Song`, `Song (1)`, `Song (2)`)
- Smart folder imports without overwriting existing tracks

### Playlists

- Create, rename, lock/unlock, duplicate
- Drag-to-reorder playlist editor with duration totals
- Add tracks from Library, Queue, or by direct upload

### Queue

- Drag-and-drop ordering
- Allows intentional duplicates
- Shows accurate estimated start/end clock times
- Live "smart seek": dragging the playback bar instantly reflows current and upcoming track timings
- Real-time synchronization across all clients

### Scheduling

- Datetime schedules interrupt playback at exact IST time, prepend playlist tracks, and resume remaining queue
- Song-trigger schedules fire before/after a specific queue item
- Automatic 1-minute warning toast before datetime schedules

### Playback

- Single-element audio engine
- Fade-in and fade-out via adjustable crossfade slider
- Play / Pause / Skip controls

### Playback History

- Logs every play instance (including duplicates and scheduled plays)
- Tracks start/end times and completion status
- Exportable history view

### UI / Theme

- Built with modern React components
- Supports Dark (default) and Light themes

## 🛠️ Tech Stack

### Frontend

- React 18 + TypeScript
- Vite 5
- Tailwind CSS 3
- Framer Motion
- shadcn/ui
- Lucide Icons
- Sonner

### Backend

- Node.js (Express)
- SQLite (sqlite3)
- Multer (uploads)
- WebSockets (ws)
- uuid
- dotenv

## 📋 Prerequisites

- Node.js v18+
- npm

## ⚡ Installation

### 1. Install dependencies

```bash
npm install

cd server
npm install
cd ..
```

### 2. Create backend .env

```env
PORT=3001
DATABASE_PATH=./database.sqlite
UPLOAD_PATH=./uploads
# Optional (comma-separated). Defaults allow localhost + Origin: null (Electron file://).
CORS_ORIGIN=http://localhost:5173
```

### 3. Initialize database

```bash
cd server
node scripts/init-db.js
cd ..
```

### 4. Start servers

Backend:

```bash
npm run dev --prefix server
```

Frontend:

```bash
npm run dev
```

Vite automatically proxies `/api` and `/uploads`.

### Desktop (Electron)

The desktop app runs the backend embedded inside Electron.

```bash
npm run dev:desktop
```

To build a packaged desktop app:

```bash
npm run build:desktop
```

If native modules (sqlite3) fail to load after dependency changes:

```bash
npm run rebuild:electron
```

## 🔐 Security Notes (Desktop)

### Electron hardening

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- Navigation is restricted (no remote content). External `https:` links open in the OS browser.
- DevTools are disabled in packaged builds.

### Local server hardening

- The backend binds to loopback only: `127.0.0.1`.
- WebSocket connections are restricted to loopback clients.
- For non-GET requests to `/api`, the backend requires the header:
  - `X-Redio-Client: redio-desktop`
  - The frontend sends this automatically.

### Upload constraints

- Max size: **50MB**
- Allowed extensions: `.mp3`, `.wav`, `.ogg`, `.m4a`, `.flac`
- Duplicate detection uses **SHA-256 hashing**.
- All filesystem access is guarded against path traversal.

## 📁 Project Structure

```text
/
├── App.tsx
├── components/
│   ├── LibraryPanel.tsx
│   ├── PlaylistManager.tsx
│   ├── PlaylistEditor.tsx
│   ├── QueuePanel.tsx
│   ├── PlaybackBar.tsx
│   └── SchedulePlaylistDialog.tsx
├── hooks/
├── lib/
├── types/
├── server/
│   ├── server.js
│   ├── routes/
│   │   ├── tracks.js
│   │   ├── playlists.js
│   │   ├── queue.js
│   │   ├── schedules.js
│   │   └── history.js
│   └── scripts/
│       └── init-db.js
└── README.md
```

## 🧠 Architecture Summary

### Frontend

- Loads tracks, playlists, queue, and schedules on startup
- Maintains playback state and 1-second IST clock
- Auto-updates queue timing based on crossfade setting
- Panels: Library, Playlist Manager, Queue, Playback Bar

### Backend

- Express API + WebSocket realtime sync
- Persistent storage in SQLite
- Handles uploads, duplicate detection, queue operations, schedule execution, and history logging

## ⏱ Timing & Scheduling

### Timezone

- All times use IST (`Asia/Kolkata`).

### Datetime schedules

- When triggered:
  - Current song is interrupted
  - Partial play logged to history
  - Scheduled playlist tracks are prepended
  - Playback jumps into scheduled playlist
  - Schedule marked completed

### Song-trigger schedules

- Fire based on queue progression
- Insert playlist before/after targeted queue row

## 📦 Database Schema

### tracks

- id, name, artist, duration, size, file_path, hash, date_added

### playlists

- id, name, locked, created_at

### playlist_tracks

- playlist_id, track_id, position

### queue

- id, track_id, from_playlist, order_position, added_at

### schedules

- id, playlist_id, type, date_time, queue_song_id, trigger_position, status

### playback_history

- played_at, positionStart, positionEnd, completed, source, ...

## 🐛 Troubleshooting

### Port 3001 in use

```bash
lsof -i :3001        # mac/linux
netstat -ano | findstr :3001   # windows
```

### Reset database

```bash
cd server
rm database.sqlite
node scripts/init-db.js
```

### Upload errors

```bash
mkdir -p server/uploads
chmod 755 server/uploads
```

### CORS issues

- Check that `CORS_ORIGIN` matches frontend URL.

## 🚢 Deployment

### Backend

- Provide `.env` variables
- Use persistent volume for SQLite + uploads
- Expose Express + WebSocket endpoints

### Frontend

```bash
npm run build:web
```

- Deploy the `dist/` folder (Vercel, Netlify, etc.).
- Point `/api` to backend.


## 🎯 Roadmap

- User authentication
- Multi-station support
- Advanced audio processing
- Mobile app
- Cloud storage
- Analytics dashboard

---

Built with ❤️ for radio professionals.