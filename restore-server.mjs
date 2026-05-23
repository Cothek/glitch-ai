import { createServer } from 'node:http'
import { request as httpRequest } from 'node:http'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = join(__dirname, '.opencode', 'session-history')
const CACHE_FILE = join(CACHE_DIR, 'session-cache.json')
const PW_FILE = join(__dirname, '.server-password')
const TARGET_PORT = 4096
const PROXY_PORT = 4097
const PROJECT_DIR = 'E:\\Glitch AI\\glitch-ai'
const REFRESH_INTERVAL = 60000
const POLL_INTERVAL = 15000

let allSessions = []
let latestSession = null
let BOOTSTRAP = ''
let POLLER = ''

function getPassword() {
  try {
    if (existsSync(PW_FILE)) return readFileSync(PW_FILE, 'utf-8').trim()
  } catch {}
  return null
}

function buildScripts() {
  const encodedDir = encodeURIComponent(PROJECT_DIR)
  let slug = ''
  try { slug = Buffer.from(PROJECT_DIR).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') } catch {}

  const allSessionsJson = JSON.stringify(allSessions.map(function(s) {
    return { id: s.id, title: s.title, slug: s.slug, agent: s.agent, time: s.time, summary: s.summary, tokens: s.tokens, model: s.model, version: s.version };
  }));

  BOOTSTRAP = `
<script id="glitch-bootstrap">
;(function(){
  var DIR = ${JSON.stringify(PROJECT_DIR)};
  var SID = ${JSON.stringify(latestSession ? latestSession.id : null)};
  var SLUG = ${JSON.stringify(slug)};
  var ENC_DIR = ${JSON.stringify(encodedDir)};
  var ALL_SESSIONS = ${allSessionsJson};

  function restoreProject() {
    try {
      var srv = { list: [], projects: { local: [{ worktree: DIR, expanded: true }] }, lastProject: { local: DIR } };
      localStorage.setItem('opencode.global.dat:server', JSON.stringify(srv));

      var mdl = { user: [{ modelID: 'deepseek-v4-flash-free', providerID: 'opencode', visibility: 'show' }], recent: [{ modelID: 'deepseek-v4-flash-free', providerID: 'opencode' }], variant: {} };
      localStorage.setItem('opencode.global.dat:model', JSON.stringify(mdl));
    } catch(e) { console.error('Glitch: restore failed', e); }
  }

  function restoreSession() {
    if (!SID) return;
    try {
      var existing = localStorage.getItem('opencode.global.dat:layout.page');
      var lay = existing ? JSON.parse(existing) : {};
      lay.lastProjectSession = lay.lastProjectSession || {};
      lay.activeProject = DIR;
      lay.activeWorkspace = void 0;
      lay.workspaceOrder = lay.workspaceOrder || {};
      lay.workspaceName = lay.workspaceName || {};
      lay.workspaceBranchName = lay.workspaceBranchName || {};
      lay.workspaceExpanded = lay.workspaceExpanded || {};
      lay.gettingStartedDismissed = true;
      lay.lastProjectSession[DIR] = { directory: DIR, id: SID, at: Date.now() };
      lay.projectSessions = lay.projectSessions || {};
      lay.projectSessions[DIR] = ALL_SESSIONS;
      localStorage.setItem('opencode.global.dat:layout.page', JSON.stringify(lay));
      localStorage.setItem('opencode.global.dat:sessions', JSON.stringify({ directory: DIR, sessions: ALL_SESSIONS, at: Date.now() }));
    } catch(e) { console.error('Glitch: session restore failed', e); }
  }

  var isRegistered = false;
  try {
    var srvRaw = localStorage.getItem('opencode.global.dat:server');
    if (srvRaw) {
      var srv = JSON.parse(srvRaw);
      isRegistered = srv.projects && srv.projects.local && srv.projects.local.some(function(p) { return p.worktree === DIR; });
    }
  } catch(e) {}

  if (!isRegistered) {
    restoreProject();
    restoreSession();
  } else {
    try {
      var lay = JSON.parse(localStorage.getItem('opencode.global.dat:layout.page') || '{}');
      lay.projectSessions = lay.projectSessions || {};
      lay.projectSessions[DIR] = ALL_SESSIONS;
      localStorage.setItem('opencode.global.dat:layout.page', JSON.stringify(lay));
      localStorage.setItem('opencode.global.dat:sessions', JSON.stringify({ directory: DIR, sessions: ALL_SESSIONS, at: Date.now() }));
    } catch(e) { console.error('Glitch: session sync failed', e); }
  }

  var currentPath = location.pathname;
  var targetPath = SID ? ('/' + SLUG + '/session/' + SID) : ('/' + SLUG + '/session');
  if (!isRegistered && SID && currentPath !== targetPath) {
    setTimeout(function() {
      location.href = targetPath;
    }, 100);
  }

  document.getElementById('glitch-bootstrap').remove();
})();
</script>`

  POLLER = `
<script id="glitch-poller">
;(function(){
  var DIR = ${JSON.stringify(PROJECT_DIR)};
  var POLL_URL = '/' + ${JSON.stringify(encodedDir)} + '/session/';
  var known = null;

  function ensureProject() {
    try {
      var srvRaw = localStorage.getItem('opencode.global.dat:server');
      if (srvRaw) {
        var srv = JSON.parse(srvRaw);
        var found = srv.projects && srv.projects.local && srv.projects.local.some(function(p) { return p.worktree === DIR; });
        if (found) return;
      }
      srvRaw = { list: [], projects: { local: [{ worktree: DIR, expanded: true }] }, lastProject: { local: DIR } };
      localStorage.setItem('opencode.global.dat:server', JSON.stringify(srvRaw));
    } catch(e) {}
  }

  function syncSessionsToLocal(sessions) {
    try {
      var lay = JSON.parse(localStorage.getItem('opencode.global.dat:layout.page') || '{}');
      lay.projectSessions = lay.projectSessions || {};
      lay.projectSessions[DIR] = sessions;
      localStorage.setItem('opencode.global.dat:layout.page', JSON.stringify(lay));
      localStorage.setItem('opencode.global.dat:sessions', JSON.stringify({ directory: DIR, sessions: sessions, at: Date.now() }));
    } catch(e) { console.error('Glitch: session sync failed', e); }
  }

  function poll() {
    ensureProject();
    fetch('/session?directory=' + ${JSON.stringify(encodedDir)}, { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(sessions) {
        var ids = sessions.map(function(s) { return s.id; }).sort().join(',');
        if (known === null) { known = ids; syncSessionsToLocal(sessions); return; }
        if (ids !== known) {
          syncSessionsToLocal(sessions);
          console.log('Glitch: sessions changed, reloading');
          location.reload();
        }
      })
      .catch(function() {});
  }

  setTimeout(poll, 3000);
  setInterval(poll, ${POLL_INTERVAL});
  document.getElementById('glitch-poller').remove();
})();
</script>`
}

function readCache() {
  try {
    if (existsSync(CACHE_FILE)) {
      const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'))
      if (data.allSessions) {
        allSessions = data.allSessions
      }
      if (data.latestSession) {
        latestSession = data.latestSession
        buildScripts()
        console.log(`[${new Date().toLocaleTimeString()}] Loaded session from cache: ${latestSession.id} (${allSessions.length} total)`)
      }
    }
  } catch (e) { console.error('cache read error:', e.message) }
}

function writeCache() {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true })
    }
    writeFileSync(CACHE_FILE, JSON.stringify({ allSessions, latestSession }), 'utf-8')
  } catch (e) { console.error('cache write error:', e.message) }
}

async function refreshSessionData() {
  try {
    const password = getPassword()
    const auth = password ? 'Basic ' + Buffer.from('opencode:' + password).toString('base64') : null

    const sessions = await new Promise((resolve, reject) => {
      const headers = {}
      if (auth) headers['Authorization'] = auth
      const req = httpRequest({
        hostname: '127.0.0.1',
        port: TARGET_PORT,
        path: '/session?directory=' + encodeURIComponent(PROJECT_DIR),
        method: 'GET',
        headers
      }, (res) => {
        let body = []
        res.on('data', chunk => body.push(chunk))
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}`))
          }
          try {
            resolve(JSON.parse(Buffer.concat(body).toString()))
          } catch (e) { reject(e) }
        })
      })
      req.on('error', reject)
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')) })
      req.end()
    })

    if (sessions && sessions.length > 0) {
      allSessions = sessions
      const sorted = [...sessions].sort((a, b) => (b.time_updated || 0) - (a.time_updated || 0))
      latestSession = sorted[0]
    } else if (sessions && sessions.length === 0) {
      allSessions = []
      latestSession = null
    }
    buildScripts()
    writeCache()
    console.log(`[${new Date().toLocaleTimeString()}] Sessions refreshed from API: ${sessions?.length || 0}`)
  } catch (e) {
    console.log(`[${new Date().toLocaleTimeString()}] API unavailable: ${e.message}`)
  }
}

readCache()

async function startupRetry() {
  await refreshSessionData()
  if (!latestSession) {
    setTimeout(startupRetry, 2000)
  }
}
startupRetry()

setInterval(refreshSessionData, REFRESH_INTERVAL)

const AUTH = (() => {
  const pw = getPassword()
  if (pw) return 'Basic ' + Buffer.from('opencode:' + pw).toString('base64')
  return null
})()

const CSP_HEADERS = ['content-security-policy', 'content-security-policy-report-only']

process.on('uncaughtException', (err) => {
  console.error('[CRASH GUARD] Uncaught exception:', err.message)
})
process.on('unhandledRejection', (err) => {
  console.error('[CRASH GUARD] Unhandled rejection:', err.message)
})

const server = createServer((clientReq, clientRes) => {
  const options = {
    hostname: '127.0.0.1',
    port: TARGET_PORT,
    path: clientReq.url,
    method: clientReq.method,
    headers: { ...clientReq.headers, 'Authorization': AUTH }
  }

  const proxyReq = httpRequest(options, (proxyRes) => {
    const ct = proxyRes.headers['content-type'] || ''
    const isHtml = ct.includes('text/html')

    const responseHeaders = { ...proxyRes.headers }
    for (const h of CSP_HEADERS) {
      delete responseHeaders[h]
    }

    if (isHtml) {
      let body = []
      proxyRes.on('data', chunk => body.push(chunk))
      proxyRes.on('end', () => {
        let fullBody = Buffer.concat(body)
        let html = fullBody.toString('utf-8')
        let inject = ''
        if (BOOTSTRAP) {
          inject += BOOTSTRAP + '\n'
        }
        if (POLLER) {
          inject += POLLER + '\n'
        }
        if (inject) {
          html = html.replace('</head>', inject + '</head>')
          fullBody = Buffer.from(html, 'utf-8')
        }
        responseHeaders['content-length'] = String(fullBody.length)
        clientRes.writeHead(proxyRes.statusCode, responseHeaders)
        clientRes.end(fullBody)
      })
    } else {
      clientRes.writeHead(proxyRes.statusCode, responseHeaders)
      proxyRes.pipe(clientRes)
    }
  })

  proxyReq.on('error', (err) => {
    if (clientRes.headersSent) return
    clientRes.writeHead(502, { 'Content-Type': 'text/plain' })
    clientRes.end('Proxy error: ' + err.message)
  })

  clientReq.pipe(proxyReq)
})

server.on('upgrade', (req, socket, head) => {
  const opts = {
    hostname: '127.0.0.1',
    port: TARGET_PORT,
    path: req.url,
    method: req.method || 'GET',
    headers: { ...req.headers, 'Authorization': AUTH }
  }

  const proxyReq = httpRequest(opts)
  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    const headBuf = Object.entries(proxyRes.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n')
    socket.write('HTTP/1.1 101 Switching Protocols\r\n' + headBuf + '\r\n\r\n')
    if (proxyHead && proxyHead.length) socket.write(proxyHead)
    if (head && head.length) proxySocket.write(head)
    proxySocket.pipe(socket).pipe(proxySocket)
  })
  proxyReq.on('response', (proxyRes) => {
    const headBuf = Object.entries(proxyRes.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n')
    socket.write(`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n${headBuf}\r\n\r\n`)
    proxyRes.pipe(socket)
  })
  proxyReq.on('error', (err) => {
    try {
      socket.write('HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\nProxy error: ' + err.message)
    } catch {}
    socket.destroy()
  })
  socket.on('error', () => proxyReq.destroy())
  proxyReq.end()
})

server.listen(PROXY_PORT, () => {
  console.log(`Glitch Proxy on http://0.0.0.0:${PROXY_PORT} -> 127.0.0.1:${TARGET_PORT}`)
  console.log(`  Visit http://localhost:${PROXY_PORT}/`)
})
