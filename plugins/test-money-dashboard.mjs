import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'E:\\Glitch AI\\code\\glitch-money';
const GLITCH_AI = 'E:\\Glitch AI\\glitch-ai';
const DASHBOARD_PORT = 4110;
const PROXY_PORT = 4101;
let pass = 0, fail = 0;

function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail || ''}`); }
}

function req(method, port, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (body) h['Content-Type'] = 'application/json';
    const r = http.request({ method, hostname: 'localhost', port, path: urlPath, headers: h }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    r.setTimeout(5000, () => { r.destroy(new Error('timeout')); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

// Kill any stale process on port 4110
try {
  const stale = execSync(`netstat -ano | findstr ":${DASHBOARD_PORT} "`, { encoding: 'utf-8' });
  const pids = [...stale.matchAll(/(\d+)\s*$/gm)].map(m => parseInt(m[1]));
  for (const pid of [...new Set(pids)]) {
    try { process.kill(pid); } catch {}
  }
  await new Promise(r => setTimeout(r, 500));
} catch {}

// Start dashboard server
console.log('\n=== STARTING DASHBOARD (port ' + DASHBOARD_PORT + ', --seed) ===');
const dashboard = spawn(process.execPath, ['dashboard/server.mjs', '--seed', '--port', String(DASHBOARD_PORT)], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
let dashOut = '';
dashboard.stdout.on('data', d => dashOut += d);
dashboard.stderr.on('data', d => dashOut += d);
await new Promise(r => setTimeout(r, 3000));
console.log('Dashboard output: ' + dashOut.trim());

// Extract token from dashboard output
const tokenMatch = dashOut.match(/Dashboard token: ([a-f0-9]+)/);
const token = tokenMatch ? tokenMatch[1] : null;
if (!token) { console.log('FAIL: No token found in dashboard output'); process.exit(1); }
console.log('Token: ' + token.substring(0, 8) + '...');

// Start auth-proxy
console.log('\n=== STARTING AUTH-PROXY (port ' + PROXY_PORT + ') ===');
const proxy = spawn(process.execPath, ['plugins/auth-proxy.mjs', String(PROXY_PORT), 'http://localhost:4102'], { cwd: GLITCH_AI, stdio: ['pipe', 'pipe', 'pipe'] });
let proxyOut = '';
proxy.stdout.on('data', d => proxyOut += d);
proxy.stderr.on('data', d => proxyOut += d);
await new Promise(r => setTimeout(r, 2000));
console.log('Auth-proxy output: ' + proxyOut.trim());

// Read auth-proxy password
const proxyPassword = fs.readFileSync(path.join(GLITCH_AI, '.server-password'), 'utf-8').trim();
const proxyAuth = 'Basic ' + Buffer.from('opencode:' + proxyPassword).toString('base64');

// Login to dashboard directly to get the glitch_dash cookie
console.log('\n=== DASHBOARD LOGIN ===');
const loginRes = await req('POST', DASHBOARD_PORT, '/api/login', { token }, {});
check('Dashboard login returns 200', loginRes.status === 200, `got ${loginRes.status}`);
const setCookie = loginRes.headers['set-cookie'];
let dashCookie = null;
if (setCookie) {
  const cookieArr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of cookieArr) {
    if (c.startsWith('glitch_dash=')) {
      dashCookie = c.split(';')[0];
      break;
    }
  }
}
check('Dashboard sets glitch_dash cookie', !!dashCookie, 'no cookie');

// Combined headers: auth-proxy Basic + dashboard cookie
const authHeaders = {
  'Authorization': proxyAuth,
  'Cookie': dashCookie || '',
};

// Test 1: /money without auth → 401
console.log('\n=== AUTH GATING ===');
const noAuth = await req('GET', PROXY_PORT, '/money/', null, {});
check('No-auth /money/ returns 401', noAuth.status === 401, `got ${noAuth.status}`);

// Test 2: /money with auth → 200 HTML
const withAuth = await req('GET', PROXY_PORT, '/money/', null, authHeaders);
check('Auth /money/ returns 200', withAuth.status === 200, `got ${withAuth.status}`);
check('HTML contains GLITCH MONEY', withAuth.body.includes('GLITCH MONEY'), 'missing title');
check('HTML contains Control Dashboard', withAuth.body.includes('Control Dashboard'), 'missing subtitle');

// Test 3: Static assets with auth
console.log('\n=== STATIC ASSETS ===');
const css = await req('GET', PROXY_PORT, '/money/styles.css', null, authHeaders);
check('GET /money/styles.css returns 200', css.status === 200, `got ${css.status}`);
check('CSS contains dark tech styles', css.body.includes('--bg'), 'missing CSS vars');

const js = await req('GET', PROXY_PORT, '/money/app.js', null, authHeaders);
check('GET /money/app.js returns 200', js.status === 200, `got ${js.status}`);

// Test 4: API endpoints via /money
console.log('\n=== API ENDPOINTS ===');
const eps = ['/money/api/fleet', '/money/api/money', '/money/api/cost', '/money/api/ledger', '/money/api/security', '/money/api/approvals', '/money/api/quality', '/money/api/events'];
for (const ep of eps) {
  const r = await req('GET', PROXY_PORT, ep, null, authHeaders);
  const ok = r.status === 200 && r.body.length > 2;
  check(`GET ${ep}`, ok, `status=${r.status} body=${r.body.substring(0, 80)}`);
}

// Test 5: Fleet shape
console.log('\n=== FLEET SHAPE ===');
const fleet = JSON.parse((await req('GET', PROXY_PORT, '/money/api/fleet', null, authHeaders)).body);
check('Fleet has agents array', Array.isArray(fleet.agents), typeof fleet.agents);
check('Fleet has seeded agents', fleet.agents.length > 0, `count=${fleet.agents?.length}`);

// Test 6: Money shape
console.log('\n=== MONEY SHAPE ===');
const money = JSON.parse((await req('GET', PROXY_PORT, '/money/api/money', null, authHeaders)).body);
check('Money has totalRevenue', typeof money.totalRevenue === 'number', typeof money.totalRevenue);
check('Money has totalCost', typeof money.totalCost === 'number', typeof money.totalCost);
check('Money has net', typeof money.net === 'number', typeof money.net);

// Test 7: Approvals flow
console.log('\n=== APPROVALS FLOW ===');
const apRes = JSON.parse((await req('GET', PROXY_PORT, '/money/api/approvals', null, authHeaders)).body);
check('Has pending approvals', apRes.pending.length > 0, `count=${apRes.pending?.length}`);
if (apRes.pending.length > 0) {
  const id = apRes.pending[0].id;
  const approveRes = await req('POST', PROXY_PORT, `/money/api/approvals/${id}/approve`, null, authHeaders);
  check(`Approve ${id}`, approveRes.status === 200, `status=${approveRes.status}`);
  const apRes2 = JSON.parse((await req('GET', PROXY_PORT, '/money/api/approvals', null, authHeaders)).body);
  const approved = apRes2.history?.find(a => a.id === id);
  check('Approval persisted', approved?.status === 'approved', `status=${approved?.status}`);
}

// Test 8: Killswitch
console.log('\n=== KILLSWITCH ===');
const ksRes = await req('POST', PROXY_PORT, '/money/api/killswitch', { confirm: true }, authHeaders);
check('Killswitch returns 200', ksRes.status === 200, `status=${ksRes.status}`);
const ksFlag = fs.existsSync(path.join(ROOT, 'data', '.killswitch-triggered'));
check('killswitch-triggered flag created', ksFlag, 'file missing');

// Kill servers
dashboard.kill();
proxy.kill();
await new Promise(r => setTimeout(r, 1000));

// Summary
console.log('\n=========================');
console.log(`VERDICT: ${fail === 0 ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'} (${pass} passed, ${fail} failed)`);
console.log('=========================');
process.exit(fail > 0 ? 1 : 0);
