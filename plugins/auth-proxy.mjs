/**
 * Auth Proxy — sits between cloudflare tunnel and backend servers.
 * - Routes /terminal* to ttyd (port 4104) with path stripping + WebSocket
 * - Routes everything else to opencode web (port 4102) with Basic Auth
 * - Injects <base href="/terminal/"> into ttyd HTML so asset paths resolve
 * - Strips Accept-Encoding for ttyd to avoid gzip mangling during modification
 * - Strips directory/workspace params from /agent requests (opencode bug)
 */

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const pwFile = resolve(rootDir, '.server-password');

let password;
try {
  password = readFileSync(pwFile, 'utf-8').trim();
} catch {
  console.error('Error: .server-password not found at', pwFile);
  process.exit(1);
}
const authToken = Buffer.from(`opencode:${password}`).toString('base64');

const PROXY_PORT = parseInt(process.argv[2] || '4101', 10);

// ── Routing ────────────────────────────────────────────────────────────────

function routeFor(url) {
  if (url.startsWith('/terminal')) {
    return {
      host: '127.0.0.1',
      port: 4104,
      path: url.replace('/terminal', '') || '/',
    };
  }
  return {
    host: '127.0.0.1',
    port: 4102,
    path: url,
  };
}

function filterHeaders(headers, targetPort) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'host') continue;
    // Strip authorization only for opencode (ttyd has its own auth via --credential)
    if (targetPort === 4102 && lower === 'authorization') continue;
    // Strip accept-encoding for ttyd so HTML comes uncompressed for base tag injection
    if (targetPort === 4104 && lower === 'accept-encoding') continue;
    result[key] = value;
  }
  return result;
}

// ── HTTP Handler ──────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const target = routeFor(req.url);
  
  // For opencode /agent, strip problematic params
  let requestPath = target.path;
  if (target.port === 4102 && req.url.startsWith('/agent')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      url.searchParams.delete('directory');
      url.searchParams.delete('workspace');
      requestPath = url.pathname + url.search;
      if (requestPath !== target.path) {
        console.log(`  Stripped params from /agent: ${target.path} -> ${requestPath}`);
      }
    } catch {}
  }

  const options = {
    hostname: target.host,
    port: target.port,
    path: requestPath,
    method: req.method,
    headers: {
      ...filterHeaders(req.headers, target.port),
      host: `${target.host}:${target.port}`,
    },
  };

  // Inject Basic auth for opencode
  if (target.port === 4102) {
    options.headers.authorization = `Basic ${authToken}`;
  }

  const proxyReq = http.request(options, (proxyRes) => {
    // For opencode API responses, disable caching
    if (target.port === 4102 && 
        (req.url.startsWith('/api/') || req.url.startsWith('/session/') || req.url.startsWith('/assets/'))) {
      proxyRes.headers['cache-control'] = 'no-cache, no-store, must-revalidate';
      proxyRes.headers['pragma'] = 'no-cache';
      proxyRes.headers['expires'] = '0';
    }

    // For ttyd HTML (now uncompressed because we stripped Accept-Encoding),
    // inject <base href="/terminal/"> so asset paths resolve correctly
    if (target.port === 4104 && 
        proxyRes.headers['content-type'] && 
        proxyRes.headers['content-type'].includes('text/html')) {
      
      let body = '';
      proxyRes.on('data', (chunk) => { body += chunk.toString(); });
      proxyRes.on('end', () => {
        body = body.replace('<head>', '<head><base href="/terminal/">');
        proxyRes.headers['content-length'] = Buffer.byteLength(body);
        delete proxyRes.headers['content-encoding']; // no longer compressed
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        res.end(body);
      });
      return;
    }

    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`Proxy error for ${req.method} ${req.url}:`, err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway');
    }
  });

  req.pipe(proxyReq);
});

// ── WebSocket Handler ─────────────────────────────────────────────────────

server.on('upgrade', (req, socket, head) => {
  const target = routeFor(req.url);
  
  console.log(`  WebSocket upgrade: ${req.url} -> ${target.host}:${target.port}${target.path}`);

  const options = {
    hostname: target.host,
    port: target.port,
    path: target.path,
    method: 'GET',
    headers: {
      ...filterHeaders(req.headers, target.port),
      host: `${target.host}:${target.port}`,
    },
  };

  if (target.port === 4102) {
    options.headers.authorization = `Basic ${authToken}`;
  }

  const proxyReq = http.request(options);
  
  proxyReq.on('upgrade', (proxyRes, proxySocket) => {
    socket.write(proxyRes);
    proxySocket.pipe(socket).pipe(proxySocket);
  });

  proxyReq.on('error', (err) => {
    console.error(`WebSocket proxy error for ${req.url}:`, err.message);
    socket.destroy();
  });

  proxyReq.end();
});

server.listen(PROXY_PORT, () => {
  console.log(`  Auth proxy listening on :${PROXY_PORT}`);
  console.log(`  /terminal* -> ttyd (127.0.0.1:4104) with WebSocket`);
  console.log(`  /* -> opencode (127.0.0.1:4102) with Basic Auth`);
  console.log(`  Password: ${password}`);
});
