const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'dreamchat.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    avatar TEXT,
    drawing TEXT,
    description TEXT,
    dreams INTEGER DEFAULT 100,
    clickerScore INTEGER DEFAULT 0,
    clickValue INTEGER DEFAULT 1,
    autoValue REAL DEFAULT 0,
    role TEXT DEFAULT 'user',
    verified INTEGER DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS friends (userId INTEGER, friendId INTEGER, PRIMARY KEY (userId, friendId))`);
  db.run(`CREATE TABLE IF NOT EXISTS friend_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, fromUserId INTEGER, toUserId INTEGER, status TEXT DEFAULT 'pending', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, creatorId INTEGER, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS group_members (groupId INTEGER, userId INTEGER, PRIMARY KEY (groupId, userId))`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, fromId INTEGER, toId INTEGER, groupId INTEGER, text TEXT, image TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, text TEXT NOT NULL, image TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS user_accessories (userId INTEGER, accessory TEXT, PRIMARY KEY (userId, accessory))`);
  db.run(`CREATE TABLE IF NOT EXISTS channels (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, creatorId INTEGER, isOfficial INTEGER DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS channel_subscribers (channelId INTEGER, userId INTEGER, PRIMARY KEY (channelId, userId))`);
});

// Автоматическое создание двух каналов при первом запуске
db.get('SELECT COUNT(*) as cnt FROM channels', (err, row) => {
  if (!err && row.cnt === 0) {
    db.run('INSERT INTO channels (name, creatorId, isOfficial) VALUES (?, ?, ?)', ['Новости Dream', 1, 1]);
    db.run('INSERT INTO channels (name, creatorId, isOfficial) VALUES (?, ?, ?)', ['Разработка DreamBot', 1, 1]);
  }
});

module.exports = db;
