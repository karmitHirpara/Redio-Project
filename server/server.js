import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path, { dirname, join } from 'path';
import fs from 'fs';
import http from 'http';
import { WebSocketServer } from 'ws';
import chokidar from 'chokidar';
import { runSchedulerTick } from './services/scheduler.js';
import { isS3UploadStorage, getS3PublicBaseUrl } from './services/objectStorage.js';
import { get, query, run } from './config/database.js';
import { emitQueueUpdated } from './routes/queue.js';
import { runStartupScan } from './services/preFlightScan.js';
import logger from './services/logger.js';
import { sha256File, getDuration } from './services/audio.js';
import { v4 as uuidv4 } from 'uuid';

// Import routes
import tracksRouter from './routes/tracks.js';
import playlistsRouter from './routes/playlists.js';
import queueRouter from './routes/queue.js';
import schedulesRouter from './routes/schedules.js';
import historyRouter from './routes/history.js';
import foldersRouter from './routes/folders.js';
import backupRouter from './routes/backup.js';
import settingsRouter from './routes/settings.js';
import libraryRouter from './routes/library.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || process.env.BIND_HOST || '127.0.0.1';
export const backendPort = PORT;

// Ensure uploads directory exists. If UPLOAD_PATH is absolute (as provided by
// the Electron main process for packaged builds), use it directly; otherwise
// resolve relative to this file for dev/server usage.
const rawUploadPath = process.env.UPLOAD_PATH || 'uploads';
const uploadsDir = path.isAbsolute(rawUploadPath)
  ? rawUploadPath
  : join(__dirname, rawUploadPath);

const rawQueueUploadPath = process.env.QUEUE_UPLOAD_PATH || '';
const queueUploadsDir = rawQueueUploadPath
  ? (path.isAbsolute(rawQueueUploadPath) ? rawQueueUploadPath : join(__dirname, rawQueueUploadPath))
  : path.join(dirname(uploadsDir), 'queue_uploads');

const libraryDir = path.join(uploadsDir, 'library');
const playlistsDir = path.join(uploadsDir, 'playlists');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(libraryDir)) fs.mkdirSync(libraryDir, { recursive: true });
if (!fs.existsSync(playlistsDir)) fs.mkdirSync(playlistsDir, { recursive: true });
if (!fs.existsSync(queueUploadsDir)) fs.mkdirSync(queueUploadsDir, { recursive: true });

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
  if (process.env.REQUIRE_DESKTOP_HEADER !== '1') {
    return next();
  }

  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const token = req.headers['x-redio-client'];
  if (token !== 'redio-desktop') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  return next();
});

// Audio uploads
// - local mode: serve from disk
// - s3 mode (AWS S3 / Cloudflare R2): redirect to public object URL
if (isS3UploadStorage() && getS3PublicBaseUrl()) {
  app.get('/uploads/*', (req, res) => {
    const key = path.basename(String(req.params[0] || ''));
    if (!key) {
      return res.status(404).json({ error: 'Not Found' });
    }

    const base = getS3PublicBaseUrl();
    return res.redirect(302, `${base}/${encodeURIComponent(key)}`);
  });
} else {
  app.use(
    '/uploads',
    express.static(uploadsDir, {
      dotfiles: 'deny',
      index: false,
      fallthrough: true,
      redirect: false,
    }),
  );

  app.use(
    '/uploads_queue',
    express.static(queueUploadsDir, {
      dotfiles: 'deny',
      index: false,
      fallthrough: true,
      redirect: false,
    }),
  );
}

// API Routes
app.use('/api/tracks', tracksRouter);
app.use('/api/playlists', playlistsRouter);
app.use('/api/queue', queueRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/history', historyRouter);
app.use('/api/folders', foldersRouter);
app.use('/api', settingsRouter);
app.use('/api', backupRouter);
app.use('/api', libraryRouter);

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
app.use((err, req, res, _next) => {
  logger.error('Unhandled environment error: %o', err);
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

const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 0);
if (Number.isFinite(requestTimeoutMs) && requestTimeoutMs >= 0) {
  server.requestTimeout = requestTimeoutMs;
}

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

    const wsLoopbackOnly = process.env.WS_LOOPBACK_ONLY !== '0';
    // Only accept loopback connections by default.
    if (wsLoopbackOnly && !isLoopbackAddress(remote)) {
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

  logger.info('WebSocket client connected');

  socket.on('close', () => {
    logger.info('WebSocket client disconnected');
  });
});

// Start server
let schedulerInterval = null;
server.listen(PORT, HOST, () => {
  logger.info(`🚀 Radio Automation Server running on port ${PORT}`);
  logger.info(`📡 API available at http://${HOST}:${PORT}`);
  logger.info(`🎵 Upload directory: ${uploadsDir}`);
  logger.info(`🌐 CORS enabled for: ${process.env.CORS_ORIGIN}`);
  logger.info(`🔌 WebSocket endpoint: ws://${HOST}:${PORT}/ws`);

  // Lightweight backend scheduler for datetime playlists. Default to a
  // 1s interval so fired schedules line up closely with the visible clock.
  const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS || 1000);
  logger.info(`⏱️  Scheduler running every ${intervalMs}ms`);
  
  let lastSchedulerTick = Date.now();
  
  schedulerInterval = setInterval(() => {
    lastSchedulerTick = Date.now();
    runSchedulerTick(app).catch((err) => {
      logger.error('Scheduler tick error', err);
    });
  }, intervalMs);

  const watchdogInterval = setInterval(() => {
    const drift = Date.now() - lastSchedulerTick;
    if (drift > 5000) {
      // If drift is massive (> 30s), the computer likely went to sleep or the OS paused the process.
      if (drift > 30000) {
        logger.info(`⏰ Scheduler recovered from OS sleep/pause (Drift: ${Math.round(drift/1000)}s)`);
      } else {
        logger.warn(`⚠️ Scheduler delayed by ${drift}ms. Restarting tick loop to resync...`);
      }
      
      clearInterval(schedulerInterval);
      schedulerInterval = setInterval(() => {
        lastSchedulerTick = Date.now();
        runSchedulerTick(app).catch((err) => {
          logger.error('Scheduler tick error (recovered)', err);
        });
      }, intervalMs);
    }
  }, 5000);

  // Initialize file system watcher for local uploads
  if (!isS3UploadStorage()) {
    // Run initial pre-flight sync on both or just library?
    runStartupScan(uploadsDir).catch((err) => logger.error(err));

    logger.info(`👀 Starting file watcher natively on ${libraryDir}`);
    fileWatcher = chokidar.watch(libraryDir, {
      ignoreInitial: true,
      persistent: true,
      depth: 0,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      }
    });

    fileWatcher.on('add', async (filePath) => {
      try {
        const basename = path.basename(filePath);
        // Only accept likely audio extensions to prevent picking up temp/system files
        const ext = path.extname(basename).toLowerCase();
        if (!['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'].includes(ext)) {
          return;
        }

        const relativePath = `/uploads/library/${basename}`;

        // Check if track already exists (duplicate event or already tracked)
        const existing = await get('SELECT id, exists_on_disk FROM tracks WHERE file_path = ?', [relativePath]);
        
        if (existing) {
          if (existing.exists_on_disk === 0) {
            console.log(`[Watcher] Missing file reappeared: ${basename}. Marking as available.`);
            await run('UPDATE tracks SET exists_on_disk = 1 WHERE id = ?', [existing.id]);
            broadcastEvent({ type: 'tracksUpdated', trackIds: [existing.id] });
          }
          return;
        }

        console.log(`[Watcher] New OS file detected: ${basename}. Processing for Library injection...`);

        const stat = fs.statSync(filePath);
        const duration = await getDuration(filePath);
        const hash = await sha256File(filePath);

        // Derive name and artist cleanly
        const namePart = basename.replace(ext, '');
        let trackName = namePart;
        let artistName = 'Unknown Artist';
        if (namePart.includes(' - ')) {
          const parts = namePart.split(' - ');
          artistName = parts[0].trim();
          trackName = parts.slice(1).join(' - ').trim();
        }

        const trackId = uuidv4();

        await run(
          `INSERT INTO tracks (id, name, artist, duration, size, file_path, hash, exists_on_disk)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            trackId,
            trackName,
            artistName,
            duration,
            stat.size,
            relativePath,
            hash,
            1, // exists_on_disk
          ]
        );

        console.log(`[Watcher] Success! Added [${trackName}] to global library.`);
        broadcastEvent({ type: 'tracksAdded' });
      } catch (error) {
        console.error('[Watcher] Error handling add event:', error);
      }
    });

    fileWatcher.on('unlink', async (filePath) => {
      try {
        const basename = path.basename(filePath);
        const relativePath = `/uploads/library/${basename}`;

        // Find all tracks pointing to this file
        const tracks = await query('SELECT * FROM tracks WHERE file_path = ?', [relativePath]);
        if (tracks && tracks.length > 0) {
          const trackIds = tracks.map(t => t.id);
          console.log(`[Watcher] File missing natively: ${basename}. Marking ${tracks.length} track(s) as unavailable...`);

          for (const trackId of trackIds) {
            await run('UPDATE tracks SET exists_on_disk = 0 WHERE id = ?', [trackId]);
          }

          // Emit events to sync clients
          broadcastEvent({ type: 'tracksUpdated', trackIds });
          await emitQueueUpdated(app);
          broadcastEvent({ type: 'playlistsUpdated' });
        }
      } catch (error) {
        console.error('[Watcher] Error handling unlink event:', error);
      }
    });
  }
});

let fileWatcher = null;

export const stopBackend = async () => {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }

  if (fileWatcher) {
    await fileWatcher.close();
    fileWatcher = null;
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
