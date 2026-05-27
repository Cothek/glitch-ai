import { createInterface } from 'node:readline';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

async function main() {
  try {
    await import('@modelcontextprotocol/sdk/types.js');
    await import('./server.mjs');
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' || (err.message && err.message.includes('Cannot find module'))) {
      console.error('[glitch-connector] Dependencies not installed. Run: cd plugins/mcp-server && npm install');
      console.error('[glitch-connector] Starting in degraded mode — no tools available');
      startDegradedMode();
    } else {
      console.error('[glitch-connector] Unexpected error:', err);
      process.exit(1);
    }
  }
}

function startDegradedMode() {
  const rl = createInterface({ input: process.stdin });

  rl.on('line', (line) => {
    line = line.trim();
    if (!line) return;
    try {
      const msg = JSON.parse(line);
      handleMessage(msg);
    } catch (e) {
      // Malformed JSON — ignore
    }
  });

  function handleMessage(msg) {
    if (msg.method === 'initialize') {
      writeResponse(msg.id, {
        protocolVersion: msg.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'glitch-connector', version: '1.0.0' }
      });
    } else if (msg.method === 'notifications/initialized') {
      // No response for notifications
    } else if (msg.method === 'tools/list') {
      writeResponse(msg.id, { tools: [] });
    } else if (msg.method === 'tools/call') {
      writeError(msg.id, -32001, `Tool "${msg.params?.name}" not available — dependencies not installed. Run: cd plugins/mcp-server && npm install`);
    } else {
      writeError(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  }

  function writeResponse(id, result) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  }

  function writeError(id, code, message) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
  }
}

main().catch(err => {
  console.error('[glitch-connector] Fatal error:', err);
  process.exit(1);
});
