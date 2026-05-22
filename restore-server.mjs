import { createServer } from 'node:http'
import { request as httpRequest } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HISTORY_FILE = join(__dirname, '.opencode', 'session-history', 'db.json')
const PW_FILE = join(__dirname, '.server-password')
const TARGET_PORT = 4096
const PROXY_PORT = 4097
const PROJECT_DIR = 'E:\\Glitch AI\\glitch-ai'

function getPassword() {
  try {
    if (existsSync(PW_FILE)) return readFileSync(PW_FILE, 'utf-8').trim()
  } catch {}
  return null
}

function buildInjection() {
  try {
    if (!existsSync(HISTORY_FILE)) return ''
    let raw = readFileSync(HISTORY_FILE, 'utf-8')
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1)
    const data = JSON.parse(raw)
    if (!data.sessions?.length) return ''

    const dirSessions = data.sessions.filter(s => s.directory === PROJECT_DIR)
    const sorted = [...(dirSessions.length ? dirSessions : data.sessions)]
      .sort((a, b) => (b.time_updated || 0) - (a.time_updated || 0))
    const lastId = sorted[0].session_id
    const encodedDir = encodeURIComponent(PROJECT_DIR)

    return `
<script id="glitch-inject">
;(function(){
  var DIR = ${JSON.stringify(PROJECT_DIR)};
  var SID = ${JSON.stringify(lastId)};

  // Server store: registers project in sidebar
  var srv = { list: [], projects: { local: [{ worktree: DIR, expanded: true }] }, lastProject: { local: DIR } };
  localStorage.setItem('opencode.global.dat:server', JSON.stringify(srv));

  // Layout page store: sets last session so app auto-navigates
  var escDir = DIR.replace(/\\\\/g, '\\\\\\\\');
  var lay = { lastProjectSession: {}, activeProject: void 0, activeWorkspace: void 0, workspaceOrder: {}, workspaceName: {}, workspaceBranchName: {}, workspaceExpanded: {}, gettingStartedDismissed: true };
  lay.lastProjectSession[escDir] = { directory: DIR, id: SID, at: Date.now() };
  localStorage.setItem('opencode.global.dat:layout.page', JSON.stringify(lay));

  // Model store
  var mdl = { user: [{ modelID: 'deepseek-v4-flash-free', providerID: 'opencode', visibility: 'show' }], recent: [{ modelID: 'deepseek-v4-flash-free', providerID: 'opencode' }], variant: {} };
  localStorage.setItem('opencode.global.dat:model', JSON.stringify(mdl));

  // Navigate to session using URL-encoded path
  setTimeout(function() {
    location.href = '/' + ${JSON.stringify(encodedDir)} + '/session/' + SID;
  }, 100);
  document.getElementById('glitch-inject').remove();
})();
</script>`
  } catch (e) { console.error('buildInjection error:', e.message); return '' }
}

const INJECTION = buildInjection()
if (INJECTION) console.log('Workspace injection active (CSP stripped)')

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

    // Strip CSP headers so our inline script can execute
    const responseHeaders = { ...proxyRes.headers }
    for (const h of CSP_HEADERS) {
      delete responseHeaders[h]
    }

    if (isHtml && INJECTION && (clientReq.url === '/' || clientReq.url === '')) {
      let body = []
      proxyRes.on('data', chunk => body.push(chunk))
      proxyRes.on('end', () => {
        let fullBody = Buffer.concat(body)
        let html = fullBody.toString('utf-8')
        html = html.replace('</head>', INJECTION + '\n</head>')
        fullBody = Buffer.from(html, 'utf-8')
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
