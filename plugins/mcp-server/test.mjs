import { spawn } from 'child_process';

const serverPath = 'index.mjs';

let pendingResolve = null;
let buffer = '';

function onStdout(data) {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (pendingResolve) {
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve(parsed);
      }
    } catch {
      console.log(`[stdout-unparseable] ${trimmed}`);
    }
  }
}

function sendRequest(proc, msg) {
  return new Promise((resolve, reject) => {
    pendingResolve = resolve;
    const json = JSON.stringify(msg) + '\n';
    console.log(`\n>>> SEND: ${json.trim()}`);
    proc.stdin.write(json);
    setTimeout(() => {
      if (pendingResolve) {
        pendingResolve = null;
        reject(new Error('Timeout waiting for response'));
      }
    }, 5000);
  });
}

const proc = spawn('node', [serverPath], {
  cwd: '.',
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env }
});

let stderrLog = '';
proc.stderr.on('data', (d) => {
  const text = d.toString();
  stderrLog += text;
  process.stderr.write(text);
});

proc.stdout.on('data', onStdout);

proc.on('error', (err) => {
  console.error(`Process error: ${err.message}`);
  process.exit(1);
});

proc.on('exit', (code) => {
  console.log(`Process exited with code ${code}`);
});

async function main() {
  // Wait for server to start
  await new Promise(r => setTimeout(r, 1000));

  try {
    // Step 1: Initialize
    const initResp = await sendRequest(proc, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    });
    console.log(`<<< INIT RESPONSE:\n${JSON.stringify(initResp, null, 2)}`);

    // Step 2: Send initialized notification
    console.log(`\n>>> SEND: {"jsonrpc":"2.0","method":"notifications/initialized"}`);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    await new Promise(r => setTimeout(r, 500));

    // Step 3: List tools
    const listResp = await sendRequest(proc, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list'
    });
    console.log(`<<< LIST TOOLS RESPONSE:\n${JSON.stringify(listResp, null, 2)}`);

    // Step 4: Call mcp_env for ai-gm
    const envResp = await sendRequest(proc, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'mcp_env',
        arguments: { project: 'ai-gm' }
      }
    });
    console.log(`<<< MCP_ENV RESPONSE:\n${JSON.stringify(envResp, null, 2)}`);

    // Done
    console.log('\n=== ALL TESTS PASSED ===');
  } catch (err) {
    console.error(`\n=== TEST FAILED: ${err.message} ===`);
  } finally {
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL');
    }, 2000);
  }
}

main();
