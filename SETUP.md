# Quick Setup Guide

This file is a **short version** of the setup instructions. See `README.md` for more detail.

## Prerequisites

- Node.js v18+ installed
- Terminal / command line access

## 1. Backend Setup

```bash
# From project root
cd server

# Install backend dependencies
npm install

# Create environment file (server/.env)
cat > .env << 'EOF'
PORT=3001
DATABASE_PATH=./database.sqlite
UPLOAD_PATH=./uploads
CORS_ORIGIN=http://localhost:5173
EOF

# Initialize database (creates tables + demo data)
node scripts/init-db.js

# Start backend server (with file watching)
npm run dev
```

Backend will run on: **http://localhost:3001**

## 2. Frontend Setup

```bash
# From project root
cd ..

# Install frontend dependencies
npm install

# Start Vite dev server
npm run dev
```

Frontend will run on: **http://localhost:5173** (Vite) and proxy `/api` to `http://localhost:3001`.

## 3. Verify Installation

1. Open `http://localhost:3001` – you should see API info JSON.  
2. Open `http://localhost:3001/health` – should return `{ "status": "ok" }`.  
3. Open `http://localhost:5173` – the app should load with demo tracks and playlists.

## Common Issues

### Port 3001 already in use

```bash
# Change PORT in server/.env to another port, e.g.
PORT=3002
```

### Database errors

```bash
cd server
rm database.sqlite
node scripts/init-db.js
```

### CORS errors

Make sure `CORS_ORIGIN` in `server/.env` matches your frontend URL (e.g. `http://localhost:5173`).

## Next Steps

1. Upload your audio files via the Library panel.  
2. Create playlists and add tracks from the Library or by importing into the playlist editor.  
3. Build your queue and schedule playlists.  
4. Start broadcasting!

## Production Deployment

See `README.md` (Deployment section) for notes on deploying the backend and frontend.
