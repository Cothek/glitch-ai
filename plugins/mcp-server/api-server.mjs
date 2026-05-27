import { createServer } from 'http';
import { Vault } from './vault.mjs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 4390;

async function main() {
  let vault;
  try {
    vault = await Vault.load(resolve(__dirname, '.env.glitch'));
    console.error(`[api-server] Vault loaded: ${vault.listSections().join(', ')}`);
  } catch (err) {
    console.error(`[api-server] Failed to load vault: ${err.message}`);
    vault = null;
  }

  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;

    try {
      if (path === '/api/health') {
        sendJson(res, 200, {
          status: 'ok',
          version: '1.0.0',
          sections: vault ? vault.listSections() : []
        });
        return;
      }

      const envMatch = path.match(/^\/api\/env\/([^/]+)$/);
      if (envMatch) {
        if (!vault) {
          sendJson(res, 503, { error: 'Vault not loaded' });
          return;
        }
        const project = envMatch[1];
        const env = url.searchParams.get('env') || undefined;
        const result = vault.getEnv(project, env);
        if (!result) {
          sendJson(res, 404, {
            error: 'Project not found',
            available: vault.listSections()
          });
          return;
        }
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, { error: 'Not found', path });

    } catch (err) {
      console.error(`[api-server] Error: ${err.message}`);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.error(`[api-server] Listening on http://127.0.0.1:${PORT}`);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

main().catch(err => {
  console.error('[api-server] Fatal:', err);
  process.exit(1);
});
