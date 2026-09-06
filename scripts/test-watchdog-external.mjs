#!/usr/bin/env node
// test-watchdog-external.mjs — Test harness for watchdog-external pure logic.
// Run: node scripts/test-watchdog-external.mjs

import {
  parseBashPart,
  isWedged,
  buildParentMap,
  buildDescendants,
  findHungProcess,
} from './watchdog-external.mjs';

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition, label) {
  total++;
  if (condition) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

function assertDeepEqual(a, b, label) {
  total++;
  const eq = JSON.stringify(a) === JSON.stringify(b);
  if (eq) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
    console.error(`    expected: ${JSON.stringify(b)}`);
    console.error(`    actual:   ${JSON.stringify(a)}`);
  }
}

// ============================================================
// parseBashPart
// ============================================================
console.log('--- parseBashPart ---');

const validRunningPart = JSON.stringify({
  type: 'tool',
  callID: 'call_x',
  tool: 'bash',
  state: {
    status: 'running',
    input: { command: 'node server.mjs', timeout: 120000 },
    title: 'Run server',
    metadata: { output: '' },
    time: { start: 1725589200000 },
  },
});

const parsed = parseBashPart(validRunningPart, 'ses_test123');
assert(parsed !== null, 'parses valid running bash part');
assert(parsed?.sessionID === 'ses_test123', 'correct sessionID');
assert(parsed?.command === 'node server.mjs', 'correct command');
assert(parsed?.startTime === 1725589200000, 'correct startTime');

// Non-bash tool
const nonBashPart = JSON.stringify({
  type: 'tool',
  tool: 'webfetch',
  state: { status: 'running', input: { url: 'https://example.com' }, time: { start: 1725589200000 } },
});
assert(parseBashPart(nonBashPart, 'ses_x') === null, 'returns null for non-bash tool');

// Completed bash part
const completedPart = JSON.stringify({
  type: 'tool',
  tool: 'bash',
  state: { status: 'completed', input: { command: 'echo hi' }, time: { start: 1725589200000 } },
});
assert(parseBashPart(completedPart, 'ses_x') === null, 'returns null for completed status');

// Missing time.start
const noTimePart = JSON.stringify({
  type: 'tool',
  tool: 'bash',
  state: { status: 'running', input: { command: 'echo hi' } },
});
assert(parseBashPart(noTimePart, 'ses_x') === null, 'returns null when time.start missing');

// Malformed JSON
assert(parseBashPart('not json', 'ses_x') === null, 'returns null for malformed JSON');

// Empty state
const emptyStatePart = JSON.stringify({
  type: 'tool',
  tool: 'bash',
  state: {},
});
assert(parseBashPart(emptyStatePart, 'ses_x') === null, 'returns null for empty state');

// ============================================================
// isWedged
// ============================================================
console.log('\n--- isWedged ---');

const part = { sessionID: 'ses_x', command: 'node server.mjs', startTime: 1000000 };
const threshold = 900000; // 15 min

assert(isWedged(part, 1000000 + threshold + 1, threshold) === true, 'true when exactly at threshold + 1');
assert(isWedged(part, 1000000 + threshold, threshold) === false, 'false when exactly at threshold');
assert(isWedged(part, 1000000 + 1000, threshold) === false, 'false when only 1s elapsed');
// Edge: start time is very old, threshold is short — always wedged
assert(isWedged(part, 1000000 + threshold * 100, threshold) === true, 'true when start is very old');

// ============================================================
// buildParentMap
// ============================================================
console.log('\n--- buildParentMap ---');

const processes = [
  { pid: 1, ppid: 0, name: 'System', commandLine: '' },
  { pid: 2, ppid: 1, name: 'opencode.exe', commandLine: 'opencode' },
  { pid: 3, ppid: 2, name: 'powershell.exe', commandLine: 'powershell' },
  { pid: 4, ppid: 3, name: 'node.exe', commandLine: 'node server.mjs' },
  { pid: 5, ppid: 3, name: 'cmd.exe', commandLine: 'cmd /c echo hi' },
  { pid: 6, ppid: 2, name: 'another.exe', commandLine: 'another' },
];

const parentMap = buildParentMap(processes);
assert(parentMap.get(0)?.length === 1, 'root has 1 child (pid 1)');
assert(parentMap.get(1)?.length === 1, 'pid 1 has 1 child (pid 2)');
assert(parentMap.get(2)?.length === 2, 'pid 2 has 2 children (pid 3, 6)');
assert(parentMap.get(3)?.length === 2, 'pid 3 has 2 children (pid 4, 5)');

// ============================================================
// buildDescendants
// ============================================================
console.log('\n--- buildDescendants ---');

const desc2 = buildDescendants(parentMap, 2);
assert(desc2.includes(3), 'pid 2 descendant includes pid 3');
assert(desc2.includes(4), 'pid 2 descendant includes pid 4');
assert(desc2.includes(5), 'pid 2 descendant includes pid 5');
assert(desc2.includes(6), 'pid 2 descendant includes pid 6');
assert(desc2.length === 4, 'pid 2 has exactly 4 descendants');

const desc3 = buildDescendants(parentMap, 3);
assert(desc3.includes(4), 'pid 3 descendant includes pid 4');
assert(desc3.includes(5), 'pid 3 descendant includes pid 5');
assert(desc3.length === 2, 'pid 3 has exactly 2 descendants');

// Leaf node
const desc4 = buildDescendants(parentMap, 4);
assert(desc4.length === 0, 'pid 4 (leaf) has 0 descendants');

// Non-existent root
const desc99 = buildDescendants(parentMap, 99);
assert(desc99.length === 0, 'non-existent pid 99 has 0 descendants');

// ============================================================
// findHungProcess
// ============================================================
console.log('\n--- findHungProcess ---');

const osProcesses = [
  { pid: 1, ppid: 0, name: 'System', commandLine: '' },
  { pid: 2, ppid: 1, name: 'opencode.exe', commandLine: 'opencode serve' },
  { pid: 3, ppid: 2, name: 'powershell.exe', commandLine: 'powershell -NoProfile' },
  { pid: 4, ppid: 3, name: 'node.exe', commandLine: 'node server.mjs --port 3000' },
  { pid: 5, ppid: 3, name: 'cmd.exe', commandLine: 'cmd /c echo hi' },
  { pid: 6, ppid: 2, name: 'browser.exe', commandLine: 'browser --url https://example.com' },
];

const descendantPids2 = buildDescendants(buildParentMap(osProcesses), 2);

// Match by command token
const match1 = findHungProcess(osProcesses, 'node server.mjs', descendantPids2);
assert(match1 !== null, 'finds process matching "node server.mjs"');
assert(match1?.pid === 4, 'matches the node.exe process (pid 4)');

// Match by unique token
const match2 = findHungProcess(osProcesses, 'python main.py', descendantPids2);
assert(match2 === null, 'returns null when no process matches "python main.py"');

// Empty command
assert(findHungProcess(osProcesses, '', descendantPids2) === null, 'returns null for empty command');

// Empty descendants
assert(findHungProcess(osProcesses, 'node server.mjs', []) === null, 'returns null for empty descendants');

// Prefers shell process when score is tied (powershell.exe gets +3 for SHELL_NAMES)
const shellProcs = [
  { pid: 10, ppid: 2, name: 'powershell.exe', commandLine: 'powershell -c run-thing' },
  { pid: 11, ppid: 10, name: 'node.exe', commandLine: 'node run-thing.mjs' },
];
const shellMatch = findHungProcess(
  [...osProcesses, ...shellProcs],
  'run-thing',
  [...descendantPids2, 10, 11]
);
// powershell gets +3 for name match + token match, node gets token match + 3 for shell bonus
// The powershell (pid 10) should match because it has "run-thing" in its command line
assert(shellMatch !== null, 'finds process matching "run-thing"');

// ============================================================
// Edge cases: multi-level descendants
// ============================================================
console.log('\n--- Edge cases ---');

const deepProcesses = [
  { pid: 1, ppid: 0, name: 'opencode.exe', commandLine: 'opencode' },
  { pid: 2, ppid: 1, name: 'powershell.exe', commandLine: 'powershell' },
  { pid: 3, ppid: 2, name: 'cmd.exe', commandLine: 'cmd /c stuff' },
  { pid: 4, ppid: 3, name: 'python.exe', commandLine: 'python3 app.py' },
];

const deepMap = buildParentMap(deepProcesses);
const deepDesc = buildDescendants(deepMap, 1);
assert(deepDesc.length === 3, 'deep tree: pid 1 has 3 descendants');
assert(deepDesc.includes(4), 'deep tree: includes deepest descendant pid 4');

const deepMatch = findHungProcess(deepProcesses, 'app.py', deepDesc);
assert(deepMatch !== null, 'deep tree: finds process matching "app.py"');
assert(deepMatch?.pid === 4, 'deep tree: matches the deepest process');

// ============================================================
// Safety: non-descendant rejection
// ============================================================
console.log('\n--- Safety: non-descendant rejection ---');

// Process matches command tokens but is NOT a descendant of opencode
const rogueProcesses = [
  { pid: 1, ppid: 0, name: 'System', commandLine: '' },
  { pid: 100, ppid: 1, name: 'opencode.exe', commandLine: 'opencode serve' },
  { pid: 101, ppid: 100, name: 'powershell.exe', commandLine: 'powershell' },
  { pid: 999, ppid: 1, name: 'node.exe', commandLine: 'node server.mjs' },
];
const descendantPidsRogue = buildDescendants(buildParentMap(rogueProcesses), 100);
// pid 999 is a child of System (ppid 1), NOT a descendant of opencode (pid 100)
assert(descendantPidsRogue.includes(101), 'pid 101 is a descendant of opencode');
assert(!descendantPidsRogue.includes(999), 'pid 999 is NOT a descendant of opencode');

const rogueMatch = findHungProcess(rogueProcesses, 'node server.mjs', descendantPidsRogue);
assert(rogueMatch === null, 'findHungProcess rejects non-descendant even if tokens match');
assert(rogueMatch?.pid !== 999, 'rogue process pid 999 is not returned');

// ============================================================
// Safety: short tokens filtered out
// ============================================================
console.log('\n--- Safety: short token filter ---');

const lsProcesses = [
  { pid: 1, ppid: 0, name: 'System', commandLine: '' },
  { pid: 10, ppid: 1, name: 'ls.exe', commandLine: 'ls' },
  { pid: 11, ppid: 10, name: 'node.exe', commandLine: 'node app.js' },
];
const descLs = buildDescendants(buildParentMap(lsProcesses), 1);

// 'ls' splits to token ['ls'] which is length 2 — filtered out by t.length > 2
const lsMatch = findHungProcess(lsProcesses, 'ls', descLs);
assert(lsMatch === null, 'findHungProcess rejects "ls" (token length <= 2 filtered)');

// Single-char command also filtered
const xMatch = findHungProcess(lsProcesses, 'x', descLs);
assert(xMatch === null, 'findHungProcess rejects single-char command');

// Command that is only flags (all start with '-') should yield 0 tokens
const flagsMatch = findHungProcess(lsProcesses, '-v --port', descLs);
assert(flagsMatch === null, 'findHungProcess rejects flag-only command (all tokens start with -)');

// ============================================================
// Summary
// ============================================================
console.log(`\n========================================`);
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
console.log(`========================================`);

process.exit(failed > 0 ? 1 : 0);
