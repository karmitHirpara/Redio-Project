# Quick Setup Guide

This file is a **short version** of the setup instructions. See `README.md` for more detail.

## Prerequisites

- Node.js v18+ installed
- Terminal / command line access

Recommended:

- Windows PowerShell

## 1. Install Dependencies

From the project root:

```bash
npm install
npm install --prefix server
```

## 2. Web Mode (Browser)

```bash
# Start backend + frontend together
npm run dev
```

Web UI will run on: **http://localhost:5173**

First run only (creates demo DB in `server/database.sqlite`):

```bash
npm run init-db
```

Backend will run on: **http://localhost:3001**

## 3. Desktop Mode (Electron)

```bash
npm run dev:desktop
```

Desktop mode runs the backend embedded inside Electron and stores runtime data in OS user data:

- SQLite DB: `%APPDATA%/radio-automation-frontend/data/database.sqlite`
- Uploads: `%APPDATA%/radio-automation-frontend/uploads`

## Desktop Licensing (required for packaged builds)

Packaged desktop builds require:

- `license.json` (signed)
- `activation.json` (signed)

These are verified locally by the app on startup.

### Where to put files (client)

The app will use `%APPDATA%/radio-automation-frontend/` automatically:

- `%APPDATA%/radio-automation-frontend/license.json`
- `%APPDATA%/radio-automation-frontend/activation.json`

Convenience: you can also place `license.json` and `activation.json` **beside the installed `.exe`**. On startup the app copies them into `%APPDATA%`.

### Key setup (vendor)

You must keep the private key secret:

- `keys/license-private.pem` (vendor only)
- `electron/license-public.pem` (bundled in the app, used for verification)

If you regenerate keys, update `electron/license-public.pem` before building the desktop app.

### Step-by-step flow

#### A) Vendor: create a license

Create an activation-mode license:

```bash
node scripts/generate-license.cjs --licenseId REDIO-123 --maxActivations 2 --privateKey .\\keys\\license-private.pem --out .\\license.json
```

Send to client:

- `license.json`

#### B) Client: generate activation request

1. Install and start the desktop app.
2. When you see **Activation Required**, click:
   - `Save activation-request.json`

Send to vendor:

- `activation-request.json`

#### C) Vendor: create activation.json

```bash
node scripts/generate-activation.cjs --request .\\activation-request.json --license .\\license.json --privateKey .\\keys\\license-private.pem --registry .\\activation-registry.json --out .\\activation.json
```

Send to client:

- `activation.json`

#### D) Client: import activation.json

In the app, click:

- `Select activation.json`

After import, the app should start normally.

### About activation-registry.json (vendor-side)

`activation-registry.json` tracks which fingerprints have been activated for each `licenseId`.

Important behavior:

- The first activated fingerprint becomes the `ownerFingerprint` for that `licenseId`.
- If you try to activate the same `licenseId` for a different fingerprint later, activation can be rejected.

To move the license to another PC:

- Use a new `licenseId`, or
- Delete/rename `activation-registry.json` to reset tracking (vendor-side).

### Development bypass

- Licensing is not enforced during development.
- You can bypass licensing in packaged builds for troubleshooting with:
  - `REDIO_LICENSE_BYPASS=1`

## 4. Verify

1. Open `http://localhost:3001` – you should see API info JSON.  
2. Open `http://localhost:3001/health` – should return `{ "status": "ok" }`.  
3. Open `http://localhost:5173` – the app should load with demo tracks and playlists.

## Common Issues

### Port 3001 already in use

```bash
# Change PORT in server/.env to another port, e.g.
PORT=3002
```

### Vite port 5173 already in use (Desktop dev)

`npm run dev:desktop` expects Vite on `http://localhost:5173`. If it is busy, free it before running Electron:

```powershell
netstat -ano | findstr :5173
taskkill /PID <PID> /F
```

### Database errors

```bash
cd server
rm database.sqlite
node scripts/init-db.js
```

### sqlite3 native module errors (Windows)

If you see errors like `node_sqlite3.node is not a valid Win32 application`, run:

```bash
npm run rebuild:electron
```

If you need to build sqlite3 from source, install Python 3.11 (x64) and point npm to it:

```powershell
py -0p
npm config set python "C:\\...\\Python311\\python.exe"
```

### Desktop packaging icon errors

Windows installers require a valid multi-size `.ico` (must include 256x256). Replace `build/icons/icon.ico` with a proper 256x256+ ICO.

### CORS errors

Make sure `CORS_ORIGIN` in `server/.env` matches your frontend URL (e.g. `http://localhost:5173`).

## Next Steps

1. Upload your audio files via the Library panel.  
2. Create playlists and add tracks from the Library or by importing into the playlist editor.  
3. Build your queue and schedule playlists.  
4. Start broadcasting!

## Production Deployment

See `README.md` (Deployment section) for notes on deploying the backend and frontend.
