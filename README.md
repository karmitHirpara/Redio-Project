# Radio Automation System

Broadcast-style radio automation with a modern React UI and a simple Node/SQLite backend.

## 🎯 Core Features

- **Library Management**  
  Upload audio, detect duplicates by file hash, and auto-name extra copies (**Song**, **Song 2**, **Song 3**, …).

- **Playlist System**  
  Create, lock/unlock, duplicate playlists. Edit tracks in a right-side editor with drag-and-drop reordering and track numbers.

- **Smart Queue**  
  Drag-and-drop queue with duplicate-prevention (same track cannot be added twice), clear error toasts, and optional repeat of the queue.

- **Scheduling**  
  Schedule playlists by **date/time** or as a **song-trigger** (before/after a specific queue item). Includes 1‑minute warning toasts and toasts when schedules actually start.

- **Playback**  
  Single audio element playback bar with crossfade-style fade-in/out near track edges, live indicator, and basic controls.

- **Real-time Events**  
  WebSocket channel from backend → frontend emitting `queue-updated` events when the queue changes.

- **Theme Support**  
  Toggle between *default* (dark) and *light* themes.

## 🛠️ Tech Stack

### Frontend

- **React 18** + **TypeScript**
- **Vite 5** dev server/bundler
- **Tailwind CSS 3** for styling
- **Framer Motion** for animations
- **shadcn/ui** primitives (buttons, dialogs, etc.)
- **Lucide React** icons
- **Sonner** for toast notifications

### Backend

- **Node.js** (Express)
- **SQLite** via `sqlite3`
- **Multer** for uploads
- **ws** WebSocket server
- **uuid** for IDs
- **dotenv** for config

## 📋 Prerequisites

- **Node.js** v18+  
- **npm** (comes with Node)

## 🚀 Installation & Setup (Local)

> For a step‑by‑step quick start, see **SETUP.md**. Below is the summary.

### 1. Install dependencies

From the project root:

```bash
# Frontend deps
npm install

# Backend deps
cd server
npm install
cd ..
```

### 2. Backend environment

Create `server/.env` with:

```env
PORT=3001
DATABASE_PATH=./database.sqlite
UPLOAD_PATH=./uploads
CORS_ORIGIN=http://localhost:5173
```

### 3. Initialize database

```bash
cd server
node scripts/init-db.js
cd ..
```

### 4. Run dev servers

Backend (port 3001):

```bash
cd server
npm run dev
```

Frontend (port 5173):

```bash
cd ..   # project root if needed
npm run dev
```

Vite is configured to proxy `/api` and `/uploads` to `http://localhost:3001`.

## 📁 Project Structure (simplified)

```text
Redio Project/
├── App.tsx                  # Main React app wiring panels & state
├── components/              # React UI components
│   ├── LibraryPanel.tsx
│   ├── PlaylistManager.tsx
│   ├── PlaylistEditor.tsx
│   ├── QueuePanel.tsx
│   ├── PlaybackBar.tsx
│   ├── SchedulePlaylistDialog.tsx
│   └── ui/                  # Button, Input, Slider, Dialog, etc.
├── hooks/                   # Custom hooks (theme, resizable panels)
├── lib/                     # Utilities (formatDuration, generateId, ...)
├── types/                   # Shared TypeScript interfaces
├── server/                  # Backend API
│   ├── server.js            # Express + WebSocket server
│   ├── config/database.js   # SQLite helpers
│   ├── routes/
│   │   ├── tracks.js        # Uploads, duplicate detection, alias tracks
│   │   ├── playlists.js     # Playlists + playlist_tracks
│   │   ├── queue.js         # Queue + queue-updated events
│   │   ├── schedules.js     # Scheduling
│   │   └── history.js       # Playback history
│   └── scripts/
│       └── init-db.js       # Creates tables + demo data
└── README.md, SETUP.md      # Docs
```

## 🧠 High-level Architecture & Data Flow

- **Frontend (React/Vite)**
  - `App.tsx` is the main orchestrator.
    - Loads **tracks**, **playlists**, **queue**, and **schedules** from the backend on startup.
    - Manages playback state: `currentTrackId`, `isPlaying`, `nowPlayingStart`, `crossfadeSeconds`.
    - Wires three main panels and the playback bar:
      - **LibraryPanel** – imports/organises tracks and folders.
      - **PlaylistManager** – CRUD, locking, duplication, and scheduling.
      - **QueuePanel** – live queue view with timing for each item.
      - **PlaybackBar** – single `<audio>` element, crossfade-style fading, and transport controls.
    - Uses `useQueueTiming` to estimate **start/end time for each queue item** based on wall‑clock and crossfade.
    - Maintains a lightweight top‑center **clock** (`nowIst`) which is used both for display and to drive datetime schedules.

- **Backend (Express + SQLite)**
  - `server.js` exposes `/api/*` routes and a `/ws` WebSocket endpoint.
  - Routes encapsulate domain logic:
    - `tracks.js` – upload, duplicate detection, alias creation.
    - `playlists.js` – playlists and playlist_tracks.
    - `queue.js` – queue CRUD + `queue-updated` events over WebSocket.
    - `schedules.js` – create/list/update/delete schedules.
    - `history.js` – playback history create/update/actions.
  - All persistent state (tracks, playlists, queue, schedules, history) lives in SQLite; the React app is effectively a **thin client** on top.

Typical flow:

1. Tracks are uploaded → stored as `tracks` rows.
2. Playlists reference tracks via `playlist_tracks`.
3. Queue holds a sequence of `queue` rows, each pointing at a track.
4. Playback runs from the queue; as tracks start and finish, `App.tsx` logs listening time to `playback_history`.
5. Schedules, when due, manipulate the queue (prepending scheduled playlist tracks) and are marked `completed`.

## 🔌 Backend Responsibilities (high level)

### Tracks

- Stores uploaded audio files and their metadata (name, artist, duration, size, file path, hash).
- Detects duplicate audio by file hash and supports creating *alias* tracks that point to the same file with auto‑renamed titles.
- Deleting a track also cleans up related queue and playlist entries via database relations.

### Playlists

- Manages creation, renaming, locking/unlocking, duplication, and deletion of playlists.
- Keeps an ordered list of tracks per playlist and persists this order in the database.
- Supports attaching/removing tracks and reordering them.

### Queue

- Stores the current play queue as an ordered list of items referencing tracks.
- Supports adding, removing, reordering, and clearing queue items.
- Emits `queue-updated` events over WebSocket when the queue changes so connected clients can stay in sync.

### Schedules

- Persists playlist schedules, both **datetime** and **song-trigger** types, including their status (`pending`, `completed`).
- Provides the data the frontend uses to show upcoming schedules and to decide when to start scheduled playlists.

### Playback History

- Records how long each track has actually been listened to (start/end positions, completed flag, source, file status).
- Allows existing history rows to be updated so multiple listens to the same track in one session can be accumulated.

## 🎨 Usage Guide

### 1. Upload tracks (with smart duplicates)

1. Go to **Library** (left panel).
2. Click **Add Audio** and select one or more audio files.
3. For each file:
   - If it’s new → added to the library.
   - If it’s a duplicate (same hash):
     - You’ll see a dialog: **Skip** or **Add copy**.
     - **Add copy** creates an alias entry with auto name (e.g. `Song 2`) pointing to the same file.

### 2. Manage playlists

1. Use the **Playlist Manager** (center).
2. Create playlists, rename, lock/unlock, duplicate.
3. Add songs:
   - From Library (context menu / add button) – now persisted to backend.
   - By importing files directly in the playlist editor; those tracks are also saved to the library.
4. Open a playlist → right editor panel:
   - Drag the grip icon to reorder tracks.
   - See track numbers and total duration.

### 3. Build and control the queue

1. Add tracks from Library or from playlists.
2. Queue refuses to add the **same track twice**, and shows a toast instead.
3. Drag to reorder the queue; backend is updated.
4. Optional **Repeat** button in the playback bar repeats the queue when it ends.

### 4. Schedule playlists

1. Schedule a playlist (via Playlist Manager UI):
   - **Datetime** – start at a specific time.
   - **Song-trigger** – start before/after a specific queue song.
2. You’ll see:
   - A **1‑minute warning** toast for upcoming datetime schedules.
   - A toast when a schedule actually starts (both datetime and song-trigger).

### 5. Playback controls

1. Use the bottom **Playback Bar** to play/pause/skip.
2. Crossfade slider controls the fade window (~2–3s max) used for fade-in at the start and fade-out at the end of tracks.
3. The `LIVE` badge indicates live mode; pausing shows a confirmation dialog.

## ⏱ Time & Scheduling Semantics

- **Display timezone**
  - All user‑visible times (clock, queue, schedules, history) are formatted in **IST** (`Asia/Kolkata`) with uppercase `AM/PM`.

- **Top bar clock**
  - `App.tsx` maintains `nowIst` with a 1‑second interval.
  - This same clock drives both the visual clock and datetime schedule evaluation, so operators see what the scheduler sees.

- **Datetime schedules**
  - Created via **Schedule Playlist** → `POST /api/schedules` with `type: 'datetime'` and a `date_time`.
  - On the frontend, `App.tsx` polls this list and holds it in `scheduledPlaylists`.
  - Every second, a `useEffect`:
    - Sends a **1‑minute warning toast** when a pending datetime schedule is within 60s.
    - Finds all schedules where `dateTime <= nowIst` and `status === 'pending'`.
    - For each due schedule:
      - Looks up the playlist and builds a list of `QueueItem`s for its tracks.
  - Due schedules **preempt** the queue:
    - If a track is currently playing:
      - It is removed from the queue.
      - Its listening time so far is logged as a **partial history** row (`completed: false`).
    - All scheduled playlist items are **prepended** to the queue.
    - Playback immediately jumps to the first scheduled track and starts playing.
    - Schedules are updated to `status = 'completed'` both locally and via `PUT /api/schedules/:id`.
  - When the scheduled playlist finishes, playback continues with the remaining queue items. The interrupted song is **not** resumed.

- **Song‑trigger schedules**
  - When `handleNext` moves off a queue item, any `song-trigger` schedules tied to that queue row are detected.
  - The scheduled playlist tracks are inserted before/after the remaining queue according to `triggerPosition`, and the schedule status is updated.

## 📜 Playback History Semantics

- `App.tsx` maintains an in‑memory map `historySessions: trackId → { id, seconds }` for the current browser session.
- When leaving a track (user skip, natural end, or schedule preemption), `logPlaybackHistory`:
  - Computes **elapsed wall‑clock time** since `nowPlayingStart`.
  - If no history session exists for that track yet:
    - Creates a new `playback_history` row via `POST /api/history` with
      - `positionStart = 0`, `positionEnd = elapsedSeconds`.
  - If a session already exists:
    - Extends the existing row via `PUT /api/history/:id`, updating `positionEnd` with the **cumulative** seconds and optionally `completed`.
- This means repeated plays of the same track in one app session are **accumulated** in a single history row, unless the browser is refreshed.

History UI:

- `HistoryDialog.tsx` polls `/api/history` while open and shows a simple list:
  - Song name
  - Start time
  - End time (derived from `positionEnd` and `positionStart`)
  - Grouped by local calendar date.

## 🔧 Configuration

### Theme

Use the theme toggle in the top-right to switch between **default** (dark) and **light**.

## 📈 Reliability & Operational Notes

- **Scheduler lifetime**
  - Datetime schedule evaluation currently runs **in the browser** (React `useEffect`), not as a cron on the server.
  - For schedules to fire on time, at least one browser session with the app open must be running. For 24/7 automation, keep a dedicated machine/tab open.

- **Queue & timing robustness**
  - `useQueueTiming` computes queue timings against wall‑clock and `nowPlayingStart` using `crossfadeSeconds` so that the queue panel shows realistic “will play at” times.
  - If `crossfadeSeconds` is changed, future items’ estimated times adjust automatically.

- **Default crossfade**
  - `crossfadeSeconds` defaults to **2s**, which is a good compromise between smooth transitions and timing accuracy.

- **Error handling**
  - Most network operations show a toast on failure and log to the console for diagnostics.
  - Playback history writes are best‑effort; failures do **not** stop playback but may result in missing history rows.

- **Auto-cleanup of scheduled UI**
  - The “Scheduled” panel in the right column auto‑hides ~3 seconds after there are no pending schedules left, to avoid UI clutter.

## 🐛 Troubleshooting

### Backend won't start
```bash
# Check if port 3001 is available
# On Mac/Linux:
lsof -i :3001

# On Windows:
netstat -ano | findstr :3001

# Kill the process or change PORT in .env
```

### Database errors

```bash
cd server
rm database.sqlite
node scripts/init-db.js
```

### File upload fails

```bash
cd server
mkdir -p uploads
chmod 755 uploads
```

### CORS errors

- Check `CORS_ORIGIN` in `server/.env`.
- Ensure it matches your frontend URL (e.g. `http://localhost:5173`).

## 📦 Database Schema

### tracks
- id (TEXT PRIMARY KEY)
- name (TEXT)
- artist (TEXT)
- duration (INTEGER)
- size (INTEGER)
- file_path (TEXT)
- hash (TEXT)
- date_added (DATETIME)

### playlists
- id (TEXT PRIMARY KEY)
- name (TEXT UNIQUE)
- locked (BOOLEAN)
- created_at (DATETIME)

### playlist_tracks
- playlist_id (TEXT)
- track_id (TEXT)
- position (INTEGER)

### queue
- id (TEXT PRIMARY KEY)
- track_id (TEXT)
- from_playlist (TEXT)
- order_position (INTEGER)
- added_at (DATETIME)

### schedules
- id (TEXT PRIMARY KEY)
- playlist_id (TEXT)
- type (TEXT)
- date_time (DATETIME)
- queue_song_id (TEXT)
- trigger_position (TEXT)
- status (TEXT)

## 🚢 Deployment

### Backend Deployment (Railway, Render, etc.)

1. Set environment variables from your local `.env`.
2. Mount or provision a persistent volume for the SQLite DB and `uploads/`, or switch to another DB.
3. Expose the Express server and (optionally) WebSocket endpoint.

### Frontend Deployment (Vercel, Netlify, etc.)

1. Build: `npm run build` from the project root.
2. Deploy the `dist/` folder.
3. Configure an environment variable or proxy so `/api` points at your deployed backend.

## 🤝 Contributing

This is a production-ready system. Contributions are welcome:
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push and create a Pull Request

## 📄 License

MIT License - Free for personal and commercial use

## 🆘 Support

For issues or questions:
- Check the troubleshooting section
- Review API documentation
- Check console logs for errors

## 🎯 Roadmap

- [ ] User authentication
- [ ] Multi-station support
- [ ] Advanced audio processing
- [ ] Mobile app
- [ ] Cloud storage integration
- [ ] Analytics dashboard

---

**Built with ❤️ for radio professionals**
