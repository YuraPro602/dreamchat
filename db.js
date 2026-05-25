const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
const dbPath = path.join(dataDir, 'dreamchat.sqlite');
const db = new sqlite3.Database(dbPath);
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    avatar TEXT,
    description TEXT,
    dreams INTEGER DEFAULT 100,
    clickerScore INTEGER DEFAULT 0,
    clickValue INTEGER DEFAULT 1,
    autoValue REAL DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fromId INTEGER,
    toId INTEGER,
    text TEXT,
    image TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});
module.exports = db;
