/**
 * Auth Proxy — sits between cloudflare tunnel and opencode web server.
 * Adds Authorization: Basic header to all requests so the browser
 * never sees a 401/native auth prompt on assets or API calls.
 *
 * Usage: node plugins/auth-proxy.mjs [port] [upstream]
 *   Default port: 4101
 *   Default upstream: http://localhost:4100
 */

import http from 'http';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const pwFile = resolve(rootDir, '.server-password');

// Read password and compute auth token
let password;
try {
  password = readFileSync(pwFile, 'utf-8').trim();
} catch {
  console.error('Error: .server-password not found at', pwFile);
  process.exit(1);
}
const authToken = Buffer.from(`opencode:${password}`).toString('base64');

const PROXY_PORT = parseInt(process.argv[2] || '4101', 10);
const UPSTREAM_URL = process.argv[3] || 'http://localhost:4100';
const upstream = new URL(UPSTREAM_URL);

const server = http.createServer((req, res) => {
  // Strip directory and workspace params from /agent requests
  // (server bug: workspace crashes, directory filters out custom agents)
  let targetPath = req.url;
  if (req.url) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/agent') {
        url.searchParams.delete('directory');
        url.searchParams.delete('workspace');
        targetPath = url.pathname + url.search;
        if (targetPath !== req.url) {
          console.log(`  Stripped params from /agent: ${req.url} → ${targetPath}`);
        }
      }
    } catch {}
  }

  const options = {
    hostname: upstream.hostname,
    port: upstream.port || 80,
    path: targetPath,
    method: req.method,
    headers: {
      // Forward all original headers EXCEPT host and authorization
      ...(Object.fromEntries(
        Object.entries(req.headers)
          .filter(([key]) => !['host', 'authorization'].includes(key.toLowerCase()))
      )),
      // Set correct host for the upstream server
      host: upstream.host,
      // Inject auth header (won't conflict with SPA's own auth because we remove original)
      authorization: `Basic ${authToken}`,
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
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
  console.log(`✓ Auth proxy listening on :${PROXY_PORT} → ${UPSTREAM_URL}`);
  console.log(`  Password: ${password}`);
  console.log(`  Auth token: ${authToken}`);
});
