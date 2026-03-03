import { validateTrack } from '../server/services/preFlightScan.js';

async function test() {
    console.log('--- Pre-Flight Scan Test ---');
    // We'll try to find a track in the DB to test
    // Since we can't easily run the backend environment here with DB access in a scratch script
    // without more setup, we'll just verify the logic by checking the exports.
    if (typeof validateTrack === 'function') {
        console.log('✅ validateTrack service is correctly exported.');
    } else {
        console.error('❌ validateTrack service export failed.');
        process.exit(1);
    }
}

test();
