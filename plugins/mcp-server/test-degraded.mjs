import { spawn } from 'node:child_process';

const child = spawn('node', ['index.mjs'], {
  cwd: 'E:\\Glitch AI\\glitch-ai\\plugins\\mcp-server',
  stdio: ['pipe', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';

child.stdout.on('data', (data) => {
  stdout += data.toString();
});

child.stderr.on('data', (data) => {
  stderr += data.toString();
});

child.on('error', (err) => {
  console.error('Spawn error:', err);
  process.exit(1);
});

// Helper: send a JSON-RPC message
function send(msg) {
  child.stdin.write(JSON.stringify(msg) + '\n');
}

// Give the server time to start, then send messages in sequence
setTimeout(() => {
  // 1. Initialize
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    }
  });
}, 500);

setTimeout(() => {
  // 2. Initialized notification
  send({
    jsonrpc: '2.0',
    method: 'notifications/initialized'
  });
}, 1000);

setTimeout(() => {
  // 3. List tools
  send({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list'
  });
}, 1500);

setTimeout(() => {
  // 4. Call mcp_env (should fail in degraded mode)
  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'mcp_env',
      arguments: { project: 'ai-gm' }
    }
  });
}, 2000);

setTimeout(() => {
  // 5. Wait for responses, then kill and print results
  setTimeout(() => {
    child.kill();
    console.log('=== STDOUT ===');
    console.log(stdout);
    console.log('=== STDERR ===');
    console.log(stderr);
  }, 1000);
}, 2500);
