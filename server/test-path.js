import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, 'uploads');
const testFile = 'library/Long Audio File - Copy _3_.mp3';
const fullPath = path.join(uploadsDir, testFile);

console.log('Uploads Dir:', uploadsDir);
console.log('Test File:', testFile);
console.log('Full Path:', fullPath);
console.log('Exists:', fs.existsSync(fullPath));

// Also list files in library to be sure
const libraryDir = path.join(uploadsDir, 'library');
if (fs.existsSync(libraryDir)) {
    console.log('Files in library:', fs.readdirSync(libraryDir).slice(0, 5));
} else {
    console.log('Library dir NOT FOUND');
}
