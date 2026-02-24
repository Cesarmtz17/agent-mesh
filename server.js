require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// --- JSON File Database ---
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.json');

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) { console.error('DB load error:', e.message); }
  return { rooms: [], agents: [], messages: [], tasks: [] };
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Initialize
if (!fs.existsSync(DB_PATH)) saveDB({ rooms: [], agents: [], messages: [], tasks: [] });

// --- Auth Middleware ---
function auth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing x-api-key header' });

  const db = loadDB();
  const room = db.rooms.find(r => r.api_key === apiKey);
  if (!room) return res.status(403).json({ error: 'Invalid API key' });

  req.room = room;
  req.db = db;
  next();
}

// --- Room Routes ---

app.post('/rooms', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const db = loadDB();
  const room = {
    id: crypto.randomUUID(),
    name,
    api_key: 'amesh_' + crypto.randomBytes(24).toString('hex'),
    created_at: new Date().toISOString()
  };

  db.rooms.push(room);
  saveDB(db);

  res.status(201).json({
    room_id: room.id,
    name: room.name,
    api_key: room.api_key,
    message: '⚡ Room created! Share the api_key with your collaborators.'
  });
});

app.get('/rooms', auth, (req, res) => {
  const agents = req.db.agents.filter(a => a.room_id === req.room.id);
  res.json({
    room: { id: req.room.id, name: req.room.name, created_at: req.room.created_at },
    agents: agents.map(a => ({ id: a.id, name: a.name, joined_at: a.joined_at }))
  });
});

// --- Agent Routes ---

app.post('/agents', auth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const db = req.db;
  const existing = db.agents.find(a => a.room_id === req.room.id && a.name === name);
  if (existing) return res.json({ agent: existing, message: 'Agent already in room' });

  const agent = {
    id: crypto.randomUUID(),
    room_id: req.room.id,
    name,
    joined_at: new Date().toISOString()
  };

  db.agents.push(agent);
  saveDB(db);
  res.status(201).json({ agent, message: `${name} joined the room!` });
});

app.get('/agents', auth, (req, res) => {
  const agents = req.db.agents.filter(a => a.room_id === req.room.id);
  res.json({ agents: agents.map(a => ({ id: a.id, name: a.name, joined_at: a.joined_at })) });
});

// --- Message Routes ---

app.post('/messages', auth, (req, res) => {
  const { from, to, content, type } = req.body;
  if (!from || !content) return res.status(400).json({ error: 'from and content are required' });

  const db = req.db;
  const id = (db.messages.length > 0) ? db.messages[db.messages.length - 1].id + 1 : 1;

  const msg = {
    id,
    room_id: req.room.id,
    from_agent: from,
    to_agent: to || null,
    content,
    type: type || 'message',
    read_by: [],
    created_at: new Date().toISOString()
  };

  db.messages.push(msg);
  saveDB(db);
  res.status(201).json({ id: msg.id, message: 'Message sent' });
});

app.get('/messages', auth, (req, res) => {
  const { for: forAgent, since_id, limit } = req.query;
  const maxLimit = Math.min(parseInt(limit) || 50, 200);

  let messages = req.db.messages.filter(m => m.room_id === req.room.id);

  if (forAgent) {
    messages = messages.filter(m => m.to_agent === forAgent || m.to_agent === null);
  }

  if (since_id) {
    messages = messages.filter(m => m.id > parseInt(since_id));
  }

  messages = messages.slice(-maxLimit);
  res.json({ messages });
});

app.post('/messages/read', auth, (req, res) => {
  const { agent, up_to_id } = req.body;
  if (!agent || !up_to_id) return res.status(400).json({ error: 'agent and up_to_id required' });

  const db = req.db;
  let count = 0;

  for (const msg of db.messages) {
    if (msg.room_id === req.room.id && msg.id <= up_to_id) {
      if (msg.to_agent === null || msg.to_agent === agent) {
        if (!msg.read_by.includes(agent)) {
          msg.read_by.push(agent);
          count++;
        }
      }
    }
  }

  saveDB(db);
  res.json({ marked: count });
});

// --- Task Routes ---

app.post('/tasks', auth, (req, res) => {
  const { title, description, assigned_to, created_by } = req.body;
  if (!title || !created_by) return res.status(400).json({ error: 'title and created_by required' });

  const db = req.db;
  const id = (db.tasks.length > 0) ? db.tasks[db.tasks.length - 1].id + 1 : 1;

  const task = {
    id,
    room_id: req.room.id,
    title,
    description: description || null,
    assigned_to: assigned_to || null,
    status: 'pending',
    created_by,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  db.tasks.push(task);
  saveDB(db);
  res.status(201).json({ id: task.id, message: 'Task created' });
});

app.get('/tasks', auth, (req, res) => {
  const { status, assigned_to } = req.query;
  let tasks = req.db.tasks.filter(t => t.room_id === req.room.id);

  if (status) tasks = tasks.filter(t => t.status === status);
  if (assigned_to) tasks = tasks.filter(t => t.assigned_to === assigned_to);

  res.json({ tasks: tasks.reverse() });
});

app.patch('/tasks/:id', auth, (req, res) => {
  const { status, assigned_to, title, description } = req.body;
  const db = req.db;
  const task = db.tasks.find(t => t.id === parseInt(req.params.id) && t.room_id === req.room.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (status) task.status = status;
  if (assigned_to) task.assigned_to = assigned_to;
  if (title) task.title = title;
  if (description) task.description = description;
  task.updated_at = new Date().toISOString();

  saveDB(db);
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
