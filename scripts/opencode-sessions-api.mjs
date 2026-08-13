import { createServer } from 'node:http';
import { join } from 'node:path';
import { queryRecentSessions } from './query-opencode-sessions.mjs';
import { querySessionTokens, queryAggregateTokens } from './query-opencode-tokens.mjs';

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 4191;

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  if (path === '/health' && method === 'GET') {
    json(res, { status: 'ok', uptime: process.uptime(), ts: new Date().toISOString() });
    return;
  }

  if (path === '/sessions' && method === 'GET') {
    const hours = parseInt(url.searchParams.get('hours') || '6', 10);
    const result = queryRecentSessions(hours);
    if (result.error) {
      json(res, { error: result.error, sessions: [], orphans: [], total: 0 }, 200);
      return;
    }
    json(res, result);
    return;
  }

  if (path === '/tokens' && method === 'GET') {
    const hours = parseInt(url.searchParams.get('hours') || '6', 10);
    const sessions = querySessionTokens(hours);
    const aggregate = queryAggregateTokens(hours);
    if (sessions.error) {
      json(res, { error: sessions.error, sessions: [], aggregate: [] }, 200);
      return;
    }
    json(res, { sessions, aggregate: aggregate || [], period: `${hours}h` });
    return;
  }

  json(res, { error: 'Not found' }, 404);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`OpenCode Sessions API listening on port ${PORT}`);
});
