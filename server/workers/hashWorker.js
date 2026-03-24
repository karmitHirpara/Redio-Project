import { parentPort, workerData } from 'worker_threads';
import crypto from 'crypto';
import fs from 'fs';

const { absolutePath } = workerData;

async function run() {
    try {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(absolutePath);
        
        stream.on('data', (chunk) => {
            hash.update(chunk);
        });

        stream.on('end', () => {
            parentPort.postMessage({ hash: hash.digest('hex') });
        });

        stream.on('error', (err) => {
            parentPort.postMessage({ error: err.message });
        });
    } catch (err) {
        parentPort.postMessage({ error: err.message });
    }
}

run();
