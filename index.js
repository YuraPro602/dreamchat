const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'dreamchat_secret';
const PORT = process.env.PORT || 3001;

// Health check для Render
app.get('/', (req, res) => res.sendStatus(200));

// Регистрация
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const hashed = await bcrypt.hash(password, 10);
  db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashed], function(err) {
    if (err) return res.status(400).json({ error: 'Username taken' });
    const token = jwt.sign({ userId: this.lastID }, JWT_SECRET);
    res.json({ token, userId: this.lastID, username });
  });
});

// Логин
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET);
    res.json({ token, userId: user.id, username: user.username });
  });
});

// Получение пользователя
app.get('/api/user', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    db.get('SELECT id, username, avatar, description, dreams, clickerScore, clickValue, autoValue FROM users WHERE id = ?', [decoded.userId], (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(user);
    });
  } catch(e) { res.status(401).json({ error: 'Invalid token' }); }
});

// Остальные API (друзья, группы, сообщения) – добавьте по необходимости.
// Для минимальной работы достаточно регистрации/логина и /user.

// WebSocket (минимально)
const userSockets = new Map();
io.on('connection', (socket) => {
  let userId = null;
  socket.on('auth', (token) => {
    try { userId = jwt.verify(token, JWT_SECRET).userId; userSockets.set(userId, socket.id); } catch(e) {}
  });
  socket.on('send_message', (data) => {
    if (!userId) return;
    const { toId, text, image } = data;
    db.run('INSERT INTO messages (fromId, toId, text, image, timestamp) VALUES (?, ?, ?, ?, ?)', [userId, toId, text, image, Date.now()]);
    const target = userSockets.get(toId);
    if(target) io.to(target).emit('new_message', { fromId: userId, text, image });
    socket.emit('new_message', { fromId: userId, text, image });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`DreamChat server running on port ${PORT}`);
});
