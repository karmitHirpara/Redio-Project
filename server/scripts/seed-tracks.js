import { run, db } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

async function seed() {
    console.log('Seeding 1000 mock tracks...');
    try {
        await run('BEGIN TRANSACTION');
        for (let i = 1; i <= 1000; i++) {
            const id = uuidv4();
            await run(
                'INSERT INTO tracks (id, name, artist, duration, size, file_path, hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [id, `Mock Track ${i}`, 'Mock Artist', 180, 5000000, `/uploads/mock_${i}.mp3`, `hash_${i}`]
            );
            if (i % 100 === 0) console.log(`Seeded ${i} tracks...`);
        }
        await run('COMMIT');
        console.log('Successfully seeded 1000 tracks.');
    } catch (error) {
        console.error('Seeding failed:', error);
        await run('ROLLBACK');
    } finally {
        db.close();
    }
}

seed();
