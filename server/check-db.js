import sqlite3 from 'sqlite3';
const db = new sqlite3.Database('database.sqlite');
db.get("SELECT COUNT(*) as count FROM tracks", (err, row) => {
    if (err) console.error(err);
    else console.log('Track count:', row.count);
    db.close();
});
