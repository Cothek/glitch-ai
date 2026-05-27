/**
 * Auth Proxy — sits between cloudflare tunnel and backend servers.
 * - Routes /terminal/* to ttyd (port 4104) with WebSocket support
 * - Routes everything else to opencode web (port 4102)
 * - Injects Authorization: Basic header for opencode web auth
 * - For ttyd HTML responses, injects <base> tag for correct asset path resolution
 * - Strips directory/workspace params from /agent requests (opencode bug workaround)
 */

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const pwFile = resolve(rootDir, '.server-password');

// Read password
let password;
try {
  password = readFileSync(pwFile, 'utf-8').trim();
} catch {
  console.error('Error: .server-password not found at', pwFile);
  process.exit(1);
}
const authToken = Buffer.from(`opencode:${password}`).toString('base64');

const PROXY_PORT = parseInt(process.argv[2] || '4101', 10);

const UPSTREAMS = {
  opencode: { host: '127.0.0.1', port: 4102, prefix: '' },
  ttyd: { host: '127.0.0.1', port: 4104, prefix: '/terminal' },
};

function routeTarget(url) {
  if (url.startsWith('/terminal')) {
    return {
      ...UPSTREAMS.ttyd,
      path: url.replace('/terminal', '') || '/',
    };
  }
  return {
    ...UPSTREAMS.opencode,
    path: url,
  };
}

// ── HTTP Request Handler ──

const server = http.createServer((req, res) => {
  const target = routeTarget(req.url);

  // For opencode /agent requests, strip problematic params
  let requestPath = target.path;
  if (target.port === 4102 && req.url.startsWith('/agent')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      url.searchParams.delete('directory');
      url.searchParams.delete('workspace');
      requestPath = url.pathname + url.search;
      if (requestPath !== target.path) {
        console.log(`  Stripped params from /agent: ${target.path} → ${requestPath}`);
      }
    } catch {}
  }

  const options = {
    hostname: target.host,
    port: target.port,
    path: requestPath,
    method: req.method,
    headers: {
      ...(Object.fromEntries(
        Object.entries(req.headers)
          .filter(([key]) => {
            // Strip host from all requests, but only strip authorization for opencode
            if (key.toLowerCase() === 'host') return false;
            if (target.port === 4102 && key.toLowerCase() === 'authorization') return false;
            return true;
          })
      )),
      host: `${target.host}:${target.port}`,
    },
  };

  // Only inject Basic auth for opencode (ttyd has its own auth)
  if (target.port === 4102) {
    options.headers.authorization = `Basic ${authToken}`;
  }

  const proxyReq = http.request(options, (proxyRes) => {
    // For opencode API responses, disable caching
    if (target.port === 4102 && (req.url.startsWith('/api/') || req.url.startsWith('/session/') || req.url.startsWith('/assets/'))) {
      proxyRes.headers['cache-control'] = 'no-cache, no-store, must-revalidate';
      proxyRes.headers['pragma'] = 'no-cache';
      proxyRes.headers['expires'] = '0';
    }

    // For ttyd HTML responses, inject <base href="/terminal/"> so asset paths resolve correctly
    if (target.port === 4104 && proxyRes.headers['content-type'] && proxyRes.headers['content-type'].includes('text/html')) {
      let body = '';
      proxyRes.on('data', (chunk) => { body += chunk.toString(); });
      proxyRes.on('end', () => {
        // Inject <base> tag into <head>
        body = body.replace('<head>', '<head><base href="/terminal/">');
        proxyRes.headers['content-length'] = Buffer.byteLength(body);
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

// ── WebSocket Handler ──

server.on('upgrade', (req, socket, head) => {
  const target = routeTarget(req.url);

  console.log(`  WebSocket upgrade: ${req.url} → ${target.host}:${target.port}${target.path}`);

  const options = {
    hostname: target.host,
    port: target.port,
    path: target.path,
    method: 'GET',
    headers: {
      ...(Object.fromEntries(
        Object.entries(req.headers)
          .filter(([key]) => {
            // Strip host from all requests, but only strip authorization for opencode
            if (key.toLowerCase() === 'host') return false;
            if (target.port === 4102 && key.toLowerCase() === 'authorization') return false;
            return true;
          })
      )),
      host: `${target.host}:${target.port}`,
    },
  };

  // Inject Basic auth for opencode WebSocket
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
  console.log(`✓ Auth proxy listening on :${PROXY_PORT}`);
  console.log(`  /terminal/* → ttyd (${UPSTREAMS.ttyd.host}:${UPSTREAMS.ttyd.port})`);
  console.log(`  /* → opencode web (${UPSTREAMS.opencode.host}:${UPSTREAMS.opencode.port})`);
  console.log(`  Password: ${password}`);
  console.log(`  Auth token: ${authToken}`);
});
