# Production Setup + Project Structure (Redio)

This file explains:
- How the project is structured
- How to run backend + frontend locally
- How to deploy safely for production (web + backend)
- Notes for the Electron desktop build

## Project features (one-liners)

- **Audio library management**: upload, organize, and manage tracks with duplicate detection.
- **Playlists**: create/edit playlists and reorder tracks.
- **Queue**: build a live play queue with drag-and-drop ordering and accurate timing.
- **Scheduling**: schedule playlists by time or by song-trigger rules.
- **Playback**: playback controls with crossfade and live timing updates.
- **Playback history**: logs plays (including scheduled/duplicate plays) and supports export.
- **Output / export**: generate and export playback/history data for reporting.
- **Realtime sync**: clients stay in sync via WebSockets.

## Project structure

### Root (frontend + desktop build)

- `index.html`, `main.tsx`, `App.tsx`
  - Vite + React entrypoints.
- `components/`, `hooks/`, `services/`, `types/`
  - UI components, hooks, API client (`services/api.ts`), TypeScript types.
- `globals.css`, `tailwind.config.cjs`, `postcss.config.cjs`
  - Styling.
- `vite.config.ts`
  - Dev server + proxy rules (`/api` and `/uploads` -> `http://localhost:3001`).
- `electron/`
  - Electron wrapper for the desktop app.
- `dist/`
  - Production build output for the frontend (`npm run build:web`).
- `build/`
  - Desktop packaging assets/icons for Electron builder.

### Backend (`server/`)

- `server/server.js`
  - Express app + HTTP server + WebSocket server.
  - Routes mounted under `/api/*`.
  - WebSocket endpoint at `/ws`.
  - Static uploads served from `/uploads/*`.
- `server/routes/`
  - Feature routes: `tracks`, `playlists`, `queue`, `schedules`, `history`, `folders`.
- `server/services/`
  - Backend services (scheduler, etc.).
- `server/scripts/init-db.js`
  - Initializes SQLite schema and demo/seed data.
- `server/database.sqlite`
  - SQLite DB file (development default). In production you typically set `DATABASE_PATH` to an absolute path.
- `server/uploads/`
  - Uploaded audio files (development default). In production you typically set `UPLOAD_PATH` to an absolute path.

## Local development setup

### 1) Install dependencies

From project root:

```bash
npm install
npm install --prefix server
```

### 2) Configure backend env

Create `server/.env` (you can copy from `server/.env.example`):

```env
PORT=3001
DATABASE_PATH=./database.sqlite
UPLOAD_PATH=./uploads
CORS_ORIGIN=http://localhost:5173
# Optional
# SCHEDULER_INTERVAL_MS=1000
```

### 3) Initialize DB

```bash
npm run init-db
```

### 4) Run both servers

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`
- Vite proxies:
  - `/api/*` -> backend
  - `/uploads/*` -> backend

## Production deployment (recommended)

### Key production facts (important)

- The backend currently binds to **loopback only**:
  - `server.listen(PORT, '127.0.0.1', ...)`
  - This is great for the desktop app and for “single machine + reverse proxy” deployments.
  - It means you should typically run a reverse proxy (Nginx/Caddy) on the same server.
- SQLite + uploads must be **persistent**:
  - Put `DATABASE_PATH` and `UPLOAD_PATH` on a persistent disk/volume.
- WebSocket is required:
  - Backend WebSocket endpoint: `ws(s)://<host>/ws`
  - Your reverse proxy must support `Upgrade` headers.

### Important: keep `/uploads` on the same origin as the web frontend

In web mode (non-`file://`), the frontend resolves upload URLs like this:
- API calls default to `'/api'` (or `VITE_API_URL`)
- Upload playback URLs that start with `'/uploads/'` are resolved using `window.location.origin`

This means the **recommended production shape** is:
- Serve frontend and backend on the **same domain**, and proxy `/api`, `/uploads`, and `/ws` to the backend.

If you host frontend and backend on **different domains**, you must either:
- Configure a reverse proxy so the frontend domain can still serve `/uploads/*` and `/api/*`, or
- Update `services/api.ts` (`getBackendOrigin` / `resolveUploadsUrl`) to point to your backend origin.

### Option A (recommended): Reverse proxy + static hosting

This is the simplest reliable production setup.

- **Backend**: run Express on the server (private loopback port, e.g. `3001`).
- **Frontend**: serve the built `dist/` as static files (CDN, Nginx, Netlify, etc.).
- **Proxy**:
  - Route `https://your-domain.com/api/*` -> `http://127.0.0.1:3001/api/*`
  - Route `https://your-domain.com/uploads/*` -> `http://127.0.0.1:3001/uploads/*`
  - Route `wss://your-domain.com/ws` -> `ws://127.0.0.1:3001/ws`

#### Frontend build

```bash
npm run build:web
```

Deploy the `dist/` folder.

#### Frontend API configuration

Your frontend API client (`services/api.ts`) uses:
- Desktop (when loaded from `file://`): `http://localhost:3001/api`
- Web: `import.meta.env.VITE_API_URL || '/api'`

So for production web you have two clean choices:

1) **Use a reverse proxy and keep `VITE_API_URL` unset**
   - Frontend calls `/api` on the same domain.

2) **Set `VITE_API_URL` to your backend URL**
   - Example: `VITE_API_URL=https://api.your-domain.com/api`
   - If you do this, you must also configure `CORS_ORIGIN` on the backend.

### Backend production env

Create a production `.env` (do not commit it):

```env
PORT=3001
DATABASE_PATH=/var/lib/redio/database.sqlite
UPLOAD_PATH=/var/lib/redio/uploads
CORS_ORIGIN=https://your-domain.com
SCHEDULER_INTERVAL_MS=1000
```

Make sure the folders exist and are writable by the backend process.

### Process manager

Run the backend with a process manager so it restarts on crashes/reboots:

- `pm2` (common for Node)
- `systemd` (Linux)
- Docker (if you prefer containers)

Backend start command:

```bash
npm install --prefix server
npm run start --prefix server
```

## Production notes / pitfalls

### 1) Non-GET requests require `X-Redio-Client: redio-desktop`

The backend enforces a header check for `/api` on non-GET requests.
- Your frontend client already adds this header automatically for non-GET requests (see `services/api.ts`).
- If you build another client (mobile, external scripts), you must include this header or you’ll get `403`.

### 2) CORS must match your deployed frontend origin

Set `CORS_ORIGIN` to your real domain(s), comma-separated if needed:

```env
CORS_ORIGIN=https://redio.example.com,https://admin.redio.example.com
```

### 3) WebSocket proxy configuration is mandatory

If your reverse proxy doesn’t forward WebSocket upgrades, realtime sync will break.

### 4) SQLite scaling limits

SQLite is great for single-machine deployments.
If you need horizontal scaling or multiple servers, you’ll eventually want Postgres + shared object storage for uploads.

### 5) Netlify Functions note (serverless)

This repo includes `netlify/functions/api.mjs`, which wraps the Express app using `serverless-http`.

Be aware:
- Netlify Functions **do not support WebSockets**, so realtime sync via `/ws` will not work in a pure serverless deployment.
- SQLite + file uploads require **persistent local storage**, which is not a good match for ephemeral function filesystems.

If you want to use Netlify for the frontend:
- Deploy the frontend `dist/` to Netlify.
- Deploy the backend on a server/VPS/container with persistent storage.
- Proxy/route `/api`, `/uploads`, and `/ws` through the same public origin (recommended).

## Electron desktop production build (optional)

### Run desktop in development

```bash
npm run dev:desktop
```

### Build packaged desktop app

```bash
npm run build:desktop
```

Notes:
- Electron sets `DATABASE_PATH` and `UPLOAD_PATH` automatically into the per-user app data directory.
- The UI is loaded from `file://`, and `services/api.ts` automatically targets `http://localhost:3001/api`.

## Suggested deployment checklist

- [ ] Set production `server/.env` with absolute `DATABASE_PATH` and `UPLOAD_PATH`
- [ ] Ensure DB/uploads are on persistent disk + included in backups
- [ ] Put backend behind HTTPS reverse proxy
- [ ] Proxy `/api`, `/uploads`, and `/ws`
- [ ] Set `CORS_ORIGIN` to your frontend domain(s)
- [ ] Validate health:
  - `GET /health`
  - `GET /api/tracks`
  - WebSocket connects at `/ws`
