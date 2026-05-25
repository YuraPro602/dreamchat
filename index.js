const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'admin'))); // админка

const JWT_SECRET = process.env.JWT_SECRET || 'dreamchat_secret_key_change_me';
const PORT = process.env.PORT || 3001;

// ---------- Auth middleware ----------
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.userId = jwt.verify(token, JWT_SECRET).userId;
    next();
  } catch(e) { res.status(401).json({ error: 'Invalid token' }); }
}

// ---------- Health check ----------
app.get('/', (req, res) => res.sendStatus(200));

// ---------- Регистрация ----------
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const hashed = await bcrypt.hash(password, 10);
  const role = username === 'Admin' ? 'admin' : 'user';
  db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashed, role], function(err) {
    if (err) return res.status(400).json({ error: 'Username taken' });
    const token = jwt.sign({ userId: this.lastID }, JWT_SECRET);
    res.json({ token, userId: this.lastID, username, role });
  });
});

// ---------- Логин ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET);
    res.json({ token, userId: user.id, username: user.username, role: user.role });
  });
});

// ---------- Получение данных пользователя ----------
app.get('/api/user', authenticate, (req, res) => {
  db.get('SELECT id, username, avatar, drawing, description, dreams, clickerScore, clickValue, autoValue, role FROM users WHERE id = ?', [req.userId], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(user);
  });
});

// ---------- Аватар и рисунок ----------
app.post('/api/user/avatar', authenticate, (req, res) => {
  const { avatar } = req.body;
  db.run('UPDATE users SET avatar = ? WHERE id = ?', [avatar, req.userId]);
  res.json({ success: true });
});
app.post('/api/user/drawing', authenticate, (req, res) => {
  const { drawing } = req.body;
  db.run('UPDATE users SET drawing = ? WHERE id = ?', [drawing, req.userId]);
  res.json({ success: true });
});

// ---------- Поиск пользователей ----------
app.get('/api/users/search', authenticate, (req, res) => {
  const q = req.query.q || '';
  db.all('SELECT id, username, avatar FROM users WHERE username LIKE ? AND id != ?', [`%${q}%`, req.userId], (err, rows) => {
    res.json(rows || []);
  });
});

// ---------- Друзья и запросы ----------
app.get('/api/friends', authenticate, (req, res) => {
  db.all('SELECT u.id, u.username, u.avatar FROM friends f JOIN users u ON u.id = f.friendId WHERE f.userId = ?', [req.userId], (err, rows) => res.json(rows || []));
});
app.get('/api/friend-requests', authenticate, (req, res) => {
  db.all('SELECT fr.id, u.id as userId, u.username FROM friend_requests fr JOIN users u ON u.id = fr.fromUserId WHERE fr.toUserId = ? AND fr.status = "pending"', [req.userId], (err, rows) => res.json(rows || []));
});
app.post('/api/friends/request', authenticate, (req, res) => {
  const { toUserId } = req.body;
  db.get('SELECT username FROM users WHERE id = ?', [req.userId], (err, user) => {
    db.run('INSERT INTO friend_requests (fromUserId, toUserId) VALUES (?, ?)', [req.userId, toUserId]);
    const targetSocket = userSockets.get(toUserId);
    if(targetSocket) io.to(targetSocket).emit('friend_request', { fromUserId: req.userId, fromUsername: user.username });
    res.json({ success: true });
  });
});
app.post('/api/friends/accept', authenticate, (req, res) => {
  const { requestId } = req.body;
  db.get('SELECT fromUserId, toUserId FROM friend_requests WHERE id = ?', [requestId], (err, row) => {
    if(row) {
      db.run('INSERT OR IGNORE INTO friends (userId, friendId) VALUES (?, ?)', [row.fromUserId, row.toUserId]);
      db.run('INSERT OR IGNORE INTO friends (userId, friendId) VALUES (?, ?)', [row.toUserId, row.fromUserId]);
      db.run('UPDATE friend_requests SET status = "accepted" WHERE id = ?', [requestId]);
    }
    res.json({ success: true });
  });
});
app.post('/api/friends/decline', authenticate, (req, res) => {
  const { requestId } = req.body;
  db.run('UPDATE friend_requests SET status = "declined" WHERE id = ?', [requestId]);
  res.json({ success: true });
});

// ---------- Группы ----------
app.get('/api/groups', authenticate, (req, res) => {
  db.all('SELECT g.id, g.name, g.creatorId FROM groups g JOIN group_members gm ON gm.groupId = g.id WHERE gm.userId = ?', [req.userId], (err, rows) => res.json(rows || []));
});
app.post('/api/groups', authenticate, (req, res) => {
  const { name, members } = req.body;
  db.run('INSERT INTO groups (name, creatorId) VALUES (?, ?)', [name, req.userId], function(err) {
    if(err) return res.status(500).json({ error: err.message });
    const groupId = this.lastID;
    const stmt = db.prepare('INSERT INTO group_members (groupId, userId) VALUES (?, ?)');
    stmt.run(groupId, req.userId);
    if(members && members.length) members.forEach(m => stmt.run(groupId, m));
    stmt.finalize();
    res.json({ groupId });
  });
});

// ---------- История сообщений ----------
app.get('/api/messages', authenticate, (req, res) => {
  const { chatId, type } = req.query;
  if(type === 'private') {
    db.all('SELECT * FROM messages WHERE (fromId = ? AND toId = ?) OR (fromId = ? AND toId = ?) ORDER BY timestamp ASC', [req.userId, chatId, chatId, req.userId], (err, rows) => res.json(rows || []));
  } else if(type === 'group') {
    db.all('SELECT * FROM messages WHERE groupId = ? ORDER BY timestamp ASC', [chatId], (err, rows) => res.json(rows || []));
  } else res.json([]);
});

// ---------- Кликер ----------
app.post('/api/clicker/click', authenticate, (req, res) => {
  db.get('SELECT clickValue, clickerScore FROM users WHERE id = ?', [req.userId], (err, user) => {
    if(!user) return res.status(404).json({ error: 'User not found' });
    let newScore = user.clickerScore + user.clickValue;
    db.run('UPDATE users SET clickerScore = ? WHERE id = ?', [newScore, req.userId]);
    res.json({ newScore });
  });
});
app.post('/api/clicker/upgrade', authenticate, (req, res) => {
  const { type } = req.body;
  db.get('SELECT clickerScore, clickValue, autoValue FROM users WHERE id = ?', [req.userId], (err, user) => {
    if(!user) return res.status(404).json({ error: 'User not found' });
    if(type === 'click' && user.clickerScore >= 10) {
      const newScore = user.clickerScore - 10;
      const newClickValue = user.clickValue + 1;
      db.run('UPDATE users SET clickerScore = ?, clickValue = ? WHERE id = ?', [newScore, newClickValue, req.userId]);
      res.json({ success: true, clickValue: newClickValue, clickerScore: newScore });
    } else if(type === 'auto' && user.clickerScore >= 50) {
      const newScore = user.clickerScore - 50;
      const newAutoValue = (user.autoValue || 0) + 0.5;
      db.run('UPDATE users SET clickerScore = ?, autoValue = ? WHERE id = ?', [newScore, newAutoValue, req.userId]);
      res.json({ success: true, autoValue: newAutoValue, clickerScore: newScore });
    } else res.status(400).json({ error: 'Not enough points' });
  });
});

// ---------- Магазин ----------
app.post('/api/shop/buy_dreams', authenticate, (req, res) => {
  const { amount } = req.body;
  db.get('SELECT dreams FROM users WHERE id = ?', [req.userId], (err, user) => {
    if(!user) return res.status(404).json({ error: 'User not found' });
    let newDreams = (user.dreams || 0) + amount;
    db.run('UPDATE users SET dreams = ? WHERE id = ?', [newDreams, req.userId]);
    res.json({ dreams: newDreams });
  });
});
app.post('/api/shop/buy_accessory', authenticate, (req, res) => {
  const { accessory } = req.body;
  db.get('SELECT dreams FROM users WHERE id = ?', [req.userId], (err, user) => {
    if(!user) return res.status(404).json({ error: 'User not found' });
    if(user.dreams >= 100 && accessory === 'gold') {
      const newDreams = user.dreams - 100;
      db.run('UPDATE users SET dreams = ? WHERE id = ?', [newDreams, req.userId]);
      db.run('INSERT INTO user_accessories (userId, accessory) VALUES (?, ?)', [req.userId, accessory]);
      res.json({ success: true, dreams: newDreams });
    } else res.status(400).json({ error: 'Not enough dreams' });
  });
});

// ---------- Аксессуары ----------
app.get('/api/user/accessories', authenticate, (req, res) => {
  db.all('SELECT accessory FROM user_accessories WHERE userId = ?', [req.userId], (err, rows) => {
    res.json(rows.map(r => r.accessory));
  });
});

// ---------- Профиль другого пользователя ----------
app.get('/api/user/profile/:identifier', authenticate, (req, res) => {
  const identifier = req.params.identifier;
  const isId = !isNaN(identifier);
  const query = isId ? 'SELECT id, username, avatar, description FROM users WHERE id = ?' : 'SELECT id, username, avatar, description FROM users WHERE username = ?';
  db.get(query, [identifier], (err, user) => {
    if(err || !user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  });
});

// ---------- Посты ----------
app.post('/api/posts', authenticate, (req, res) => {
  const { text, image } = req.body;
  db.run('INSERT INTO posts (userId, text, image) VALUES (?, ?, ?)', [req.userId, text, image || null], function(err) {
    if(err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});
app.get('/api/posts', authenticate, (req, res) => {
  db.all(`SELECT p.*, u.username, u.avatar FROM posts p JOIN users u ON u.id = p.userId ORDER BY p.timestamp DESC LIMIT 50`, (err, rows) => {
    res.json(rows || []);
  });
});

// ---------- Админ-панель ----------
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});
app.get('/api/admin/users', authenticate, (req, res) => {
  db.get('SELECT role FROM users WHERE id = ?', [req.userId], (err, user) => {
    if(err || !user || user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    db.all('SELECT id, username, dreams, role, createdAt FROM users', (err, rows) => res.json(rows || []));
  });
});
app.delete('/api/admin/user/:id', authenticate, (req, res) => {
  db.get('SELECT role FROM users WHERE id = ?', [req.userId], (err, user) => {
    if(err || !user || user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });
});
app.get('/api/admin/messages', authenticate, (req, res) => {
  db.get('SELECT role FROM users WHERE id = ?', [req.userId], (err, user) => {
    if(err || !user || user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    db.all(`SELECT m.*, u1.username as fromUsername, u2.username as toUsername FROM messages m LEFT JOIN users u1 ON u1.id = m.fromId LEFT JOIN users u2 ON u2.id = m.toId ORDER BY m.timestamp DESC LIMIT 100`, (err, rows) => res.json(rows || []));
  });
});

// ---------- WebSocket и звонки ----------
const userSockets = new Map();

io.on('connection', (socket) => {
  let userId = null;

  socket.on('auth', (token) => {
    try {
      userId = jwt.verify(token, JWT_SECRET).userId;
      userSockets.set(userId, socket.id);
      console.log(`User ${userId} connected`);
    } catch(e) { socket.emit('error', 'Auth failed'); }
  });

  socket.on('send_message', (data) => {
    if(!userId) return;
    const { toId, groupId, text, image } = data;
    const timestamp = Date.now();

    // Автоматическое добавление в друзья при первом сообщении
    if(toId && !groupId) {
      db.get('SELECT * FROM friends WHERE (userId = ? AND friendId = ?) OR (userId = ? AND friendId = ?)', [userId, toId, toId, userId], (err, row) => {
        if(!row) {
          db.run('INSERT OR IGNORE INTO friends (userId, friendId) VALUES (?, ?)', [userId, toId]);
          db.run('INSERT OR IGNORE INTO friends (userId, friendId) VALUES (?, ?)', [toId, userId]);
        }
      });
    }

    db.run('INSERT INTO messages (fromId, toId, groupId, text, image, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, toId || null, groupId || null, text, image, timestamp],
      function(err) {
        if(err) return;
        const msgData = { id: this.lastID, fromId: userId, text, image, timestamp };
        if(toId) {
          const targetSocket = userSockets.get(toId);
          if(targetSocket) io.to(targetSocket).emit('new_message', msgData);
          socket.emit('new_message', msgData);
        } else if(groupId) {
          db.all('SELECT userId FROM group_members WHERE groupId = ?', [groupId], (err, members) => {
            if(err) return;
            members.forEach(m => {
              const sock = userSockets.get(m.userId);
              if(sock) io.to(sock).emit('new_message', msgData);
            });
          });
        }
      });
  });

  socket.on('call_offer', (data) => {
    const targetSocket = userSockets.get(data.to);
    if(targetSocket) io.to(targetSocket).emit('call_offer', { fromUserId: userId, offer: data.offer, isVideo: data.isVideo, fromUsername: data.fromUsername });
  });
  socket.on('call_answer', (data) => {
    const targetSocket = userSockets.get(data.to);
    if(targetSocket) io.to(targetSocket).emit('call_answer', { answer: data.answer });
  });
  socket.on('call_signal', (data) => {
    const targetSocket = userSockets.get(data.to);
    if(targetSocket) io.to(targetSocket).emit('call_signal', { signal: data.signal });
  });
  socket.on('call_decline', (data) => {
    const targetSocket = userSockets.get(data.to);
    if(targetSocket) io.to(targetSocket).emit('call_decline');
  });

  socket.on('disconnect', () => {
    if(userId) userSockets.delete(userId);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`DreamChat server running on port ${PORT}`);
});
