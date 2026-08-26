import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = pathToFileURL(join(__dirname, '..', '.opencode', 'plugins', 'agent-telemetry.mjs')).href;
const TOKEN_PATH = join('E:', 'Glitch AI', 'code', 'glitch-money', 'data', '.dashboard-token');
const DASHBOARD_BASE = 'http://localhost:4110';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}`);
    failed++;
  }
}

console.log('=== Plugin Smoke Test (Extended) ===\n');

const { AgentTelemetryPlugin, activeTasks, extractResultText } = await import(PLUGIN_PATH);
const plugin = await AgentTelemetryPlugin({ directory: join(__dirname, '..') });
const hooks = Object.keys(plugin);
console.log('Plugin loaded, hooks:', hooks.join(', '));

const beforeHook = plugin['tool.execute.before'];
const afterHook = plugin['tool.execute.after'];

console.log('\n--- Unit: extractResultText ---');
assert(extractResultText('raw string') === 'raw string', 'extracts from raw string');
assert(extractResultText({ result: 'wrapped' }) === 'wrapped', 'extracts from {result: string}');
assert(extractResultText({ result: 123 }) !== 'wrapped', 'non-string result falls through');
assert(extractResultText(null) === '', 'null returns empty');
assert(extractResultText(undefined) === '', 'undefined returns empty');
assert(typeof extractResultText({ foo: 'bar' }) === 'string', 'object fallback returns string');

console.log('\n--- Integration: before → after round-trip (success) ---');
await beforeHook({
  tool: 'task',
  agent: 'coder-paid',
  description: 'Smoke test: build a landing page'
});

assert(activeTasks.size === 1, 'activeTasks has 1 entry after before hook');
const [taskId, taskInfo] = [...activeTasks.entries()][0];
assert(taskInfo.agentName === 'coder-paid', 'stored agentName = coder-paid');
assert(typeof taskInfo.startTime === 'number', 'stored startTime is number');

await new Promise(r => setTimeout(r, 1200));

await afterHook(
  { tool: 'task', agent: 'coder-paid' },
  { result: 'Successfully built the landing page with all sections.' }
);

assert(activeTasks.size === 0, 'activeTasks empty after after hook (matched by agent name)');

await new Promise(r => setTimeout(r, 500));

let token = null;
let dashboardUp = false;
try {
  token = readFileSync(TOKEN_PATH, 'utf-8').trim();
  const healthRes = await fetch(`${DASHBOARD_BASE}/api/fleet`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  dashboardUp = healthRes.status === 200;
} catch {}

if (dashboardUp) {
  const res = await fetch(`${DASHBOARD_BASE}/api/fleet`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  const smokeAgent = data.agents?.find(a => a.id === taskId);
  assert(!!smokeAgent, 'fleet contains completed smoke agent by id');
  if (smokeAgent) {
    assert(smokeAgent.status === 'completed', `smoke agent status = completed (got: ${smokeAgent.status})`);
    assert(smokeAgent.role === 'builder', `smoke agent role = builder (got: ${smokeAgent.role})`);
    assert(smokeAgent.elapsedSec >= 1, `smoke agent elapsedSec >= 1 (got: ${smokeAgent.elapsedSec})`);
  }
  console.log('  INFO: Dashboard verified events via /api/fleet');
} else {
  console.log('  SKIP: Dashboard not running on 4110 — skipping fleet verification');
}

console.log('\n--- Integration: before → after round-trip (failure path) ---');
await beforeHook({
  tool: 'task',
  agent: 'reviewer-paid',
  description: 'Smoke test: review that will fail'
});

const [failTaskId, failTaskInfo] = [...activeTasks.entries()][0];
assert(failTaskInfo.agentName === 'reviewer-paid', 'failure-path agentName = reviewer-paid');

await new Promise(r => setTimeout(r, 500));

await afterHook(
  { tool: 'task', agent: 'reviewer-paid' },
  { result: 'Tool execution aborted — error: model not found' }
);

assert(activeTasks.size === 0, 'activeTasks empty after failure-path after hook');

if (dashboardUp) {
  await new Promise(r => setTimeout(r, 500));
  const res = await fetch(`${DASHBOARD_BASE}/api/fleet`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  const failAgent = data.agents?.find(a => a.id === failTaskId);
  assert(!!failAgent, 'fleet contains failed smoke agent by id');
  if (failAgent) {
    assert(failAgent.status === 'failed', `failure-path status = failed (got: ${failAgent.status})`);
    assert(failAgent.role === 'validator', `failure-path role = validator (got: ${failAgent.role})`);
  }
} else {
  console.log('  SKIP: Dashboard not running — skipping failure-path fleet verification');
}

console.log('\n--- Integration: agent-name matching (concurrent tasks) ---');
await beforeHook({ tool: 'task', agent: 'coder-paid', description: 'Concurrent task A' });
await beforeHook({ tool: 'task', agent: 'reviewer-paid', description: 'Concurrent task B' });
assert(activeTasks.size === 2, 'activeTasks has 2 entries for concurrent tasks');

const entriesBefore = [...activeTasks.entries()];
const firstAgent = entriesBefore[0][1].agentName;
const secondAgent = entriesBefore[1][1].agentName;
assert(firstAgent === 'coder-paid', 'first entry = coder-paid');
assert(secondAgent === 'reviewer-paid', 'second entry = reviewer-paid');

await afterHook(
  { tool: 'task', agent: 'reviewer-paid' },
  'Task B done'
);

assert(activeTasks.size === 1, 'after matching reviewer-paid, only coder-paid remains');
const [remainingId, remainingInfo] = [...activeTasks.entries()][0];
assert(remainingInfo.agentName === 'coder-paid', 'remaining entry = coder-paid (correct match, not FIFO)');

await afterHook(
  { tool: 'task', agent: 'coder-paid' },
  { result: 'Task A done' }
);
assert(activeTasks.size === 0, 'activeTasks empty after both concurrent tasks resolved');

console.log('\n--- Integration: FIFO fallback for unknown agent ---');
await beforeHook({ tool: 'task', agent: 'coder-paid', description: 'Fallback test' });
await afterHook(
  { tool: 'task', agent: 'unknown-agent-xyz' },
  'Fallback result'
);
assert(activeTasks.size === 0, 'FIFO fallback consumed the orphan entry');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
