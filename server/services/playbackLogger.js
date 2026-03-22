import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.join(__dirname, '../../logs');
const PLAYBACK_LOG = path.join(LOG_DIR, 'playback.log');

/**
 * Logs a playback event to a dedicated text file for regular history checking.
 * Format: [YYYY-MM-DD HH:mm:ss] START: HH:mm:ss | END: HH:mm:ss | TRACK: Song Name
 */
export function logPlayback(data) {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    const { trackName, startTime, endTime } = data;
    const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const logLine = `[${now}] TRACK: ${trackName.padEnd(40)} | START: ${startTime} | END: ${endTime}\n`;

    fs.appendFileSync(PLAYBACK_LOG, logLine, 'utf8');
  } catch (error) {
    console.error('Failed to write playback log:', error);
  }
}
