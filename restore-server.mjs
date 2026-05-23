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
  BOOTSTRAP = ''
  try {
    if (latestSession) {
      const slug = Buffer.from(PROJECT_DIR).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      BOOTSTRAP = `
<script id="glitch-bootstrap">
;(function(){
  var DIR = ${JSON.stringify(PROJECT_DIR)};
  var SID = ${JSON.stringify(latestSession.id)};
  var SLUG = ${JSON.stringify(slug)};

  var srv = { list: [], projects: { local: [{ worktree: DIR, expanded: true }] }, lastProject: { local: DIR } };
  localStorage.setItem('opencode.global.dat:server', JSON.stringify(srv));

  var lay = { lastProjectSession: {}, activeProject: DIR, activeWorkspace: void 0, workspaceOrder: {}, workspaceName: {}, workspaceBranchName: {}, workspaceExpanded: {}, gettingStartedDismissed: true };
  lay.lastProjectSession[DIR] = { directory: DIR, id: SID, at: Date.now() };
  localStorage.setItem('opencode.global.dat:layout.page', JSON.stringify(lay));

  var mdl = { user: [{ modelID: 'deepseek-v4-flash-free', providerID: 'opencode', visibility: 'show' }], recent: [{ modelID: 'deepseek-v4-flash-free', providerID: 'opencode' }], variant: {} };
  localStorage.setItem('opencode.global.dat:model', JSON.stringify(mdl));

  document.getElementById('glitch-bootstrap').remove();
  setTimeout(function() {
    location.href = '/' + SLUG + '/session/' + SID;
  }, 100);
})();
</script>`
    }
  } catch (e) { console.error('bootstrap error:', e.message) }

  const encodedDir = encodeURIComponent(PROJECT_DIR)
  POLLER = `
<script id="glitch-poller">
;(function(){
  var POLL_URL = '/' + ${JSON.stringify(encodedDir)} + '/session/';
  var known = null;

  function poll() {
    fetch('/session?directory=' + ${JSON.stringify(encodedDir)}, { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(sessions) {
        var ids = sessions.map(function(s) { return s.id; }).sort().join(',');
        if (known === null) { known = ids; return; }
        if (ids !== known) {
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
      if (data.latestSession) {
        latestSession = data.latestSession
        buildScripts()
        console.log(`[${new Date().toLocaleTimeString()}] Loaded session from cache: ${latestSession.id}`)
      }
    }
  } catch (e) { console.error('cache read error:', e.message) }
}

function writeCache() {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true })
    }
    writeFileSync(CACHE_FILE, JSON.stringify({ latestSession }), 'utf-8')
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
      const sorted = [...sessions].sort((a, b) => (b.time_updated || 0) - (a.time_updated || 0))
      latestSession = sorted[0]
    }
    buildScripts()
    writeCache()
    console.log(`[${new Date().toLocaleTimeString()}] Sessions refreshed from API: ${sessions?.length || 0}`)
  } catch (e) {
    console.log(`[${new Date().toLocaleTimeString()}] API unavailable: ${e.message}`)
  }
}

readCache()
refreshSessionData()
setInterval(refreshSessionData, REFRESH_INTERVAL)

const AUTH = (() => {
  const pw = getPassword()
  if (pw) return 'Basic ' + Buffer.from('opencode:' + pw).toString('base64')
  return null
})()

const CSP_HEADERS = ['content-security-policy', 'content-security-policy-report-only']

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
        if (BOOTSTRAP && (clientReq.url === '/' || clientReq.url === '')) {
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
    clientRes.writeHead(502, { 'Content-Type': 'text/plain' })
    clientRes.end('Proxy error: ' + err.message)
  })

  clientReq.pipe(proxyReq)
})

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`Glitch Proxy on http://0.0.0.0:${PROXY_PORT} -> 127.0.0.1:${TARGET_PORT}`)
  console.log(`  Visit http://localhost:${PROXY_PORT}/`)
})
