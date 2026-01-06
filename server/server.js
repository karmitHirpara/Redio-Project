import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path, { dirname, join } from 'path';
import fs from 'fs';
import http from 'http';
import { WebSocketServer } from 'ws';
import { runSchedulerTick } from './services/scheduler.js';

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
export const backendPort = PORT;

// Ensure uploads directory exists. If UPLOAD_PATH is absolute (as provided by
// the Electron main process for packaged builds), use it directly; otherwise
// resolve relative to this file for dev/server usage.
const rawUploadPath = process.env.UPLOAD_PATH || 'uploads';
const uploadsDir = path.isAbsolute(rawUploadPath)
  ? rawUploadPath
  : join(__dirname, rawUploadPath);

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'null',
]);

for (const origin of String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)) {
  allowedOrigins.add(origin);
}

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const token = req.headers['x-redio-client'];
  if (token !== 'redio-desktop') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  return next();
});

// Static files for audio uploads
app.use(
  '/uploads',
  express.static(uploadsDir, {
    dotfiles: 'deny',
    index: false,
    fallthrough: false,
    redirect: false,
  }),
);

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

const isLoopbackAddress = (addr) => {
  if (!addr || typeof addr !== 'string') return false;
  // IPv6 loopback may appear as ::1 or ::ffff:127.0.0.1
  return addr === '127.0.0.1' || addr === '::1' || addr.startsWith('::ffff:127.0.0.1');
};

const broadcastEvent = (event) => {
  const payload = JSON.stringify(event);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  });
};

app.set('broadcastEvent', broadcastEvent);

wss.on('connection', (socket, req) => {
  try {
    const origin = req?.headers?.origin;
    const remote = req?.socket?.remoteAddress;

    // Only accept loopback connections. This prevents LAN access.
    if (!isLoopbackAddress(remote)) {
      socket.terminate();
      return;
    }

    // Origin may be "null" for file:// (packaged Electron).
    const isFileOrigin = typeof origin === 'string' && origin.startsWith('file://');
    if (origin && !isFileOrigin && !allowedOrigins.has(origin)) {
      socket.terminate();
      return;
    }
  } catch {
    socket.terminate();
    return;
  }

  console.log('WebSocket client connected');

  socket.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

// Start server
let schedulerInterval = null;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 Radio Automation Server running on port ${PORT}`);
  console.log(`📡 API available at http://localhost:${PORT}`);
  console.log(`🎵 Upload directory: ${uploadsDir}`);
  console.log(`🌐 CORS enabled for: ${process.env.CORS_ORIGIN}`);
  console.log(`🔌 WebSocket endpoint: ws://localhost:${PORT}/ws`);

  // Lightweight backend scheduler for datetime playlists. Default to a
  // 1s interval so fired schedules line up closely with the visible clock.
  const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS || 1000);
  console.log(`⏱️  Scheduler running every ${intervalMs}ms`);
  schedulerInterval = setInterval(() => {
    runSchedulerTick(app).catch((err) => {
      console.error('Scheduler tick error', err);
    });
  }, intervalMs);
});

export const stopBackend = async () => {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }

  return new Promise((resolve) => {
    try {
      wss.close();
    } catch {
      // ignore
    }

    server.close(() => {
      resolve();
    });
  });
};

export default server;
