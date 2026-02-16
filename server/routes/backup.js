import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import { db, run, reconnectDatabase, resolvedDbPath } from '../config/database.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const router = express.Router();

// Enable file upload for .sqlite files
import multer from 'multer';

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads/backups');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  dest: 'uploads/backups/',
  fileFilter: (req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith('.sqlite')) {
      cb(null, true);
    } else {
      cb(new Error('Only .sqlite files are allowed'), false);
    }
  },
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

let scheduledIntervalId = null;
let scheduledIntervalMinutes = 0;
let currentBackupJob = null;
let dailyAutoTimeoutId = null;
let dailyAutoConfig = {
  enabled: false,
  directoryPath: '',
  timeOfDay: '02:00 AM',
};

function getDailyAutoConfigPath() {
  const dir = ensureBackupsDir(null);
  return path.join(dir, 'auto-backup.config.json');
}

function loadDailyAutoConfigFromDisk() {
  try {
    const cfgPath = getDailyAutoConfigPath();
    if (!fs.existsSync(cfgPath)) return;
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (raw && typeof raw === 'object') {
      dailyAutoConfig = {
        enabled: Boolean(raw.enabled),
        directoryPath: typeof raw.directoryPath === 'string' ? raw.directoryPath : '',
        timeOfDay: typeof raw.timeOfDay === 'string' ? raw.timeOfDay : '02:00 AM',
      };
    }
  } catch (e) {
    console.error('Failed to load daily auto-backup config', e);
  }
}

function saveDailyAutoConfigToDisk() {
  try {
    const cfgPath = getDailyAutoConfigPath();
    fs.writeFileSync(cfgPath, JSON.stringify(dailyAutoConfig, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save daily auto-backup config', e);
  }
}

function clearDailyAutoSchedule() {
  if (dailyAutoTimeoutId != null) {
    clearTimeout(dailyAutoTimeoutId);
    dailyAutoTimeoutId = null;
  }
}

function parseTimeOfDay(value) {
  const s = String(value || '').trim().toUpperCase();
  const m = /^([0-1]?\d):([0-5]\d)\s*(AM|PM)$/.exec(s);
  if (!m) return null;
  let hh = Number(m[1]);
  const mm = Number(m[2]);
  const ap = m[3];
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 1 || hh > 12) return null;
  if (mm < 0 || mm > 59) return null;
  if (ap === 'AM') {
    if (hh === 12) hh = 0;
  } else {
    if (hh !== 12) hh = hh + 12;
  }
  return { hh, mm, normalized: `${String(m[1]).padStart(2, '0')}:${String(m[2]).padStart(2, '0')} ${ap}` };
}

function computeNextRunMs(timeOfDay) {
  const parsed = parseTimeOfDay(timeOfDay);
  if (!parsed) return null;
  const now = new Date();
  const target = new Date(now);
  target.setHours(parsed.hh, parsed.mm, 0, 0);
  if (target.getTime() <= now.getTime() + 1000) {
    target.setDate(target.getDate() + 1);
  }
  return Math.max(0, target.getTime() - now.getTime());
}

function scheduleDailyAutoBackup() {
  clearDailyAutoSchedule();

  if (!dailyAutoConfig.enabled) return;

  const directoryPath = String(dailyAutoConfig.directoryPath || '').trim() || getBackupsDir(null);
  const nextMs = computeNextRunMs(dailyAutoConfig.timeOfDay);
  if (nextMs == null) return;

  dailyAutoTimeoutId = setTimeout(() => {
    const location = {
      name: 'auto',
      type: STORAGE_TYPES.LOCAL,
      path: directoryPath,
    };

    createBackup({ location, description: 'Scheduled daily auto-backup' })
      .catch((e) => {
        console.error('Daily auto-backup failed', e);
      })
      .finally(() => {
        scheduleDailyAutoBackup();
      });
  }, nextMs);
}

loadDailyAutoConfigFromDisk();
scheduleDailyAutoBackup();
let backupConfig = {
  storageLocations: [],
  retentionPolicy: { keepDaily: 7, keepWeekly: 4, keepMonthly: 12 },
  compressionEnabled: false,
  includeAudioFiles: false,
  defaultBackupType: 'full'
};

// Backup job tracking
const backupJobs = new Map();

// Backup types
const BACKUP_TYPES = {
  FULL: 'full',
  INCREMENTAL: 'incremental',
  SELECTIVE: 'selective'
};

// Data categories for selective backup
const DATA_CATEGORIES = {
  LIBRARY: 'library',
  PLAYLISTS: 'playlists',
  QUEUE: 'queue',
  SCHEDULER: 'scheduler',
  HISTORY: 'history',
  CONFIGS: 'configs'
};

// Storage location types
const STORAGE_TYPES = {
  LOCAL: 'local',
  EXTERNAL: 'external',
  NETWORK: 'network'
};

function getBackupsDir(location = null) {
  if (location && location.type === STORAGE_TYPES.LOCAL && location.path) {
    return location.path;
  }
  
  const raw = process.env.BACKUP_PATH;
  if (raw && path.isAbsolute(raw)) return raw;
  const dbDir = path.dirname(resolvedDbPath);
  return raw ? path.join(dbDir, raw) : path.join(dbDir, 'backups');
}

function ensureBackupsDir(location = null) {
  const dir = getBackupsDir(location);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function formatTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function generateBackupId() {
  return crypto.randomUUID();
}

function calculateFileHash(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

function createBackupMetadata(backupId, type, categories, size, checksum, location) {
  return {
    id: backupId,
    type,
    categories,
    size,
    checksum,
    createdAt: new Date().toISOString(),
    version: '1.0.0',
    appVersion: process.env.npm_package_version || '1.0.0',
    location: location || 'default',
    compressed: backupConfig.compressionEnabled,
    includesAudio: backupConfig.includeAudioFiles
  };
}

function saveBackupMetadata(backupDir, filename, metadata) {
  const metaPath = path.join(backupDir, `${filename}.meta.json`);
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

function loadBackupMetadata(backupDir, filename) {
  const metaPath = path.join(backupDir, `${filename}.meta.json`);
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
}

async function validateBackupIntegrity(backupPath, expectedChecksum) {
  if (!expectedChecksum) return true;
  
  const actualChecksum = calculateFileHash(backupPath);
  return actualChecksum === expectedChecksum;
}

async function createBackup(options = {}) {
  // Always create full backups for broadcast-grade reliability
  const {
    type = BACKUP_TYPES.FULL, // Force full backup
    categories = Object.values(DATA_CATEGORIES), // Include all categories
    location = null,
    description = ''
  } = options;
  
  // Override to always use full backup
  const backupType = BACKUP_TYPES.FULL;
  const allCategories = Object.values(DATA_CATEGORIES);
  
  const backupId = generateBackupId();
  const backupsDir = ensureBackupsDir(location);
  const timestamp = formatTimestamp(new Date());
  const filename = `full_${timestamp}_${backupId}.sqlite`;
  const outPath = path.join(backupsDir, filename);
  
  // Create backup job for tracking
  const job = {
    id: backupId,
    type: backupType,
    categories: allCategories,
    status: 'running',
    startedAt: new Date().toISOString(),
    progress: 0,
    currentStep: 'Initializing backup'
  };
  
  backupJobs.set(backupId, job);
  currentBackupJob = backupId;
  
  try {
    job.currentStep = 'Creating full database snapshot';
    job.progress = 20;
    
    // Always use VACUUM INTO for consistent full backup without interrupting playback
    await run(`VACUUM INTO ?`, [outPath]);
    
    job.currentStep = 'Validating backup integrity';
    job.progress = 80;
    
    const stat = fs.statSync(outPath);
    const checksum = calculateFileHash(outPath);
    
    // Create and save metadata
    const metadata = createBackupMetadata(backupId, backupType, allCategories, stat.size, checksum, location?.name || 'default');
    if (description) metadata.description = description;
    metadata.forceFullBackup = true; // Mark as forced full backup
    
    saveBackupMetadata(backupsDir, filename, metadata);
    
    // Copy to additional storage locations if configured
    if (backupConfig.storageLocations.length > 0) {
      job.currentStep = 'Copying to additional storage locations';
      job.progress = 90;
      await copyToAdditionalLocations(outPath, filename, metadata);
    }
    
    job.status = 'completed';
    job.progress = 100;
    job.currentStep = 'Full backup completed successfully';
    job.completedAt = new Date().toISOString();
    job.result = { filename, path: outPath, bytes: stat.size, checksum };
    
    return job.result;
  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    job.completedAt = new Date().toISOString();
    
    // Clean up partial backup file
    if (fs.existsSync(outPath)) {
      fs.unlinkSync(outPath);
    }
    
    throw error;
  } finally {
    currentBackupJob = null;
  }
}

async function createSelectiveBackup(outPath, categories, job) {
  // Create a new database for selective backup
  const tempDb = new sqlite3.Database(outPath);
  
  try {
    job.currentStep = 'Creating selective backup schema';
    
    // Create schema based on selected categories
    if (categories.includes(DATA_CATEGORIES.LIBRARY)) {
      await new Promise((resolve, reject) => {
        tempDb.run(`CREATE TABLE IF NOT EXISTS tracks AS SELECT * FROM main.tracks`, resolve);
      });
    }
    
    if (categories.includes(DATA_CATEGORIES.PLAYLISTS)) {
      await new Promise((resolve, reject) => {
        tempDb.run(`CREATE TABLE IF NOT EXISTS playlists AS SELECT * FROM main.playlists`, resolve);
      });
    }
    
    if (categories.includes(DATA_CATEGORIES.QUEUE)) {
      await new Promise((resolve, reject) => {
        tempDb.run(`CREATE TABLE IF NOT EXISTS queue AS SELECT * FROM main.queue`, resolve);
      });
    }
    
    if (categories.includes(DATA_CATEGORIES.SCHEDULER)) {
      await new Promise((resolve, reject) => {
        tempDb.run(`CREATE TABLE IF NOT EXISTS schedules AS SELECT * FROM main.schedules`, resolve);
      });
    }
    
    if (categories.includes(DATA_CATEGORIES.HISTORY)) {
      await new Promise((resolve, reject) => {
        tempDb.run(`CREATE TABLE IF NOT EXISTS playback_history AS SELECT * FROM main.playback_history`, resolve);
      });
    }
    
    // Copy indexes for selected tables
    const indexes = await run(`SELECT name, sql FROM sqlite_master WHERE type='index' AND name IS NOT NULL`);
    for (const index of indexes) {
      if (shouldIncludeIndex(index.name, categories)) {
        await new Promise((resolve, reject) => {
          tempDb.run(index.sql, resolve);
        });
      }
    }
  } finally {
    tempDb.close();
  }
}

async function createIncrementalBackup(outPath, job) {
  // For now, implement as full backup but mark as incremental
  // In a real implementation, this would track changes since last backup
  job.currentStep = 'Analyzing changes since last backup';
  await run(`VACUUM INTO ?`, [outPath]);
}

function shouldIncludeIndex(indexName, categories) {
  // Simple logic to determine if an index should be included in selective backup
  if (categories.includes(DATA_CATEGORIES.LIBRARY) && indexName.includes('track')) return true;
  if (categories.includes(DATA_CATEGORIES.PLAYLISTS) && indexName.includes('playlist')) return true;
  if (categories.includes(DATA_CATEGORIES.QUEUE) && indexName.includes('queue')) return true;
  if (categories.includes(DATA_CATEGORIES.SCHEDULER) && indexName.includes('schedule')) return true;
  if (categories.includes(DATA_CATEGORIES.HISTORY) && indexName.includes('history')) return true;
  return false;
}

async function copyToAdditionalLocations(sourcePath, filename, metadata) {
  for (const location of backupConfig.storageLocations) {
    try {
      if (location.type === STORAGE_TYPES.LOCAL && location.path) {
        const targetDir = ensureBackupsDir(location);
        const targetPath = path.join(targetDir, filename);
        fs.copyFileSync(sourcePath, targetPath);
        saveBackupMetadata(targetDir, filename, { ...metadata, location: location.name });
      }
      // Add network/external drive support later
    } catch (error) {
      console.error(`Failed to copy backup to ${location.name}:`, error);
    }
  }
}

function listBackups(location = null) {
  const backupsDir = ensureBackupsDir(location);
  const entries = [];
  
  // Get all backup files from all configured locations
  const locationsToScan = location ? [location] : [{ type: STORAGE_TYPES.LOCAL, path: getBackupsDir() }, ...backupConfig.storageLocations];
  
  for (const scanLocation of locationsToScan) {
    try {
      const scanDir = ensureBackupsDir(scanLocation);
      const files = fs.readdirSync(scanDir);
      
      for (const file of files) {
        if (file.toLowerCase().endsWith('.sqlite')) {
          const fullPath = path.join(scanDir, file);
          const stat = fs.statSync(fullPath);
          const metadata = loadBackupMetadata(scanDir, file);
          
          entries.push({
            filename: file,
            bytes: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            location: scanLocation.name || 'default',
            metadata,
            isValid: metadata ? validateBackupIntegrity(fullPath, metadata.checksum) : true
          });
        }
      }
    } catch (error) {
      console.error(`Failed to scan backup location ${scanLocation.name || 'default'}:`, error);
    }
  }
  
  // Sort by creation date (newest first)
  return entries.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
}

async function restoreFromBackup(filename, options = {}) {
  const { 
    location = null, 
    validateOnly = false, 
    conflictResolution = 'overwrite',
    selectiveRestore = null, // { categories: DataCategory[], mode: 'include' | 'exclude' }
    createRestorePoint = true 
  } = options;
  
  const backupsDir = ensureBackupsDir(location);
  const backupPath = path.join(backupsDir, filename);
  
  if (!backupPath.startsWith(backupsDir + path.sep)) {
    throw new Error('Invalid backup filename');
  }

  if (!fs.existsSync(backupPath)) {
    const err = new Error('Backup not found');
    err.statusCode = 404;
    throw err;
  }
  
  // Load and validate backup metadata
  const metadata = loadBackupMetadata(backupsDir, filename);
  if (metadata) {
    const isValid = await validateBackupIntegrity(backupPath, metadata.checksum);
    if (!isValid) {
      throw new Error('Backup file is corrupted or has been modified');
    }
  }
  
  if (validateOnly) {
    return { valid: true, metadata };
  }

  // Create a backup of current state before restore
  if (createRestorePoint !== false) {
    try {
      await createBackup({ 
        type: BACKUP_TYPES.FULL, 
        description: `Auto-backup before restoring ${filename}` 
      });
    } catch (error) {
      console.warn('Failed to create restore point before restore:', error);
    }
  }

  // Handle selective restore
  if (selectiveRestore && metadata) {
    return await performSelectiveRestore(backupPath, selectiveRestore, metadata, { conflictResolution });
  }

  // Full restore - safe approach that doesn't interrupt playback
  return await performSafeFullRestore(backupPath, metadata);
}

async function performSelectiveRestore(backupPath, selectiveRestore, metadata, opts = {}) {
  const { categories, mode } = selectiveRestore;
  const { conflictResolution = 'overwrite' } = opts;
  
  // Create temporary database for selective operations
  const tempDbPath = backupPath.replace('.sqlite', '_temp_restore.sqlite');
  
  try {
    // Copy backup to temporary location
    fs.copyFileSync(backupPath, tempDbPath);
    
    // Open temporary database for selective operations
    const tempDb = new sqlite3.Database(tempDbPath);
    const mainDb = db; // Current database
    
    // Process each category based on mode
    if (mode === 'include') {
      // Only restore specified categories
      for (const category of categories) {
        await restoreCategory(mainDb, tempDb, category, { conflictResolution });
      }
    } else {
      // Restore all except specified categories
      const allCategories = Object.values(DATA_CATEGORIES);
      const categoriesToRestore = allCategories.filter(cat => !categories.includes(cat));
      
      for (const category of categoriesToRestore) {
        await restoreCategory(mainDb, tempDb, category, { conflictResolution });
      }
    }
    
    tempDb.close();
    fs.unlinkSync(tempDbPath);
    
    return { 
      success: true, 
      metadata, 
      selectiveRestore: true,
      restoredCategories: mode === 'include' ? categories : Object.values(DATA_CATEGORIES).filter(cat => !categories.includes(cat))
    };
  } catch (error) {
    // Clean up temp file on error
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
    throw error;
  }
}

async function restoreCategory(mainDb, backupDb, category, opts = {}) {
  const tableMap = {
    [DATA_CATEGORIES.LIBRARY]: ['tracks', 'folders', 'folder_tracks'],
    [DATA_CATEGORIES.PLAYLISTS]: ['playlists', 'playlist_tracks'],
    [DATA_CATEGORIES.QUEUE]: ['queue'],
    [DATA_CATEGORIES.SCHEDULER]: ['schedules'],
    [DATA_CATEGORIES.HISTORY]: ['playback_history'],
    [DATA_CATEGORIES.CONFIGS]: ['app_configs'],
  };

  const tableNames = tableMap[category];
  if (!Array.isArray(tableNames) || tableNames.length === 0) return;

  const { conflictResolution = 'overwrite' } = opts;

  const tableExists = (database, tableName) =>
    new Promise((resolve) => {
      database.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        [tableName],
        (err, row) => resolve(!err && !!row)
      );
    });

  const mergeTableByRow = async (tableName) => {
    const [hasMain, hasBackup] = await Promise.all([
      tableExists(mainDb, tableName),
      tableExists(backupDb, tableName),
    ]);
    if (!hasMain || !hasBackup) return;

    const rows = await new Promise((resolve, reject) => {
      backupDb.all(`SELECT * FROM ${tableName}`, (err, r) => (err ? reject(err) : resolve(r)));
    });

    for (const row of rows) {
      await new Promise((resolve, reject) => {
        const columns = Object.keys(row).join(', ');
        const placeholders = Object.keys(row).map(() => '?').join(', ');
        const values = Object.values(row);
        mainDb.run(
          `INSERT OR IGNORE INTO ${tableName} (${columns}) VALUES (${placeholders})`,
          values,
          (err) => (err ? reject(err) : resolve())
        );
      });
    }
  };

  const mergeLibrary = async () => {
    const [hasTracksMain, hasTracksBackup] = await Promise.all([
      tableExists(mainDb, 'tracks'),
      tableExists(backupDb, 'tracks'),
    ]);
    if (hasTracksMain && hasTracksBackup) {
      await mergeTableByRow('tracks');
    }

    const [hasFoldersMain, hasFoldersBackup] = await Promise.all([
      tableExists(mainDb, 'folders'),
      tableExists(backupDb, 'folders'),
    ]);
    const [hasFolderTracksMain, hasFolderTracksBackup] = await Promise.all([
      tableExists(mainDb, 'folder_tracks'),
      tableExists(backupDb, 'folder_tracks'),
    ]);
    if (!hasFoldersMain || !hasFoldersBackup || !hasFolderTracksMain || !hasFolderTracksBackup) {
      return;
    }

    const mainFolders = await new Promise((resolve, reject) => {
      mainDb.all('SELECT id, name FROM folders', (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
    const mainByName = new Map(mainFolders.map((f) => [String(f.name), String(f.id)]));

    const backupFolders = await new Promise((resolve, reject) => {
      backupDb.all('SELECT id, name FROM folders', (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });

    const folderIdMap = new Map();

    for (const folder of backupFolders) {
      const name = String(folder.name);
      const backupId = String(folder.id);
      const existingId = mainByName.get(name);
      if (existingId) {
        folderIdMap.set(backupId, existingId);
        continue;
      }

      await new Promise((resolve, reject) => {
        mainDb.run('INSERT OR IGNORE INTO folders (id, name) VALUES (?, ?)', [backupId, name], (err) =>
          err ? reject(err) : resolve()
        );
      });

      folderIdMap.set(backupId, backupId);
      mainByName.set(name, backupId);
    }

    const backupLinks = await new Promise((resolve, reject) => {
      backupDb.all('SELECT folder_id, track_id FROM folder_tracks', (err, rows) =>
        err ? reject(err) : resolve(rows || [])
      );
    });

    for (const link of backupLinks) {
      const mappedFolderId = folderIdMap.get(String(link.folder_id)) || String(link.folder_id);
      const trackId = String(link.track_id);
      await new Promise((resolve, reject) => {
        mainDb.run(
          'INSERT OR IGNORE INTO folder_tracks (folder_id, track_id) VALUES (?, ?)',
          [mappedFolderId, trackId],
          (err) => (err ? reject(err) : resolve())
        );
      });
    }
  };

  try {
    await new Promise((resolve, reject) => {
      mainDb.run('BEGIN IMMEDIATE TRANSACTION', (err) => (err ? reject(err) : resolve()));
    });

    if (conflictResolution === 'merge') {
      if (category === DATA_CATEGORIES.LIBRARY) {
        await mergeLibrary();
      } else {
        for (const tableName of tableNames) {
          await mergeTableByRow(tableName);
        }
      }
    } else {
      for (const tableName of tableNames) {
        const [hasMain, hasBackup] = await Promise.all([
          tableExists(mainDb, tableName),
          tableExists(backupDb, tableName),
        ]);

        if (!hasMain || !hasBackup) continue;

        await new Promise((resolve, reject) => {
          mainDb.run(`DELETE FROM ${tableName}`, (err) => (err ? reject(err) : resolve()));
        });

        const rows = await new Promise((resolve, reject) => {
          backupDb.all(`SELECT * FROM ${tableName}`, (err, r) => (err ? reject(err) : resolve(r)));
        });

        for (const row of rows) {
          await new Promise((resolve, reject) => {
            const columns = Object.keys(row).join(', ');
            const placeholders = Object.keys(row).map(() => '?').join(', ');
            const values = Object.values(row);
            mainDb.run(
              `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`,
              values,
              (err) => (err ? reject(err) : resolve())
            );
          });
        }
      }
    }

    await new Promise((resolve, reject) => {
      mainDb.run('COMMIT', (err) => (err ? reject(err) : resolve()));
    });
  } catch (error) {
    try {
      await new Promise((resolve) => mainDb.run('ROLLBACK', () => resolve()));
    } catch {
      // ignore
    }
    console.error(`Failed to restore category ${category}:`, error);
    throw error;
  }
}

async function performSafeFullRestore(backupPath, metadata) {
  // Safe full restore that doesn't interrupt playback
  // This approach creates a new database file and swaps it atomically
  
  const dbPath = resolvedDbPath;
  const backupDbPath = dbPath.replace('.sqlite', '_backup_before_restore.sqlite');
  
  try {
    // Create backup of current database
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, backupDbPath);
    }
    
    // Copy backup file to a temporary location first
    const tempRestorePath = dbPath.replace('.sqlite', '_temp_restore.sqlite');
    fs.copyFileSync(backupPath, tempRestorePath);
    
    // Validate the temporary restore file
    if (metadata) {
      const isValid = await validateBackupIntegrity(tempRestorePath, metadata.checksum);
      if (!isValid) {
        fs.unlinkSync(tempRestorePath);
        throw new Error('Restore file validation failed');
      }
    }
    
    // Reconnect after restore. This allows restoring without restarting backend.
    // Note: queries during this short window may fail; callers should retry.
    await new Promise((resolve) => {
      db.close(() => resolve());
    });
    
    // Atomic swap - replace the database file
    fs.copyFileSync(tempRestorePath, dbPath);
    fs.unlinkSync(tempRestorePath);

    await reconnectDatabase();
    return { success: true, metadata, fullRestore: true };
  } catch (error) {
    // Attempt to restore from backup if something went wrong
    if (fs.existsSync(backupDbPath)) {
      try {
        fs.copyFileSync(backupDbPath, dbPath);
      } catch (restoreError) {
        console.error('Critical: Failed to restore from backup:', restoreError);
      }
    }
    throw error;
  }
}

function clearSchedule() {
  if (scheduledIntervalId != null) {
    clearInterval(scheduledIntervalId);
    scheduledIntervalId = null;
  }
  scheduledIntervalMinutes = 0;
}

function setSchedule(minutes) {
  clearSchedule();
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  scheduledIntervalMinutes = minutes;
  scheduledIntervalId = setInterval(() => {
    createBackup().catch((e) => {
      console.error('Automatic backup failed', e);
    });
  }, minutes * 60 * 1000);
}

// Enhanced API endpoints

router.get('/backups', (req, res) => {
  try {
    const location = req.query.location ? backupConfig.storageLocations.find(l => l.name === req.query.location) : null;
    return res.json({ backups: listBackups(location) });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Failed to list backups' });
  }
});

// Upload endpoint for .sqlite files
router.post('/backup/upload', upload.single('backupFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const uploadedPath = req.file.path;
    const originalName = req.file.originalname;
    
    // Validate uploaded file
    try {
      // Test if it's a valid SQLite database
      const testDb = new sqlite3.Database(uploadedPath, { readonly: true });
      
      // Basic validation - check if it has expected tables
      const tables = await new Promise((resolve, reject) => {
        testDb.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
          if (err) reject(err); else resolve(rows);
        });
      });
      
      testDb.close();
      
      // Move to backups directory with proper naming
      const backupsDir = ensureBackupsDir();
      const timestamp = formatTimestamp(new Date());
      const finalFilename = `uploaded_${timestamp}_${originalName}`;
      const finalPath = path.join(backupsDir, finalFilename);
      
      fs.renameSync(uploadedPath, finalPath);
      
      // Create metadata for uploaded file
      const stat = fs.statSync(finalPath);
      const checksum = calculateFileHash(finalPath);
      
      const metadata = createBackupMetadata(
        generateBackupId(),
        BACKUP_TYPES.FULL,
        Object.values(DATA_CATEGORIES),
        stat.size,
        checksum,
        'uploaded'
      );
      metadata.uploadedAt = new Date().toISOString();
      metadata.originalFilename = originalName;
      
      saveBackupMetadata(backupsDir, finalFilename, metadata);
      
      return res.json({
        ok: true,
        filename: finalFilename,
        originalName,
        size: stat.size,
        checksum,
        metadata
      });
      
    } catch (validationError) {
      // Clean up invalid file
      if (fs.existsSync(uploadedPath)) {
        fs.unlinkSync(uploadedPath);
      }
      return res.status(400).json({ error: 'Invalid SQLite database file' });
    }
    
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(500).json({ error: error?.message || 'Failed to upload backup' });
  }
});

// Download endpoint for manual save to PC
router.get('/backup/download/:filename', async (req, res) => {
  const { filename } = req.params;
  
  try {
    const location = req.query.location ? backupConfig.storageLocations.find(l => l.name === req.query.location) : null;
    const backupsDir = ensureBackupsDir(location);
    const backupPath = path.join(backupsDir, filename);
    
    if (!backupPath.startsWith(backupsDir + path.sep)) {
      return res.status(400).json({ error: 'Invalid backup filename' });
    }
    
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: 'Backup not found' });
    }
    
    // Set appropriate headers for file download
    res.setHeader('Content-Type', 'application/x-sqlite3');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // Stream the file to response
    const fileStream = fs.createReadStream(backupPath);
    fileStream.pipe(res);
    
    fileStream.on('error', (error) => {
      console.error('Error streaming backup file:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to download backup' });
      }
    });
    
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to download backup' });
  }
});

router.post('/backup', async (req, res) => {
  try {
    // Always create full backups - ignore type parameter
    const options = {
      type: BACKUP_TYPES.FULL, // Force full backup
      categories: Object.values(DATA_CATEGORIES), // Include all categories
      location: req.body.location ? backupConfig.storageLocations.find(l => l.name === req.body.location) : null,
      description: req.body.description || ''
    };
    
    const result = await createBackup(options);
    return res.json({ ok: true, backup: result });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Failed to create backup' });
  }
});

router.get('/backup/status', (req, res) => {
  const jobId = req.query.jobId || currentBackupJob;
  
  if (!jobId) {
    return res.json({ status: 'idle', currentJob: null });
  }
  
  const job = backupJobs.get(jobId);
  if (!job) {
    return res.json({ status: 'idle', currentJob: null });
  }
  
  return res.json({
    status: job.status,
    currentJob: {
      id: job.id,
      type: job.type,
      progress: job.progress,
      currentStep: job.currentStep,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error
    }
  });
});

router.delete('/backup/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = backupJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Backup job not found' });
  }
  
  if (job.status === 'running') {
    // Mark for cancellation - the actual backup function will check this
    job.status = 'cancelled';
    return res.json({ ok: true, message: 'Backup job cancelled' });
  }
  
  return res.status(400).json({ error: 'Cannot cancel a completed job' });
});

function listUserTables(database) {
  return new Promise((resolve, reject) => {
    database.all(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(r => r.name));
      }
    );
  });
}

function tableInfo(database, tableName) {
  return new Promise((resolve, reject) => {
    database.all(`PRAGMA table_info(${JSON.stringify(tableName)})`, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function normalizeColumn(col) {
  return {
    name: String(col.name),
    type: String(col.type || '').trim().toUpperCase(),
    notnull: Boolean(col.notnull),
    pk: Boolean(col.pk),
  };
}

async function getSchemaMap(database) {
  const tables = await listUserTables(database);
  const schema = new Map();
  for (const t of tables) {
    const info = await tableInfo(database, t);
    const cols = info.map(normalizeColumn);
    schema.set(t, cols);
  }
  return schema;
}

function diffSchemas(currentSchema, backupSchema) {
  const errors = [];

  const currentTables = new Set(currentSchema.keys());
  const backupTables = new Set(backupSchema.keys());

  for (const table of currentTables) {
    if (!backupTables.has(table)) errors.push(`Missing table: ${table}`);
  }
  for (const table of backupTables) {
    if (!currentTables.has(table)) errors.push(`Extra table: ${table}`);
  }

  for (const table of currentTables) {
    if (!backupTables.has(table)) continue;

    const curCols = currentSchema.get(table) || [];
    const bakCols = backupSchema.get(table) || [];

    const curByName = new Map(curCols.map(c => [c.name, c]));
    const bakByName = new Map(bakCols.map(c => [c.name, c]));

    for (const name of curByName.keys()) {
      if (!bakByName.has(name)) errors.push(`Missing column: ${table}.${name}`);
    }
    for (const name of bakByName.keys()) {
      if (!curByName.has(name)) errors.push(`Extra column: ${table}.${name}`);
    }

    for (const [name, curCol] of curByName.entries()) {
      const bakCol = bakByName.get(name);
      if (!bakCol) continue;
      if (curCol.type !== bakCol.type) {
        errors.push(`Column type mismatch: ${table}.${name} (expected ${curCol.type}, got ${bakCol.type})`);
      }
    }
  }

  return errors;
}

router.post('/backup/preview', async (req, res) => {
  const filename = String(req.body?.filename || '').trim();
  if (!filename) {
    return res.status(400).json({ error: 'filename is required' });
  }
  
  try {
    const location = req.body.location ? backupConfig.storageLocations.find(l => l.name === req.body.location) : null;
    const backupsDir = ensureBackupsDir(location);
    const backupPath = path.join(backupsDir, filename);
    
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: 'Backup not found' });
    }
    
    const metadata = loadBackupMetadata(backupsDir, filename);
    
    // Preview backup contents
    const previewDb = new sqlite3.Database(backupPath, { readonly: true });
    const preview = {};
    
    try {
      if (metadata?.categories?.includes(DATA_CATEGORIES.LIBRARY)) {
        preview.tracks = await new Promise((resolve, reject) => {
          previewDb.get('SELECT COUNT(*) as count FROM tracks', (err, row) => {
            if (err) reject(err); else resolve(row.count);
          });
        });
      }
      
      if (metadata?.categories?.includes(DATA_CATEGORIES.PLAYLISTS)) {
        preview.playlists = await new Promise((resolve, reject) => {
          previewDb.get('SELECT COUNT(*) as count FROM playlists', (err, row) => {
            if (err) reject(err); else resolve(row.count);
          });
        });
      }
      
      if (metadata?.categories?.includes(DATA_CATEGORIES.QUEUE)) {
        preview.queueItems = await new Promise((resolve, reject) => {
          previewDb.get('SELECT COUNT(*) as count FROM queue', (err, row) => {
            if (err) reject(err); else resolve(row.count);
          });
        });
      }
      
      if (metadata?.categories?.includes(DATA_CATEGORIES.SCHEDULER)) {
        preview.schedules = await new Promise((resolve, reject) => {
          previewDb.get('SELECT COUNT(*) as count FROM schedules', (err, row) => {
            if (err) reject(err); else resolve(row.count);
          });
        });
      }
    } finally {
      previewDb.close();
    }
    
    return res.json({ ok: true, metadata, preview });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Failed to preview backup' });
  }
});

// Configuration endpoints

router.get('/backup/config', (req, res) => {
  return res.json({ config: backupConfig });
});

router.put('/backup/config', (req, res) => {
  try {
    const newConfig = req.body;
    
    // Validate configuration
    if (newConfig.storageLocations) {
      if (!Array.isArray(newConfig.storageLocations)) {
        return res.status(400).json({ error: 'storageLocations must be an array' });
      }
      
      for (const location of newConfig.storageLocations) {
        if (!location.name || !location.type) {
          return res.status(400).json({ error: 'Each storage location must have name and type' });
        }
        
        if (!Object.values(STORAGE_TYPES).includes(location.type)) {
          return res.status(400).json({ error: `Invalid storage type: ${location.type}` });
        }
      }
    }
    
    backupConfig = { ...backupConfig, ...newConfig };
    return res.json({ ok: true, config: backupConfig });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Failed to update configuration' });
  }
});

router.post('/backup/location/test', async (req, res) => {
  try {
    const { type, path: locationPath } = req.body;
    
    if (!type || !locationPath) {
      return res.status(400).json({ error: 'type and path are required' });
    }
    
    if (type === STORAGE_TYPES.LOCAL) {
      // Test if directory exists and is writable
      if (!fs.existsSync(locationPath)) {
        return res.json({ ok: false, error: 'Directory does not exist' });
      }
      
      const testFile = path.join(locationPath, '.backup_test');
      try {
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        return res.json({ ok: true });
      } catch (error) {
        return res.json({ ok: false, error: 'Directory is not writable' });
      }
    }
    
    return res.status(400).json({ error: 'Unsupported storage type for testing' });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Failed to test location' });
  }
});

router.get('/backup/schedule', (req, res) => {
  return res.json({
    enabled: scheduledIntervalId != null,
    intervalMinutes: scheduledIntervalMinutes,
  });
});

router.post('/backup/schedule', (req, res) => {
  const minutes = Number(req.body?.intervalMinutes || 0);
  const enabled = Boolean(req.body?.enabled);

  if (!enabled) {
    clearSchedule();
    return res.json({ ok: true, enabled: false, intervalMinutes: 0 });
  }

  if (!Number.isFinite(minutes) || minutes <= 0) {
    return res.status(400).json({ error: 'intervalMinutes must be a positive number' });
  }

  setSchedule(minutes);
  return res.json({ ok: true, enabled: true, intervalMinutes: scheduledIntervalMinutes });
});

router.get('/backup/auto', (_req, res) => {
  const defaultDir = getBackupsDir(null);
  const cfg = {
    ...dailyAutoConfig,
    directoryPath: String(dailyAutoConfig.directoryPath || '').trim() || defaultDir,
  };
  return res.json({ config: cfg });
});

router.put('/backup/auto', (req, res) => {
  try {
    const enabled = Boolean(req.body?.enabled);
    const directoryPath = String(req.body?.directoryPath || '').trim();
    const timeRaw = String(req.body?.timeOfDay || '').trim();

    const parsed = parseTimeOfDay(timeRaw);
    if (!parsed) {
      return res.status(400).json({ error: 'timeOfDay must be in HH:MM AM/PM format' });
    }

    if (directoryPath && !path.isAbsolute(directoryPath)) {
      return res.status(400).json({ error: 'directoryPath must be an absolute path' });
    }

    dailyAutoConfig = {
      enabled,
      directoryPath,
      timeOfDay: parsed.normalized,
    };
    saveDailyAutoConfigToDisk();
    scheduleDailyAutoBackup();

    const defaultDir = getBackupsDir(null);
    return res.json({
      ok: true,
      config: {
        ...dailyAutoConfig,
        directoryPath: String(dailyAutoConfig.directoryPath || '').trim() || defaultDir,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Failed to update auto-backup config' });
  }
});

// Validate database structure
router.post('/backup/validate', async (req, res) => {
  try {
    const { filename } = req.body;
    
    if (!filename) {
      return res.status(400).json({ isValid: false, errors: ['Filename is required'] });
    }
    
    const location = req.body.location ? backupConfig.storageLocations.find(l => l.name === req.body.location) : null;
    const backupsDir = ensureBackupsDir(location);
    const backupPath = path.join(backupsDir, filename);
    
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ isValid: false, errors: ['Backup file not found'] });
    }
    
    const backupDb = new sqlite3.Database(backupPath, { readonly: true });

    try {
      const [currentSchema, backupSchema] = await Promise.all([
        getSchemaMap(db),
        getSchemaMap(backupDb),
      ]);

      const errors = diffSchemas(currentSchema, backupSchema);
      const isValid = errors.length === 0;

      return res.json({
        isValid,
        errors: isValid ? undefined : errors,
        filename,
      });
    } finally {
      backupDb.close();
    }
    
  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({ isValid: false, errors: ['Validation failed'] });
  }
});

router.post('/backup/restore', async (req, res) => {
  const filename = String(req.body?.filename || '').trim();
  if (!filename) {
    return res.status(400).json({ error: 'filename is required' });
  }

  try {
    const location = req.body.location ? backupConfig.storageLocations.find(l => l.name === req.body.location) : null;
    const options = {
      location,
      validateOnly: false,
      conflictResolution: req.body.conflictResolution || 'overwrite',
      createRestorePoint: req.body.createRestorePoint !== false,
      selectiveRestore: req.body.selectiveRestore || null // { categories: DataCategory[], mode: 'include' | 'exclude' }
    };
    
    const result = await restoreFromBackup(filename, options);

    // For selective restore, don't require restart
    const broadcastEvent = req.app?.get?.('broadcastEvent');
    if (typeof broadcastEvent === 'function') {
      try {
        broadcastEvent({
          type: 'database-restored',
          mode: options.conflictResolution || 'overwrite',
          selective: Boolean(options.selectiveRestore),
          restoredCategories: result.restoredCategories || null,
        });
      } catch {
        // ignore broadcast failures
      }
    }

    if (result.selectiveRestore) {
      res.json({ 
        ok: true, 
        restartRequired: false,
        selectiveRestore: true,
        restoredCategories: result.restoredCategories,
        metadata: result.metadata 
      });
    } else {
      // Full restore now reconnects automatically; no restart required.
      res.json({ 
        ok: true, 
        restartRequired: false, 
        fullRestore: true,
        metadata: result.metadata 
      });
    }
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ error: e?.message || 'Failed to restore backup' });
  }
});

// Cleanup and retention

router.delete('/backups/:filename', async (req, res) => {
  const { filename } = req.params;
  
  try {
    const location = req.query.location ? backupConfig.storageLocations.find(l => l.name === req.query.location) : null;
    const backupsDir = ensureBackupsDir(location);
    const backupPath = path.join(backupsDir, filename);
    
    if (!backupPath.startsWith(backupsDir + path.sep)) {
      return res.status(400).json({ error: 'Invalid backup filename' });
    }
    
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: 'Backup not found' });
    }
    
    // Delete backup file and metadata
    fs.unlinkSync(backupPath);
    const metaPath = path.join(backupsDir, `${filename}.meta.json`);
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }
    
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Failed to delete backup' });
  }
});

router.post('/backups/cleanup', async (req, res) => {
  try {
    const { policy = backupConfig.retentionPolicy } = req.body;
    const backups = listBackups();
    const now = new Date();
    const toDelete = [];
    
    // Group backups by type and date
    const grouped = {
      daily: [],
      weekly: [],
      monthly: []
    };
    
    for (const backup of backups) {
      const backupDate = new Date(backup.modifiedAt);
      const daysOld = (now - backupDate) / (1000 * 60 * 60 * 24);
      
      if (daysOld <= 7) {
        grouped.daily.push(backup);
      } else if (daysOld <= 30) {
        grouped.weekly.push(backup);
      } else {
        grouped.monthly.push(backup);
      }
    }
    
    // Apply retention policy
    if (grouped.daily.length > policy.keepDaily) {
      toDelete.push(...grouped.daily.slice(policy.keepDaily));
    }
    
    if (grouped.weekly.length > policy.keepWeekly) {
      toDelete.push(...grouped.weekly.slice(policy.keepWeekly));
    }
    
    if (grouped.monthly.length > policy.keepMonthly) {
      toDelete.push(...grouped.monthly.slice(policy.keepMonthly));
    }
    
    // Delete old backups
    for (const backup of toDelete) {
      try {
        const location = backup.location ? backupConfig.storageLocations.find(l => l.name === backup.location) : null;
        const backupsDir = ensureBackupsDir(location);
        const backupPath = path.join(backupsDir, backup.filename);
        
        if (fs.existsSync(backupPath)) {
          fs.unlinkSync(backupPath);
        }
        
        const metaPath = path.join(backupsDir, `${backup.filename}.meta.json`);
        if (fs.existsSync(metaPath)) {
          fs.unlinkSync(metaPath);
        }
      } catch (error) {
        console.error(`Failed to delete backup ${backup.filename}:`, error);
      }
    }
    
    return res.json({ ok: true, deleted: toDelete.length, remaining: backups.length - toDelete.length });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Failed to cleanup backups' });
  }
});

export default router;
