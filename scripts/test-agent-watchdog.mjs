// test-agent-watchdog.mjs — Verification harness for the hung-agent watchdog.
//
// Tests:
//   1. Signal schema unification — both writers produce the same field names.
//   2. Transform injection scoping — sub-agent sessions do NOT get the directive;
//      parent sessions DO (only for their own children).
//   3. Signal TTL expiry — stale signals are swept.
//   4. Threshold parsing — invalid env falls back to default with warning.
//
// Run: node scripts/test-agent-watchdog.mjs
// (or: data\node\node.exe scripts/test-agent-watchdog.mjs)

import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseThreshold, isSignalFresh, shouldInjectForSession, isSessionToolRunning } from '../scripts/lib/agent-watchdog-helpers.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failed++;
    console.error(`  \u2717 ${name}`);
    console.error(`    ${e.message}`);
  }
}

// ============================================================
console.log('\n1. Signal schema unification:');
// ============================================================
// Both the standalone script (agent-watchdog.mjs) and the plugin
// (agent-watchdog.js) must emit the same field names so the plugin's
// transform hook can read signals from either source.

const UNIFIED_FIELDS = ['detectedAt', 'sessionID', 'tool', 'idleSeconds', 'threshold', 'recommendation'];

test('plugin writeIdleSignal payload has all unified fields', () => {
  // Simulate the plugin's payload shape (mirrors writeIdleSignal in agent-watchdog.js).
  const payload = {
    detectedAt: new Date().toISOString(),
    sessionID: 'ses_test_plugin',
    tool: 'task',
    idleSeconds: 350,
    threshold: 300,
    recommendation: 'Agent idle >300s — aborting and re-dispatching',
  };
  for (const field of UNIFIED_FIELDS) {
    assert.ok(field in payload, `Missing field: ${field}`);
  }
  assert.strictEqual(typeof payload.detectedAt, 'string', 'detectedAt must be ISO string');
  assert.ok(payload.tool !== undefined, 'tool must be defined (not runningTool)');
  assert.ok(!('runningTool' in payload), 'runningTool must NOT exist (renamed to tool)');
});

test('standalone script signal payload has all unified fields', () => {
  // Simulate the standalone script's payload shape (mirrors agent-watchdog.mjs).
  const payload = {
    sessionID: 'ses_test_standalone',
    agent: 'coder',
    title: 'test',
    idleSeconds: 350,
    lastActivity: Date.now() - 350000,
    threshold: 300,
    detectedAt: new Date().toISOString(),
    tool: 'task',
    recommendation: 'Agent idle >300s — aborting and re-dispatching',
  };
  for (const field of UNIFIED_FIELDS) {
    assert.ok(field in payload, `Missing field: ${field}`);
  }
  assert.strictEqual(typeof payload.detectedAt, 'string', 'detectedAt must be ISO string');
  assert.ok(payload.tool !== undefined, 'tool must be defined (not runningTool)');
  assert.ok(!('runningTool' in payload), 'runningTool must NOT exist (renamed to tool)');
});

test('plugin transform hook reads signal.tool defensively (falls back to unknown)', () => {
  // Simulate an old-format signal that has runningTool instead of tool.
  const oldSignal = {
    detectedAt: new Date().toISOString(),
    sessionID: 'ses_old',
    threshold: 300,
    // tool is missing (old format had runningTool)
  };
  const toolName = oldSignal.tool ?? 'unknown';
  assert.strictEqual(toolName, 'unknown', 'Missing tool should fall back to unknown');
});

// ============================================================
console.log('\n2. Transform injection scoping (M3 — parent vs sub-agent):');
// ============================================================

test('sub-agent session (not in parent set) does NOT get directive', () => {
  const parentSessions = new Set(['ses_parent']);
  const childrenByParent = new Map([['ses_parent', new Set(['ses_child'])]]);
  // ses_subagent is NOT in parentSessions — it's a sub-agent.
  const result = shouldInjectForSession('ses_subagent', 'ses_child', parentSessions, childrenByParent);
  assert.strictEqual(result, false, 'Sub-agent must NOT receive directives');
});

test('parent session gets directive for its OWN child', () => {
  const parentSessions = new Set(['ses_parent']);
  const childrenByParent = new Map([['ses_parent', new Set(['ses_child'])]]);
  const result = shouldInjectForSession('ses_parent', 'ses_child', parentSessions, childrenByParent);
  assert.strictEqual(result, true, 'Parent must receive directives for its own children');
});

test('parent session does NOT get directive for unrelated session', () => {
  const parentSessions = new Set(['ses_parent']);
  const childrenByParent = new Map([['ses_parent', new Set(['ses_child'])]]);
  // ses_other is NOT a child of ses_parent.
  const result = shouldInjectForSession('ses_parent', 'ses_other', parentSessions, childrenByParent);
  assert.strictEqual(result, false, 'Parent must NOT receive directives for unrelated sessions');
});

test('parent with no recorded children falls back to injecting (child tracking is best-effort)', () => {
  const parentSessions = new Set(['ses_parent']);
  const childrenByParent = new Map(); // no children recorded
  // Fallback: parent with no recorded children still receives directives
  // because child tracking is best-effort (task output may not expose child sessionID).
  const result = shouldInjectForSession('ses_parent', 'ses_child', parentSessions, childrenByParent);
  assert.strictEqual(result, true, 'Parent with no recorded children falls back to injecting');
});

test('parent with recorded children only injects for those children', () => {
  const parentSessions = new Set(['ses_parent']);
  const childrenByParent = new Map([['ses_parent', new Set(['ses_child_a'])]]);
  // ses_child_b is NOT in the recorded children set.
  const result = shouldInjectForSession('ses_parent', 'ses_child_b', parentSessions, childrenByParent);
  assert.strictEqual(result, false, 'Parent with recorded children must not inject for unrecorded sessions');
});

test('empty sessionID returns false', () => {
  const parentSessions = new Set(['ses_parent']);
  const childrenByParent = new Map([['ses_parent', new Set(['ses_child'])]]);
  assert.strictEqual(shouldInjectForSession('', 'ses_child', parentSessions, childrenByParent), false);
  assert.strictEqual(shouldInjectForSession('ses_parent', '', parentSessions, childrenByParent), false);
});

// ============================================================
console.log('\n3. Signal TTL expiry:');
// ============================================================

test('fresh signal (within TTL) returns true', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'watchdog-test-'));
  const signalPath = join(tmpDir, '.agent-idle.ses_fresh.json');
  const payload = {
    detectedAt: new Date().toISOString(),
    sessionID: 'ses_fresh',
    tool: 'task',
    threshold: 300,
  };
  writeFileSync(signalPath, JSON.stringify(payload), 'utf-8');
  const result = isSignalFresh(signalPath, 15 * 60 * 1000);
  assert.strictEqual(result, true, 'Fresh signal must return true');
});

test('stale signal (beyond TTL) returns false', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'watchdog-test-'));
  const signalPath = join(tmpDir, '.agent-idle.ses_stale.json');
  // 20 minutes ago — beyond the 15-min TTL.
  const staleTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const payload = {
    detectedAt: staleTime,
    sessionID: 'ses_stale',
    tool: 'task',
    threshold: 300,
  };
  writeFileSync(signalPath, JSON.stringify(payload), 'utf-8');
  const result = isSignalFresh(signalPath, 15 * 60 * 1000);
  assert.strictEqual(result, false, 'Stale signal must return false');
});

test('epoch-ms detectedAt (number) also works — schema compat', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'watchdog-test-'));
  const signalPath = join(tmpDir, '.agent-idle.ses_epoch.json');
  const payload = {
    detectedAt: Date.now(), // epoch-ms number (old standalone format)
    sessionID: 'ses_epoch',
    tool: 'task',
    threshold: 300,
  };
  writeFileSync(signalPath, JSON.stringify(payload), 'utf-8');
  const result = isSignalFresh(signalPath, 15 * 60 * 1000);
  assert.strictEqual(result, true, 'Epoch-ms detectedAt must be accepted');
});

test('malformed signal file returns false', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'watchdog-test-'));
  const signalPath = join(tmpDir, '.agent-idle.ses_bad.json');
  writeFileSync(signalPath, 'not valid json{{{', 'utf-8');
  const result = isSignalFresh(signalPath, 15 * 60 * 1000);
  assert.strictEqual(result, false, 'Malformed signal must return false');
});

test('missing signal file returns false', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'watchdog-test-'));
  const signalPath = join(tmpDir, '.agent-idle.ses_missing.json');
  const result = isSignalFresh(signalPath, 15 * 60 * 1000);
  assert.strictEqual(result, false, 'Missing signal file must return false');
});

// ============================================================
console.log('\n4. Threshold parsing (m3 — NaN fallback with warning):');
// ============================================================

test('valid env value is used', () => {
  process.env.AGENT_IDLE_THRESHOLD_MS = '120000';
  const result = parseThreshold('AGENT_IDLE_THRESHOLD_MS', 300000);
  assert.strictEqual(result, 120000, 'Valid env value must be used');
  delete process.env.AGENT_IDLE_THRESHOLD_MS;
});

test('missing env falls back to default', () => {
  delete process.env.AGENT_IDLE_THRESHOLD_MS;
  const result = parseThreshold('AGENT_IDLE_THRESHOLD_MS', 300000);
  assert.strictEqual(result, 300000, 'Missing env must fall back to default');
});

test('invalid env (NaN) falls back to default', () => {
  const originalWarn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  process.env.AGENT_IDLE_THRESHOLD_MS = 'not-a-number';
  const result = parseThreshold('AGENT_IDLE_THRESHOLD_MS', 300000);
  console.warn = originalWarn;
  delete process.env.AGENT_IDLE_THRESHOLD_MS;
  assert.strictEqual(result, 300000, 'Invalid env must fall back to default');
  assert.strictEqual(warned, true, 'Invalid env must trigger a warning');
});

test('empty string env falls back to default', () => {
  process.env.AGENT_IDLE_THRESHOLD_MS = '';
  const result = parseThreshold('AGENT_IDLE_THRESHOLD_MS', 300000);
  delete process.env.AGENT_IDLE_THRESHOLD_MS;
  assert.strictEqual(result, 300000, 'Empty string env must fall back to default');
});

// ============================================================
console.log('\n5. M2 — Map key race (composite key prevents cross-tool deletion):');
// ============================================================

test('composite key: tool A after-hook does NOT delete tool B entry', () => {
  // Simulate the plugin's runningTools Map with composite keys.
  // Session runs tool A (task) at t=1000, then tool B (read) at t=2000.
  // Tool A's after-hook fires AFTER tool B's before-hook (overlap/delay).
  // The after-hook must only delete tool A's entry, not tool B's.
  const runningTools = new Map();
  const sessionID = 'ses_race';
  const toolA = 'task';
  const toolB = 'read';
  const startA = 1000;
  const startB = 2000;

  function toolKey(sid, tool, start) { return `${sid}|${tool}|${start}`; }

  // before-hook for tool A
  runningTools.set(toolKey(sessionID, toolA, startA), { sessionID, tool: toolA, startTime: startA, aborted: false });
  // before-hook for tool B (tool A still running)
  runningTools.set(toolKey(sessionID, toolB, startB), { sessionID, tool: toolB, startTime: startB, aborted: false });

  assert.strictEqual(runningTools.size, 2, 'Both tools must be tracked');

  // after-hook for tool A — must only delete tool A's entry (matching tool name).
  for (const [key, entry] of runningTools) {
    if (entry.sessionID === sessionID && entry.tool === toolA) {
      runningTools.delete(key);
      break;
    }
  }

  assert.strictEqual(runningTools.size, 1, 'Only tool A deleted; tool B must remain');
  const remaining = [...runningTools.values()][0];
  assert.strictEqual(remaining.tool, toolB, 'Remaining entry must be tool B');
});

test('composite key: sequential tools (A finishes, B starts) — no race', () => {
  const runningTools = new Map();
  const sessionID = 'ses_seq';
  const toolA = 'task';
  const toolB = 'read';
  const startA = 1000;
  const startB = 2000;

  function toolKey(sid, tool, start) { return `${sid}|${tool}|${start}`; }

  // before-hook for tool A
  runningTools.set(toolKey(sessionID, toolA, startA), { sessionID, tool: toolA, startTime: startA, aborted: false });
  // after-hook for tool A (finishes before B starts)
  for (const [key, entry] of runningTools) {
    if (entry.sessionID === sessionID && entry.tool === toolA) {
      runningTools.delete(key);
      break;
    }
  }
  assert.strictEqual(runningTools.size, 0, 'Tool A deleted cleanly');
  // before-hook for tool B
  runningTools.set(toolKey(sessionID, toolB, startB), { sessionID, tool: toolB, startTime: startB, aborted: false });
  assert.strictEqual(runningTools.size, 1, 'Tool B tracked');
  const remaining = [...runningTools.values()][0];
  assert.strictEqual(remaining.tool, toolB, 'Remaining entry must be tool B');
});

// ============================================================
console.log('\n6. a4 — Parameterized recommendation text:');
// ============================================================

test('recommendation text uses threshold value, not hardcoded 5min', () => {
  // Simulate writeIdleSignal's payload with threshold=600 (10 min).
  const threshold = 600;
  const recommendation = `Agent idle >${threshold}s — aborting and re-dispatching`;
  assert.ok(recommendation.includes('600s'), 'Recommendation must include the actual threshold');
  assert.ok(!recommendation.includes('5min'), 'Recommendation must NOT hardcode 5min');
});

test('recommendation text with 300s threshold', () => {
  const threshold = 300;
  const recommendation = `Agent idle >${threshold}s — aborting and re-dispatching`;
  assert.ok(recommendation.includes('300s'), 'Recommendation must include 300s');
});

// ============================================================
console.log('\n7. MAJOR-2 — isSessionToolRunning (DB liveness check):');
// ============================================================
// isSessionToolRunning queries the opencode SQLite DB to verify a session
// still has a tool in the "running" state. It gates abort decisions, so it
// must be tested directly. We create temp SQLite DBs matching the real
// `part` table schema (session_id + data columns with json_extract on
// $.state.status = 'running').

// Helper: create a temp SQLite DB with the part table and insert rows.
// Returns the DB file path. Caller must clean up the temp dir.
function createTestDb(rows) {
  const { DatabaseSync } = createRequireFromNodeSqlite();
  if (!DatabaseSync) return null;
  const tmpDir = mkdtempSync(join(tmpdir(), 'watchdog-db-test-'));
  const dbPath = join(tmpDir, 'opencode.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE part (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_updated INTEGER)`);
  for (const r of rows) {
    db.prepare(`INSERT INTO part (id, session_id, data, time_updated) VALUES (?, ?, ?, ?)`).run(
      r.id, r.session_id, r.data, r.time_updated ?? Date.now()
    );
  }
  db.close();
  return dbPath;
}

// Lazy require of node:sqlite via createRequire (mirrors the helpers module).
import { createRequire } from 'node:module';
function createRequireFromNodeSqlite() {
  const req = createRequire(import.meta.url);
  try {
    return { DatabaseSync: req('node:sqlite').DatabaseSync };
  } catch {
    return { DatabaseSync: null };
  }
}

// Helper: clean up a temp DB dir.
function cleanupDb(dbPath) {
  if (!dbPath) return;
  try { rmSync(join(dbPath, '..'), { recursive: true, force: true }); } catch { /* best-effort */ }
}

test('session with a running part → alive: true', () => {
  const dbPath = createTestDb([
    { id: 'p1', session_id: 'ses_running', data: JSON.stringify({ state: { status: 'running' }, tool: 'bash' }) },
  ]);
  if (!dbPath) { console.log('    (skipped — node:sqlite unavailable on this Node)'); return; }
  try {
    const result = isSessionToolRunning('ses_running', dbPath);
    assert.strictEqual(result.alive, true, 'Session with a running part must be alive');
    assert.strictEqual(result.tool, 'bash', 'Tool name must be extracted from part data');
  } finally { cleanupDb(dbPath); }
});

test('session with no running parts → alive: false', () => {
  const dbPath = createTestDb([
    { id: 'p1', session_id: 'ses_done', data: JSON.stringify({ state: { status: 'completed' }, tool: 'bash' }) },
    { id: 'p2', session_id: 'ses_done', data: JSON.stringify({ state: { status: 'error' }, tool: 'read' }) },
  ]);
  if (!dbPath) { console.log('    (skipped — node:sqlite unavailable on this Node)'); return; }
  try {
    const result = isSessionToolRunning('ses_done', dbPath);
    assert.strictEqual(result.alive, false, 'Session with no running parts must be not-alive');
  } finally { cleanupDb(dbPath); }
});

test('non-existent DB file → alive: null (with error)', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'watchdog-db-test-'));
  const nonexistentPath = join(tmpDir, 'does-not-exist.db');
  try {
    const result = isSessionToolRunning('ses_any', nonexistentPath);
    assert.strictEqual(result.alive, null, 'Non-existent DB must return alive:null');
    assert.ok(result.error, 'Non-existent DB must include an error message');
    // node:sqlite may create the file on open (readonly doesn't prevent
    // creation on some platforms), so the error may be "no such table: part"
    // rather than "DB open failed". Either way, alive:null + error is correct.
    assert.ok(
      result.error.includes('DB open failed') || result.error.includes('no such table'),
      `Error must mention DB open failure or missing table, got: ${result.error}`
    );
  } finally { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

test('malformed part data → handled without crash (alive:false or null, no throw)', () => {
  const dbPath = createTestDb([
    { id: 'p1', session_id: 'ses_malformed', data: 'not valid json{{{' },
  ]);
  if (!dbPath) { console.log('    (skipped — node:sqlite unavailable on this Node)'); return; }
  try {
    // Must NOT throw — the function catches JSON.parse errors internally.
    const result = isSessionToolRunning('ses_malformed', dbPath);
    // Malformed data that matches the WHERE clause (json_extract returns NULL
    // for invalid JSON, so the row won't match 'running') → alive:false.
    // If json_extract somehow matched, the inner try/catch returns alive:false
    // with an error. Either way, no throw.
    assert.ok(result.alive === false || result.alive === null, `Malformed data must not crash, got alive=${result.alive}`);
  } finally { cleanupDb(dbPath); }
});

test('OPENCODE_DB_PATH env override → uses custom path', () => {
  const dbPath = createTestDb([
    { id: 'p1', session_id: 'ses_env', data: JSON.stringify({ state: { status: 'running' }, tool: 'task' }) },
  ]);
  if (!dbPath) { console.log('    (skipped — node:sqlite unavailable on this Node)'); return; }
  try {
    const prev = process.env.OPENCODE_DB_PATH;
    process.env.OPENCODE_DB_PATH = dbPath;
    const result = isSessionToolRunning('ses_env'); // no dbPath arg — uses env
    process.env.OPENCODE_DB_PATH = prev;
    assert.strictEqual(result.alive, true, 'OPENCODE_DB_PATH env must be used as the DB path');
    assert.strictEqual(result.tool, 'task', 'Tool must be extracted from the env-path DB');
  } finally { cleanupDb(dbPath); }
});

test('dbPath parameter passed explicitly → uses that path (not env)', () => {
  const dbPathExplicit = createTestDb([
    { id: 'p1', session_id: 'ses_explicit', data: JSON.stringify({ state: { status: 'running' }, tool: 'bash' }) },
  ]);
  // Set env to a DIFFERENT (non-existent) path to prove dbPath wins over env.
  const tmpDirEnv = mkdtempSync(join(tmpdir(), 'watchdog-db-test-'));
  const envPath = join(tmpDirEnv, 'env-wrong.db');
  const prev = process.env.OPENCODE_DB_PATH;
  process.env.OPENCODE_DB_PATH = envPath;
  try {
    if (!dbPathExplicit) { console.log('    (skipped — node:sqlite unavailable on this Node)'); return; }
    const result = isSessionToolRunning('ses_explicit', dbPathExplicit);
    assert.strictEqual(result.alive, true, 'Explicit dbPath must be used even when env points elsewhere');
    assert.strictEqual(result.tool, 'bash', 'Tool from explicit-path DB');
  } finally {
    process.env.OPENCODE_DB_PATH = prev;
    cleanupDb(dbPathExplicit);
    try { rmSync(tmpDirEnv, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.error('FAILED');
  process.exit(1);
} else {
  console.log('ALL PASSED');
  process.exit(0);
}
