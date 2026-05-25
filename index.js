// Аватар и рисунок
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

// Таблица и API для запросов в друзья
db.run(`CREATE TABLE IF NOT EXISTS friend_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, fromUserId INTEGER, toUserId INTEGER, status TEXT DEFAULT 'pending', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)`);
app.get('/api/friend-requests', authenticate, (req, res) => {
  db.all('SELECT fr.id, u.id as userId, u.username FROM friend_requests fr JOIN users u ON u.id = fr.fromUserId WHERE fr.toUserId = ? AND fr.status = "pending"', [req.userId], (err, rows) => res.json(rows||[]));
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

// История сообщений
app.get('/api/messages', authenticate, (req, res) => {
  const { chatId, type } = req.query;
  if(type === 'private') {
    db.all('SELECT * FROM messages WHERE (fromId = ? AND toId = ?) OR (fromId = ? AND toId = ?) ORDER BY timestamp ASC', [req.userId, chatId, chatId, req.userId], (err, rows) => res.json(rows||[]));
  } else if(type === 'group') {
    db.all('SELECT * FROM messages WHERE groupId = ? ORDER BY timestamp ASC', [chatId], (err, rows) => res.json(rows||[]));
  } else res.json([]);
});