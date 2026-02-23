require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());

// --- Database Setup ---
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'agentmesh.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    name TEXT NOT NULL,
    joined_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (room_id) REFERENCES rooms(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    from_agent TEXT NOT NULL,
    to_agent TEXT,
    content TEXT NOT NULL,
    type TEXT DEFAULT 'message',
    read_by TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (room_id) REFERENCES rooms(id)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    assigned_to TEXT,
    status TEXT DEFAULT 'pending',
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (room_id) REFERENCES rooms(id)
  );
`);

// --- Auth Middleware ---
function auth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing x-api-key header' });

  const room = db.prepare('SELECT * FROM rooms WHERE api_key = ?').get(apiKey);
  if (!room) return res.status(403).json({ error: 'Invalid API key' });

  req.room = room;
  next();
}

// --- Room Routes ---

// Create a new room (no auth needed)
app.post('/rooms', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const id = crypto.randomUUID();
  const api_key = 'amesh_' + crypto.randomBytes(24).toString('hex');

  db.prepare('INSERT INTO rooms (id, name, api_key) VALUES (?, ?, ?)').run(id, name, api_key);

  res.status(201).json({
    room_id: id,
    name,
    api_key,
    message: '⚡ Room created! Share the api_key with your collaborators.'
  });
});

// Get room info
app.get('/rooms', auth, (req, res) => {
  const agents = db.prepare('SELECT id, name, joined_at FROM agents WHERE room_id = ?').all(req.room.id);
  res.json({ room: { id: req.room.id, name: req.room.name, created_at: req.room.created_at }, agents });
});

// --- Agent Routes ---

// Join a room
app.post('/agents', auth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const id = crypto.randomUUID();
  const existing = db.prepare('SELECT * FROM agents WHERE room_id = ? AND name = ?').get(req.room.id, name);
  if (existing) return res.json({ agent: existing, message: 'Agent already in room' });

  db.prepare('INSERT INTO agents (id, room_id, name) VALUES (?, ?, ?)').run(id, req.room.id, name);
  res.status(201).json({ agent: { id, name, room_id: req.room.id }, message: `${name} joined the room!` });
});

// List agents in room
app.get('/agents', auth, (req, res) => {
  const agents = db.prepare('SELECT id, name, joined_at FROM agents WHERE room_id = ?').all(req.room.id);
  res.json({ agents });
});

// --- Message Routes ---

// Send a message
app.post('/messages', auth, (req, res) => {
  const { from, to, content, type } = req.body;
  if (!from || !content) return res.status(400).json({ error: 'from and content are required' });

  const result = db.prepare(
    'INSERT INTO messages (room_id, from_agent, to_agent, content, type) VALUES (?, ?, ?, ?, ?)'
  ).run(req.room.id, from, to || null, content, type || 'message');

  res.status(201).json({ id: result.lastInsertRowid, message: 'Message sent' });
});

// Get messages (with optional filters)
app.get('/messages', auth, (req, res) => {
  const { for: forAgent, since_id, limit } = req.query;
  const maxLimit = Math.min(parseInt(limit) || 50, 200);

  let query = 'SELECT * FROM messages WHERE room_id = ?';
  const params = [req.room.id];

  if (forAgent) {
    query += ' AND (to_agent = ? OR to_agent IS NULL)';
    params.push(forAgent);
  }

  if (since_id) {
    query += ' AND id > ?';
    params.push(parseInt(since_id));
  }

  query += ' ORDER BY id DESC LIMIT ?';
  params.push(maxLimit);

  const messages = db.prepare(query).all(...params);
  res.json({ messages: messages.reverse() });
});

// Mark messages as read
app.post('/messages/read', auth, (req, res) => {
  const { agent, up_to_id } = req.body;
  if (!agent || !up_to_id) return res.status(400).json({ error: 'agent and up_to_id required' });

  const messages = db.prepare(
    'SELECT id, read_by FROM messages WHERE room_id = ? AND id <= ? AND to_agent IS NULL OR to_agent = ?'
  ).all(req.room.id, up_to_id, agent);

  const update = db.prepare('UPDATE messages SET read_by = ? WHERE id = ?');
  let count = 0;

  for (const msg of messages) {
    const readBy = JSON.parse(msg.read_by);
    if (!readBy.includes(agent)) {
      readBy.push(agent);
      update.run(JSON.stringify(readBy), msg.id);
      count++;
    }
  }

  res.json({ marked: count });
});

// --- Task Routes ---

// Create a task
app.post('/tasks', auth, (req, res) => {
  const { title, description, assigned_to, created_by } = req.body;
  if (!title || !created_by) return res.status(400).json({ error: 'title and created_by required' });

  const result = db.prepare(
    'INSERT INTO tasks (room_id, title, description, assigned_to, created_by) VALUES (?, ?, ?, ?, ?)'
  ).run(req.room.id, title, description || null, assigned_to || null, created_by);

  res.status(201).json({ id: result.lastInsertRowid, message: 'Task created' });
});

// List tasks
app.get('/tasks', auth, (req, res) => {
  const { status, assigned_to } = req.query;

  let query = 'SELECT * FROM tasks WHERE room_id = ?';
  const params = [req.room.id];

  if (status) { query += ' AND status = ?'; params.push(status); }
  if (assigned_to) { query += ' AND assigned_to = ?'; params.push(assigned_to); }

  query += ' ORDER BY created_at DESC';
  const tasks = db.prepare(query).all(...params);
  res.json({ tasks });
});

// Update a task
app.patch('/tasks/:id', auth, (req, res) => {
  const { status, assigned_to, title, description } = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND room_id = ?').get(req.params.id, req.room.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const updates = [];
  const params = [];

  if (status) { updates.push('status = ?'); params.push(status); }
  if (assigned_to) { updates.push('assigned_to = ?'); params.push(assigned_to); }
  if (title) { updates.push('title = ?'); params.push(title); }
  if (description) { updates.push('description = ?'); params.push(description); }

  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  updates.push("updated_at = datetime('now')");
  params.push(req.params.id, req.room.id);

  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ? AND room_id = ?`).run(...params);
  res.json({ message: 'Task updated' });
});

// --- Health ---
app.get('/', (req, res) => {
  res.json({
    name: 'AgentMesh',
    version: '1.0.0',
    description: 'Agent-to-agent communication bridge',
    docs: 'See /help for API reference'
  });
});

app.get('/help', (req, res) => {
  res.json({
    endpoints: {
      'POST /rooms': 'Create a room → returns api_key',
      'GET /rooms': 'Room info + agents (auth required)',
      'POST /agents': 'Join a room (auth required)',
      'GET /agents': 'List agents in room (auth required)',
      'POST /messages': 'Send a message (auth required)',
      'GET /messages': 'Get messages, ?for=agent&since_id=N (auth required)',
      'POST /messages/read': 'Mark messages as read (auth required)',
      'POST /tasks': 'Create a task (auth required)',
      'GET /tasks': 'List tasks, ?status=pending&assigned_to=agent (auth required)',
      'PATCH /tasks/:id': 'Update task status/assignment (auth required)'
    },
    auth: 'All authenticated routes require x-api-key header'
  });
});

// --- Start ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🔗 AgentMesh running on http://localhost:${PORT}`);
  console.log(`📖 API docs: http://localhost:${PORT}/help\n`);
});
