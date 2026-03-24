import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { TrackController } from '../controllers/track.controller.js';
import { uploadsDir } from '../utils/paths.js';

const router = express.Router();
const libraryDir = path.join(uploadsDir, 'library');

const ALLOWED_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);
const ALLOWED_MIME_TYPES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac', 
  'audio/x-flac', 'audio/mp4', 'audio/aac', 'video/mp4', 'application/ogg'
]);

const isAllowedMime = (mime) => (mime?.startsWith('audio/') || ALLOWED_MIME_TYPES.has(mime));
const normalizeExt = (originalName, mimeType) => {
  const raw = path.extname(originalName || '').toLowerCase();
  if (raw && ALLOWED_EXTENSIONS.has(raw)) return raw;
  switch (mimeType?.toLowerCase()) {
    case 'audio/mpeg': case 'audio/mp3': return '.mp3';
    case 'audio/wav': case 'audio/x-wav': return '.wav';
    case 'audio/ogg': case 'application/ogg': return '.ogg';
    case 'audio/flac': case 'audio/x-flac': return '.flac';
    case 'audio/mp4': case 'video/mp4': case 'audio/aac': return '.m4a';
    default: return '';
  }
};

const hashingDiskStorage = {
  _handleFile: (req, file, cb) => {
    try {
      let originalBaseName = path.basename(file.originalname, path.extname(file.originalname));
      // Sanitize: allow alphanumeric, spaces, dots, dashes, underscores
      let baseName = originalBaseName.replace(/[^a-zA-Z0-9 ._-]/g, '_').trim();
      if (!baseName) baseName = 'untitled';
      
      const safeExt = normalizeExt(file.originalname, file.mimetype);
      let finalName = `${baseName}${safeExt}`;
      let finalPath = path.join(libraryDir, finalName);
      let copyCount = 0;
      while (fs.existsSync(finalPath)) {
        copyCount++;
        finalName = `${baseName} (${copyCount})${safeExt}`;
        finalPath = path.join(libraryDir, finalName);
      }
      const hash = crypto.createHash('sha256');
      let size = 0;
      file.stream.on('data', (chunk) => { size += chunk.length; hash.update(chunk); });
      const outStream = fs.createWriteStream(finalPath);
      outStream.on('error', cb);
      file.stream.on('error', cb);
      outStream.on('finish', () => {
        cb(null, { destination: uploadsDir, filename: `library/${finalName}`, path: finalPath, size, sha256: hash.digest('hex') });
      });
      file.stream.pipe(outStream);
    } catch (err) { cb(err); }
  },
  _removeFile: (req, file, cb) => {
    try { if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch {}
    cb(null);
  }
};

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 0);
const uploadConfig = {
  storage: hashingDiskStorage,
  fileFilter: (req, file, cb) => {
    const ext = normalizeExt(file.originalname, file.mimetype);
    if (!ext || !ALLOWED_EXTENSIONS.has(ext) || !isAllowedMime(file.mimetype)) {
      return cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
    cb(null, true);
  }
};
if (MAX_UPLOAD_BYTES > 0) uploadConfig.limits = { fileSize: MAX_UPLOAD_BYTES };
const upload = multer(uploadConfig);

router.get('/', TrackController.getAll);
router.post('/copy', TrackController.copy);
router.post('/alias', TrackController.alias);
router.get('/:id', TrackController.getById);
router.post('/:id/edit', TrackController.edit);
router.put('/:id/rename', TrackController.rename);
router.post('/upload', (req, res, next) => {
  upload.array('file', 50)(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'One or more files are too large' });
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    next();
  });
}, TrackController.upload);
router.delete('/:id', TrackController.delete);

export default router;
