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

## 🔌 API Overview (backend)

### Tracks

- `GET /api/tracks` – List all tracks
- `GET /api/tracks/:id` – Get single track
- `POST /api/tracks/upload` – Upload an audio file  
  - Computes file hash, checks duplicates.  
  - On duplicate: returns `409` + `existingTrack` instead of storing a new file.
- `POST /api/tracks/alias` – Create another track row pointing to the **same file** (alias) with auto-renamed title.
- `DELETE /api/tracks/:id` – Delete track (and related queue/playlists entries via FK behavior).

### Playlists

- `GET /api/playlists` – All playlists with their tracks.
- `GET /api/playlists/:id` – Single playlist with tracks.
- `POST /api/playlists` – Create playlist.
- `PUT /api/playlists/:id` – Rename or lock/unlock playlist.
- `DELETE /api/playlists/:id` – Delete playlist.
- `POST /api/playlists/:id/tracks` – Attach one or more track IDs.
- `DELETE /api/playlists/:id/tracks/:trackId` – Remove track from playlist.
- `PUT /api/playlists/:id/reorder` – Reorder playlist tracks by track ID list.

### Queue

- `GET /api/queue` – Current queue items with track info.
- `POST /api/queue` – Add a track to queue (optionally with `fromPlaylist`).
- `PUT /api/queue/reorder` – Reorder queue by queue ID list.
- `DELETE /api/queue/:id` – Remove a specific item.
- `DELETE /api/queue` – Clear queue.

> Queue mutations also emit a `queue-updated` WebSocket event with the full queue payload.

### Schedules

- `GET /api/schedules` – List schedules (joined with playlist names).
- `POST /api/schedules` – Create schedule (datetime or song-trigger).
- `PUT /api/schedules/:id` – Update status (e.g. `completed`).
- `DELETE /api/schedules/:id` – Remove schedule.

### Playback History

- `POST /api/history` – Log completed track plays (best-effort; failures logged to console only).

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

## 🔧 Configuration

### Theme

Use the theme toggle in the top-right to switch between **default** (dark) and **light**.

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
