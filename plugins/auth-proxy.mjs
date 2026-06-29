/**
 * Auth Proxy — sits between cloudflare tunnel and opencode web server.
 * Enforces HTTP Basic Auth on incoming requests. Valid credentials
 * are forwarded to the upstream server with the auth header injected.
 *
 * Credentials accepted via:
 *   - Authorization: Basic <base64> header (browser native auth dialog)
 *   - ?auth_token=<base64> query parameter (bookmarkable one-click URL)
 *
 * Usage: node plugins/auth-proxy.mjs [port] [upstream]
 *   Default port: 4101
 *   Default upstream: http://localhost:4102
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
const UPSTREAM_URL = process.argv[3] || 'http://localhost:4102';
const upstream = new URL(UPSTREAM_URL);

/**
 * Extract and validate credentials from request.
 * Returns true if auth matches, false otherwise.
 * Checks: Authorization header, then auth_token query param.
 */
function isAuthenticated(req) {
  // Check Authorization header
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const match = authHeader.match(/^Basic\s+(.+)$/i);
    if (match && match[1] === authToken) {
      return true;
    }
  }

  // Check auth_token query parameter (bookmarkable URL support)
  if (req.url) {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      const tokenParam = parsed.searchParams.get('auth_token');
      if (tokenParam === authToken) {
        return true;
      }
    } catch {}
  }

  return false;
}

const server = http.createServer((req, res) => {
  // ---- Authentication gate ----
  if (!isAuthenticated(req)) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="Glitch AI", charset="UTF-8"',
      'Content-Type': 'text/plain',
    });
    res.end('Authorization required');
    return;
  }

  // Strip directory and workspace params from /agent requests
  // (server bug: workspace crashes, directory filters out custom agents)
  let targetPath = req.url;
  if (req.url) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/agent') {
        url.searchParams.delete('directory');
        url.searchParams.delete('workspace');
      }
      // Strip auth_token from forwarded URL (upstream doesn't need it)
      url.searchParams.delete('auth_token');
      targetPath = url.pathname + url.search;
    } catch {}
  }

  const options = {
    hostname: upstream.hostname,
    port: upstream.port || 80,
    path: targetPath,
    method: req.method,
    headers: {
      ...(Object.fromEntries(
        Object.entries(req.headers)
          .filter(([key]) => !['host', 'authorization'].includes(key.toLowerCase()))
      )),
      host: upstream.host,
      authorization: `Basic ${authToken}`,
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // For API responses, disable caching so sessions always refresh
    if (targetPath.startsWith('/api/') || targetPath.startsWith('/session/') || targetPath.startsWith('/assets/')) {
      proxyRes.headers['cache-control'] = 'no-cache, no-store, must-revalidate';
      proxyRes.headers['pragma'] = 'no-cache';
      proxyRes.headers['expires'] = '0';
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

server.listen(PROXY_PORT, () => {
  console.log(`  Auth proxy listening on :${PROXY_PORT} -> ${UPSTREAM_URL}`);
  console.log(`  Password: ${password}`);
});
