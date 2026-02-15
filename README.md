# Radio Automation System

A broadcast-grade radio automation platform with a modern React UI and a lightweight Node + SQLite backend.

## 🎯 Overview

This system delivers complete radio-style automation: audio library management, playlists, a flexible play queue, real-time scheduling, seamless playback with crossfades, and detailed playback history. All clients stay synchronized via WebSockets.

## ✅ Features (short)

- **Library**: upload/import audio, duplicate detection (SHA-256), folder organization
- **Playlists**: create/lock/duplicate, drag-to-reorder editor
- **Queue**: drag-and-drop ordering, accurate clock timings, real-time sync
- **Scheduling**: datetime schedules + song-trigger schedules
- **Playback**: crossfade/fade controls, play/pause/skip
- **History**: detailed playback logs + export
- **Desktop app**: packaged Electron app with embedded backend

## 🚀 Core Features

### Library

- **VS Code-like Selection**: Shift+Click (range), Cmd/Ctrl+Click (toggle), Drag Selection.
- **Batch Operations**: Multi-delete, multi-drag & drop.
- **Folder Management**: Nested folders, drag-to-restructure.
- Upload audio into folders
- Duplicate detection via file hashing
- Auto-named alias handling (e.g. `Song`, `Song (1)`, `Song (2)`)
- Smart folder imports without overwriting existing tracks

### Upload constraints

- Max size: configurable (defaults to **unlimited**)
- Allowed extensions: `.mp3`, `.wav`, `.ogg`, `.m4a`, `.flac`
- Duplicate detection uses **SHA-256 hashing**.
- All filesystem access is guarded against path traversal.

Optional backend env vars for large uploads:

- `MAX_UPLOAD_BYTES`
  - `0` (default) = unlimited
  - set to a number of bytes to enforce a cap
- `REQUEST_TIMEOUT_MS`
  - `0` disables Node request timeout (recommended for multi-GB uploads)

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

- **UI Overhaul**: Modern "Plan" view with timeline summary.
- Datetime schedules interrupt playback at exact IST time, prepend playlist tracks, and resume remaining queue
- Song-trigger schedules fire before/after a specific queue item
- Automatic 1-minute warning toast before datetime schedules
- **Quick Selects**: "Now", "Tomorrow", +15m, +1h buttons.

### Playback

- Single-element audio engine
- Fade-in and fade-out via adjustable crossfade slider
- Play / Pause / Skip controls

### Playback History

- Logs every play instance (including duplicates and scheduled plays)
- Tracks start/end times and completion status
- **Enhanced UI**: Grouped by date (descending), sticky headers, Excel export.
- **State Retention**: Remembers expanded days and scroll position.

### UI / Theme

- Built with modern React components
- Supports Dark (default) and Light themes
- Floating, draggable Queue dialog (resizeable, lock mode)
- Resizable playlist sidebar (always visible) with smooth performance
- Improved input contrast for better readability in both themes
- Confirmation dialogs for critical actions (ESC/outside-click to dismiss)
- Output device warnings only show when a specific device is missing
- Professional visual polish: consistent button styling, hover states, and spacing

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
npm install --prefix server
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
npm run init-db
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

In Desktop mode, the backend runs embedded inside Electron and stores runtime data in OS user data:

- SQLite DB: `%APPDATA%/radio-automation-frontend/data/database.sqlite`
- Uploads: `%APPDATA%/radio-automation-frontend/uploads`

To build a packaged desktop app:

```bash
npm run build:desktop
```

If native modules (sqlite3) fail to load after dependency changes:

```bash
npm run rebuild:electron
```

Windows packaging note: installers require a valid multi-size `.ico` (must include 256x256).

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

## 🔐 Desktop Licensing (Offline activation)

Packaged desktop builds require:

- `license.json` (signed)
- `activation.json` (signed)

### Where the app looks for these files

- Primary location (auto-managed): `%APPDATA%/radio-automation-frontend/`
- Convenience: you can also place `license.json` and `activation.json` next to the installed `.exe` and the app will copy them into `%APPDATA%`.

### Flow (high level)

- Client installs and starts the app
- App shows **Activation Required** and can save `activation-request.json`
- Vendor generates `activation.json` using the request + the vendor private key

Full step-by-step commands are in `SETUP.md`.

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

## 🎛️ UI Schema Design

### Primary entities

- **Track**: audio item with name/artist/duration/filePath/hash.
- **Playlist**: ordered list of tracks, can be locked.
- **QueueItem**: a scheduled/ordered playback item (references a track, allows duplicates).
- **ScheduledPlaylist**: triggers a playlist insertion (datetime or song-trigger).
- **LibraryFolder**: flat folder grouping for library tracks.

### Layout

- **Top bar**
  - IST clock
  - History
  - Theme toggle
  - Output device selector (Audio Guard)
- **Left panel: Library**
  - Folder list
  - Track list (virtualized)
  - Upload/import into library or folder
- **Center panel: Playlists**
  - Playlist navigator (create/rename/duplicate/lock)
  - Playlist editor (drag reorder, import files, play now, queue)
  - Schedule actions
- **Right panel: Queue**
  - Drag-and-drop ordering
  - Pinned currently playing item
  - Estimated start/end times
- **Bottom bar: Playback**
  - Play/pause/skip
  - Seek bar
  - Crossfade control

### Core flows

- **Import track(s)**
  - Upload via Library or Playlist
  - Backend stores file under uploads directory and records metadata + hash
  - Frontend refreshes tracks and shows duplicate prompts when needed
- **Build a playlist**
  - Create playlist
  - Add tracks from Library/Queue
  - Reorder via drag-and-drop
- **Play & queue**
  - Queue items can be reordered; current item remains pinned
  - Playback bar drives the audio engine and reports progress back to App state
- **Scheduling**
  - Datetime schedules preempt playback and prepend playlist tracks
  - Song-trigger schedules insert before/after a chosen queue item
  - Backend scheduler emits WebSocket updates; UI stays in sync

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

### Very large uploads (2GB+)

If you deploy behind a reverse proxy (Nginx/Caddy), ensure it allows large request bodies and long-running uploads:

- Increase/disable body size limits.
- Increase proxy timeouts.
- Consider disabling proxy request buffering for streaming uploads.

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

- Deploy the `dist/` folder.
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