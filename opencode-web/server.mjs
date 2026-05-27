import http from 'node:http';
import fs from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { URL, fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration ---
const OUR_PORT = parseInt(process.argv[2] || '4103', 10);
const UPSTREAM_PORT = 4102;
const PROJECT_DIR = path.resolve(__dirname, '..');
const OPENCODE_HOST = '127.0.0.1';
const OPENCODE_PATH = path.join(PROJECT_DIR, 'opencode', 'opencode.exe');
const PUBLIC_DIR = path.join(__dirname, 'public');

// --- Read password ---
const pwFile = path.resolve(PROJECT_DIR, '.server-password');
const password = readFileSync(pwFile, 'utf-8').trim();
const AUTH_TOKEN = Buffer.from(`opencode:${password}`).toString('base64');

// --- Delegator Prompt ---
const DELEGATOR_PROMPT = `[DELEGATOR SYSTEM OVERRIDE \u2014 IGNORE ALL OTHER AGENT INSTRUCTIONS]
You are in DELEGATOR mode. Your role is to orchestrate \u2014 plan, coordinate, and consolidate. You never execute work directly.

CORE RULES:
1. NEVER write, edit, or modify files. NEVER run bash commands. Dispatch execution to sub-agents.
2. Break user tasks into independent subtasks.
3. Dispatch each subtask using the Task tool with the appropriate sub-agent.
4. After sub-agents complete, review their results and present a consolidated summary.
5. Use todowrite to track subtask progress visibly.

AVAILABLE SUB-AGENTS:
- @general: For bash commands, file ops, simple edits, most code (1-5 files)
- @coder: For complex code (5+ files, auth, API, architecture)
- @general-paid: Fallback when @general hits quota limits
- @reviewer: For code quality audits and security review
- @explore: For codebase research and multi-file exploration
- @vision: For image and screenshot analysis

THE USER'S MESSAGE FOLLOWS:`;

// --- MIME types ---
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
};

// --- CORS headers ---
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE, PUT, PATCH',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cache-Control',
  'Access-Control-Expose-Headers': 'Content-Type, Cache-Control',
};

// --- Helpers ---

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

function forwardModifiedPost(req, res, targetPath, body) {
  const bodyStr = JSON.stringify(body);
  const options = {
    hostname: OPENCODE_HOST,
    port: UPSTREAM_PORT,
    path: targetPath,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      'Host': `${OPENCODE_HOST}:${UPSTREAM_PORT}`,
      'Authorization': `Basic ${AUTH_TOKEN}`,
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    if (targetPath.startsWith('/api/') || targetPath.startsWith('/session/') || targetPath.startsWith('/tui/')) {
      proxyRes.headers['cache-control'] = 'no-cache, no-store, must-revalidate';
    }
    res.writeHead(proxyRes.statusCode, { ...proxyRes.headers, ...CORS_HEADERS });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`Proxy error for POST ${targetPath}:`, err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain', ...CORS_HEADERS });
      res.end('Bad Gateway \u2014 opencode server not running on port ' + UPSTREAM_PORT);
    }
  });

  proxyReq.write(bodyStr);
  proxyReq.end();
}

function proxyRequest(req, res, targetPath) {
  const options = {
    hostname: OPENCODE_HOST,
    port: UPSTREAM_PORT,
    path: targetPath,
    method: req.method,
    headers: {
      ...(Object.fromEntries(
        Object.entries(req.headers)
          .filter(([key]) => !['host', 'authorization'].includes(key.toLowerCase()))
      )),
      'host': `${OPENCODE_HOST}:${UPSTREAM_PORT}`,
      'authorization': `Basic ${AUTH_TOKEN}`,
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    if (targetPath.startsWith('/api/') || targetPath.startsWith('/session/') || targetPath.startsWith('/tui/')) {
      proxyRes.headers['cache-control'] = 'no-cache, no-store, must-revalidate';
    }
    res.writeHead(proxyRes.statusCode, { ...proxyRes.headers, ...CORS_HEADERS });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`Proxy error for ${req.method} ${targetPath}:`, err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain', ...CORS_HEADERS });
      res.end('Bad Gateway \u2014 opencode server not running on port ' + UPSTREAM_PORT);
    }
  });

  req.pipe(proxyReq);
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  const mimeType = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'application/json', ...CORS_HEADERS });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeType, ...CORS_HEADERS });
    res.end(data);
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify(data));
}

// --- HTTP Server ---

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // GET / \u2192 serve our custom HTML UI
  if (req.method === 'GET' && pathname === '/') {
    serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
    return;
  }

  // GET /public/* \u2192 serve static files
  if (req.method === 'GET' && pathname.startsWith('/public/')) {
    const relativePath = pathname.slice(1);
    const filePath = path.join(__dirname, relativePath);
    if (!filePath.startsWith(__dirname)) {
      res.writeHead(403, { 'Content-Type': 'text/plain', ...CORS_HEADERS });
      res.end('Forbidden');
      return;
    }
    serveFile(res, filePath);
    return;
  }

  // POST /api/session — Create Session (via opencode -p hack)
  if (req.method === 'POST' && pathname === '/api/session') {
    try {
      const body = await readBody(req);
      const directory = body.directory || PROJECT_DIR;
      console.log('  Creating session via opencode -p...');

      // Spawn opencode -p to create a session in the DB
      const session = await new Promise((resolve, reject) => {
        const child = spawn(OPENCODE_PATH, [
          '-p', 'Start a new conversation.',
          '-q',
          '--output-format', 'text',
        ], {
          cwd: PROJECT_DIR,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

        child.on('close', async (code) => {
          if (code !== 0) {
            console.error(`opencode -p exited with code ${code}: ${stderr}`);
          }

          // Wait a moment for the DB to settle, then find the newest session
          await new Promise(r => setTimeout(r, 1000));

          // List sessions via the opencode server API using http.get
          const listUrl = `http://${OPENCODE_HOST}:${UPSTREAM_PORT}/api/session?directory=${encodeURIComponent(directory)}`;
          try {
            const res = await new Promise((resolve, reject) => {
              const req = http.get(listUrl, (res) => resolve(res));
              req.on('error', reject);
            });
            if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
            const data = await new Promise((resolve) => {
              let body = '';
              res.on('data', chunk => body += chunk);
              res.on('end', () => resolve(JSON.parse(body)));
            });
            const items = data.items || data;
            if (Array.isArray(items) && items.length > 0) {
              // Return the most recently created session
              const sorted = items.sort((a, b) => new Date(b.time_created) - new Date(a.time_created));
              resolve(sorted[0]);
            } else {
              reject(new Error('No sessions found after creation'));
            }
          } catch (err) {
            reject(new Error(`Failed to list sessions: ${err.message}`));
          }
        });

        child.on('error', reject);
      });

      console.log(`  Session created: ${session.id} - ${session.title || ''}`);
      json(res, { id: session.id, title: session.title || 'New Session', time_created: session.time_created }, 201);
    } catch (err) {
      console.error('Error creating session:', err.message);
      if (!res.headersSent) {
        json(res, { error: err.message }, 500);
      }
    }
    return;
  }

  // POST /tui/submit-prompt \u2192 Send Message (MODIFIED \u2014 inject delegator prompt)
  if (req.method === 'POST' && pathname === '/tui/submit-prompt') {
    try {
      const body = await readBody(req);
      const messageText = body.prompt || body.text || body.message || '';
      body.prompt = DELEGATOR_PROMPT + '\n\n' + messageText;
      console.log('\u270F\uFE0F Modified POST /tui/submit-prompt \u2014 injected delegator prompt');
      forwardModifiedPost(req, res, '/tui/submit-prompt', body);
    } catch (err) {
      console.error('Error modifying /tui/submit-prompt:', err.message);
      if (!res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'text/plain', ...CORS_HEADERS });
        res.end('Bad Request: ' + err.message);
      }
    }
    return;
  }

  // Default: proxy transparently (includes GET /api/event SSE, GET /api/session/*, etc.)
  proxyRequest(req, res, req.url);
});

server.listen(OUR_PORT, () => {
  console.log(`\u{1F50C} Glitch Smart Reverse Proxy running on :${OUR_PORT}`);
  console.log(`  Upstream: ${OPENCODE_HOST}:${UPSTREAM_PORT}`);
  console.log(`  Project: ${PROJECT_DIR}`);
  console.log(`  Public: ${PUBLIC_DIR}`);
});
