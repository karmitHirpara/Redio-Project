import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import http from 'http';
import { WebSocketServer } from 'ws';

// Import routes
import tracksRouter from './routes/tracks.js';
import playlistsRouter from './routes/playlists.js';
import queueRouter from './routes/queue.js';
import schedulesRouter from './routes/schedules.js';
import historyRouter from './routes/history.js';
import foldersRouter from './routes/folders.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure uploads directory exists
const uploadsDir = join(__dirname, process.env.UPLOAD_PATH || 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files for audio uploads
app.use('/uploads', express.static(uploadsDir));

// API Routes
app.use('/api/tracks', tracksRouter);
app.use('/api/playlists', playlistsRouter);
app.use('/api/queue', queueRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/history', historyRouter);
app.use('/api/folders', foldersRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Radio Automation API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      tracks: '/api/tracks',
      playlists: '/api/playlists',
      queue: '/api/queue',
      schedules: '/api/schedules',
      history: '/api/history',
      folders: '/api/folders'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// HTTP server + WebSocket server
const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });

const broadcastEvent = (event) => {
  const payload = JSON.stringify(event);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  });
};

app.set('broadcastEvent', broadcastEvent);

wss.on('connection', (socket) => {
  console.log('WebSocket client connected');

  socket.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Radio Automation Server running on port ${PORT}`);
  console.log(`📡 API available at http://localhost:${PORT}`);
  console.log(`🎵 Upload directory: ${uploadsDir}`);
  console.log(`🌐 CORS enabled for: ${process.env.CORS_ORIGIN}`);
  console.log(`🔌 WebSocket endpoint: ws://localhost:${PORT}/ws`);
});
