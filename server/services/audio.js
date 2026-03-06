import crypto from 'crypto';
import fs from 'fs';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

export const sha256File = (absolutePath) =>
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
        let output = '';
        ff.stderr.on('data', (data) => { output += data.toString(); });
        ff.on('close', () => {
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
