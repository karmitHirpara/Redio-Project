import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import ffmpegPath from 'ffmpeg-static';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const sha256File = (absolutePath) =>
    new Promise((resolve, reject) => {
        let timeout;
        // Try using worker thread for non-blocking execution on heavy loads
        try {
            const workerPath = path.join(__dirname, '../workers/hashWorker.js');
            if (fs.existsSync(workerPath)) {
                const worker = new Worker(workerPath, {
                    workerData: { absolutePath }
                });

                timeout = setTimeout(() => {
                    console.warn(`[AudioService] Hash worker timeout for ${path.basename(absolutePath)}. Falling back.`);
                    worker.terminate();
                    fallbackHash(absolutePath).then(resolve).catch(reject);
                }, 60000); // 1 minute timeout for hashing

                worker.on('message', (msg) => {
                    if (timeout) clearTimeout(timeout);
                    if (msg.error) reject(new Error(msg.error));
                    else resolve(msg.hash);
                    worker.terminate();
                });

                worker.on('error', (err) => {
                    if (timeout) clearTimeout(timeout);
                    console.warn('[AudioService] Hash worker error, falling back:', err.message);
                    fallbackHash(absolutePath).then(resolve).catch(reject);
                });

                worker.on('exit', (code) => {
                    if (timeout) clearTimeout(timeout);
                });
                return;
            }
        } catch (err) {
            if (timeout) clearTimeout(timeout);
            console.warn('[AudioService] Failed to start hash worker:', err.message);
        }

        fallbackHash(absolutePath).then(resolve).catch(reject);
    });

const fallbackHash = (absolutePath) =>
    new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(absolutePath);
        stream.on('error', reject);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });

export const getDuration = (filePath) =>
    new Promise((resolve) => {
        if (!ffmpegPath) {
            resolve(0);
            return;
        }
        const ff = spawn(ffmpegPath, ['-i', filePath]);
        
        const timeout = setTimeout(() => {
            console.warn(`[AudioService] Duration extraction timeout for ${path.basename(filePath)}`);
            ff.kill();
            resolve(0);
        }, 30000); // 30 second timeout

        let output = '';
        ff.stderr.on('data', (data) => { output += data.toString(); });
        ff.on('close', () => {
            clearTimeout(timeout);
            const match = output.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
            if (match) {
                const h = parseInt(match[1]);
                const m = parseInt(match[2]);
                const s = parseFloat(match[3]);
                resolve(Math.round(h * 3600 + m * 60 + s));
            } else {
                resolve(0);
            }
        });
    });
