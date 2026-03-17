import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rawUploadPath = process.env.UPLOAD_PATH || 'uploads';
export const uploadsDir = path.isAbsolute(rawUploadPath)
    ? rawUploadPath
    : path.join(__dirname, '..', rawUploadPath);

export const resolveUploadPath = (filePathOrName) => {
    if (!filePathOrName) return '';
    const normalized = filePathOrName.startsWith('/uploads/')
        ? filePathOrName.slice(9)
        : filePathOrName;
    const resolved = path.resolve(uploadsDir, normalized);
    const root = path.resolve(uploadsDir) + path.sep;
    if (!resolved.startsWith(root)) {
        throw new Error('Invalid upload path: outside of uploads dir');
    }
    return resolved;
};
