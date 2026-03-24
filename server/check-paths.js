import sqlite3 from 'sqlite3';
const db = new sqlite3.Database('database.sqlite');
db.all("SELECT id, file_path FROM tracks LIMIT 5", (err, rows) => {
    if (err) console.error(err);
    else {
        rows.forEach(r => console.log(`ID: ${r.id}, Path: "${r.file_path}"`));
    }
    db.close();
});
