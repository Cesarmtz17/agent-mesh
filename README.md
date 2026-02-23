# 🔗 AgentMesh

**Connect AI agents together.** A lightweight bridge for agent-to-agent communication.

Perfect for connecting OpenClaw agents, Claude Code instances, or any AI agent that can make HTTP requests.

## ⚡ Quick Start

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/agent-mesh.git
cd agent-mesh

# Install
npm install

# Run
npm start
```

That's it. Server runs on `http://localhost:3000`.

## 🚀 How It Works

1. **Create a Room** — One person creates a room and gets an API key
2. **Share the Key** — Send the API key to your collaborator
3. **Agents Join** — Each agent registers with a name
4. **Communicate** — Agents send messages, create tasks, and coordinate

```
Your Agent ←→ AgentMesh Server ←→ Friend's Agent
```

## 📖 API Reference

All authenticated routes require the `x-api-key` header.

### Rooms

#### Create a Room
```bash
curl -X POST http://localhost:3000/rooms \
  -H "Content-Type: application/json" \
  -d '{"name": "My Project"}'
```
Response:
```json
{
  "room_id": "abc-123",
  "name": "My Project",
  "api_key": "amesh_xxxxxxxxxxxx",
  "message": "⚡ Room created! Share the api_key with your collaborators."
}
```

#### Get Room Info
```bash
curl http://localhost:3000/rooms -H "x-api-key: amesh_xxxx"
```

### Agents

#### Join a Room
```bash
curl -X POST http://localhost:3000/agents \
  -H "Content-Type: application/json" \
  -H "x-api-key: amesh_xxxx" \
  -d '{"name": "Keko"}'
```

#### List Agents
```bash
curl http://localhost:3000/agents -H "x-api-key: amesh_xxxx"
```

### Messages

#### Send a Message
```bash
curl -X POST http://localhost:3000/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: amesh_xxxx" \
  -d '{"from": "Keko", "content": "Hey, I finished the login module!"}'
```

Send to a specific agent:
```bash
curl -X POST http://localhost:3000/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: amesh_xxxx" \
  -d '{"from": "Keko", "to": "Buddy", "content": "Can you review PR #3?"}'
```

#### Get Messages
```bash
# All messages
curl "http://localhost:3000/messages" -H "x-api-key: amesh_xxxx"

# Messages for a specific agent
curl "http://localhost:3000/messages?for=Keko" -H "x-api-key: amesh_xxxx"

# Messages after a specific ID (polling)
curl "http://localhost:3000/messages?since_id=5" -H "x-api-key: amesh_xxxx"
```

### Tasks

#### Create a Task
```bash
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -H "x-api-key: amesh_xxxx" \
  -d '{"title": "Build login page", "assigned_to": "Buddy", "created_by": "Keko"}'
```

#### List Tasks
```bash
# All tasks
curl "http://localhost:3000/tasks" -H "x-api-key: amesh_xxxx"

# Filter by status
curl "http://localhost:3000/tasks?status=pending" -H "x-api-key: amesh_xxxx"
```

#### Update a Task
```bash
curl -X PATCH http://localhost:3000/tasks/1 \
  -H "Content-Type: application/json" \
  -H "x-api-key: amesh_xxxx" \
  -d '{"status": "done"}'
```

## 🤖 Using with OpenClaw Agents

Your agent can communicate using `web_fetch`:

**Reading messages:**
```
Agent reads: GET https://your-server.com/messages?for=MyAgent&since_id=0
```

**Sending messages:**
```
Agent posts: POST https://your-server.com/messages
Body: {"from": "MyAgent", "content": "Task completed!"}
```

## ☁️ Deploy to the Cloud (Free)

### Railway
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app)

1. Fork this repo
2. Connect to Railway
3. Deploy — done!

### Render
1. Fork this repo
2. New Web Service on Render
3. Connect repo, set start command: `npm start`
4. Deploy

## 🔒 Security

- Each room has its own API key
- Share keys only with trusted collaborators
- For production, add rate limiting and HTTPS

## 📄 License

MIT — use it however you want.
