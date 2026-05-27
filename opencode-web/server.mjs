import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.argv[2] || '4103', 10);
const PROJECT_DIR = path.resolve(__dirname, '..');
const SESSIONS_DIR = path.join(__dirname, 'sessions');
const PUBLIC_DIR = path.join(__dirname, 'public');
const OPENCODE_PATH = path.join(PROJECT_DIR, 'opencode', 'opencode.exe');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// --- Helpers ---

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  const mimeType = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeType });
    res.end(data);
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function loadSession(id) {
  const filePath = path.join(SESSIONS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error('Session not found');
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function saveSession(session) {
  session.updated = new Date().toISOString();
  const filePath = path.join(SESSIONS_DIR, `${session.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
}

function listSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    return [];
  }
  const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
  const sessions = files.map((f) => {
    const raw = fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf-8');
    return JSON.parse(raw);
  });
  return sessions.sort((a, b) => new Date(b.updated) - new Date(a.updated));
}

function createSession(name) {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const session = {
    id,
    name: name || 'New Session',
    messages: [],
    created: now,
    updated: now,
  };
  saveSession(session);
  return session;
}

function buildPrompt(session, userMessage) {
  let prompt = '[CONVERSATION HISTORY]\n\n';
  for (const msg of session.messages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    prompt += `${role}: ${msg.content}\n\n`;
  }
  prompt += '[CURRENT MESSAGE]\n\n';
  prompt += `User: ${userMessage}`;
  return prompt;
}

function runOpencode(prompt) {
  return spawn(OPENCODE_PATH, ['-p', prompt, '-q', '--output-format', 'text'], {
    cwd: PROJECT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// --- Request Handler ---

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // CORS headers on all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    // GET / — serve index.html
    if (req.method === 'GET' && pathname === '/') {
      serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
      return;
    }

    // GET /public/* — serve static files
    if (req.method === 'GET' && pathname.startsWith('/public/')) {
      const relativePath = pathname.slice(1); // remove leading /
      const filePath = path.join(__dirname, relativePath);
      // Prevent directory traversal
      if (!filePath.startsWith(__dirname)) {
        res.writeHead(403, corsHeaders);
        res.end('Forbidden');
        return;
      }
      serveFile(res, filePath);
      return;
    }

    // GET /api/sessions — list sessions
    if (req.method === 'GET' && pathname === '/api/sessions') {
      const sessions = listSessions().map((s) => ({
        id: s.id,
        name: s.name,
        messageCount: s.messages.length,
        created: s.created,
        updated: s.updated,
      }));
      json(res, sessions);
      return;
    }

    // POST /api/sessions — create session
    if (req.method === 'POST' && pathname === '/api/sessions') {
      const body = await readBody(req);
      const session = createSession(body.name);
      json(res, { id: session.id, name: session.name }, 201);
      return;
    }

    // GET /api/sessions/:id/messages
    if (req.method === 'GET' && pathname.match(/^\/api\/sessions\/[^/]+\/messages$/)) {
      const id = pathname.split('/')[3];
      const session = loadSession(id);
      json(res, session.messages);
      return;
    }

    // POST /api/sessions/:id/chat — SSE stream
    if (req.method === 'POST' && pathname.match(/^\/api\/sessions\/[^/]+\/chat$/)) {
      const id = pathname.split('/')[3];
      let session;
      try {
        session = loadSession(id);
      } catch {
        json(res, { error: 'Session not found' }, 404);
        return;
      }

      const body = await readBody(req);
      if (!body.message) {
        json(res, { error: 'Missing message field' }, 400);
        return;
      }

      // Save user message
      session.messages.push({
        role: 'user',
        content: body.message,
        timestamp: new Date().toISOString(),
      });
      saveSession(session);

      // Build prompt and spawn opencode
      const prompt = buildPrompt(session, body.message);
      const child = runOpencode(prompt);

      // Set SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...corsHeaders,
      });

      let responseText = '';
      let sentDone = false;
      let buffer = '';

      function sendSSE(data) {
        if (sentDone) return;
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }

      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.length > 0) {
            responseText += line + '\n';
            sendSSE({ text: line + '\n' });
          }
        }
      });

      child.on('close', (code) => {
        if (sentDone) return;

        // Flush any remaining buffer
        if (buffer.length > 0) {
          responseText += buffer + '\n';
          sendSSE({ text: buffer + '\n' });
        }

        if (code !== 0 && responseText.length === 0) {
          sendSSE({ error: `opencode exited with code ${code}` });
        }

        // Save assistant message
        if (responseText.length > 0) {
          session.messages.push({
            role: 'assistant',
            content: responseText.trimEnd(),
            timestamp: new Date().toISOString(),
          });
          saveSession(session);
        }

        sendSSE({ done: true });
        sentDone = true;
        res.end();
      });

      child.on('error', (err) => {
        if (sentDone) return;
        sendSSE({ error: err.message });
        sentDone = true;
        res.end();
      });

      // Kill child if client disconnects
      req.on('close', () => {
        if (!sentDone) {
          child.kill();
        }
      });

      return;
    }

    // 404 fallback
    res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    if (!res.headersSent) {
      json(res, { error: err.message }, 500);
    }
  }
});

server.listen(PORT, () => {
  console.log(`✓ Glitch Web Wrapper running on :${PORT}`);
  console.log(`  Sessions: ${SESSIONS_DIR}`);
  console.log(`  Project: ${PROJECT_DIR}`);
});
