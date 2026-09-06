#!/usr/bin/env node
// watchdog-external.mjs — External watchdog for sub-agent bash hangs.
//
// WHY THIS EXISTS:
//   The in-process watchdog (.opencode/plugins/agent-watchdog.mjs) lives INSIDE
//   the opencode process. When a sub-agent's bash tool hangs, opencode's Go
//   runtime blocks awaiting child exit + stdio EOF, which blocks the Bun event
//   loop. The in-process watchdog's setInterval poller never fires.
//
//   This external watchdog runs as a SEPARATE process, independent of opencode's
//   event loop. It polls the opencode SQLite DB for wedged bash sessions, finds
//   the hung OS process tree, and kills it — all from outside the blocked process.
//
// Usage:
//   node scripts/watchdog-external.mjs
//   Or launch via: scripts/start-detached.ps1 -Command "node scripts/watchdog-external.mjs" -Name "watchdog-external"
//
// Config (env vars with defaults):
//   OPENCODE_DB_PATH              — path to opencode.db
//   OPENCODE_PID_FILE             — path to opencode.pid file
//   AGENT_EXTERNAL_BASH_THRESHOLD_MS — how long a bash can run before it's wedged (default 900000 = 15 min)
//   POLL_INTERVAL_MS              — how often to poll (default 30000 = 30s)

import { readFileSync, existsSync, appendFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

// --- Resolve repo root from this script's location ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

// --- Config (env vars with defaults) ---
const OPENCODE_DB_PATH = process.env.OPENCODE_DB_PATH
  || join(homedir(), '.local', 'share', 'opencode', 'opencode.db');
const OPENCODE_PID_FILE = process.env.OPENCODE_PID_FILE
  || join(REPO_ROOT, 'data', 'opencode.pid');
const THRESHOLD_MS = parseInt(process.env.AGENT_EXTERNAL_BASH_THRESHOLD_MS || '900000', 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '30000', 10);
const ABORT_SCRIPT = join(REPO_ROOT, 'scripts', 'abort-agent.mjs');
const LOG_DIR = join(REPO_ROOT, 'data', 'logs');
const LOG_FILE = join(LOG_DIR, 'watchdog-external.log');

// --- Portable Node resolution (opencode.exe hangs on .mjs args) ---
function getNodeExecutable() {
  const candidates = [
    join(REPO_ROOT, 'data', 'node', 'node.exe'),
    join(REPO_ROOT, 'data', 'node', 'bin', 'node'),
  ];
  for (const p of candidates) {
    try { if (existsSync(p)) return p; } catch {}
  }
  return 'node';
}

// --- Logging ---
function ensureLogDir() {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  } catch {}
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    ensureLogDir();
    appendFileSync(LOG_FILE, line + '\n', 'utf-8');
  } catch {}
}

// --- SQLite driver (runtime-adaptive: bun:sqlite or node:sqlite) ---
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let openDatabase;
try {
  const { Database } = require('bun:sqlite');
  openDatabase = (path) => new Database(path, { readonly: true });
} catch {
  try {
    const { DatabaseSync } = require('node:sqlite');
    openDatabase = (path) => new DatabaseSync(path, { readonly: true });
  } catch {
    openDatabase = null;
  }
}

// ============================================================
// PURE LOGIC (exported for testing)
// ============================================================

/**
 * Parse a running bash part's JSON data.
 * @param {string} data - the raw JSON string from the `part.data` column
 * @param {string} sessionID - the session_id from the DB row
 * @returns {{ sessionID: string, command: string, startTime: number } | null}
 */
export function parseBashPart(data, sessionID) {
  try {
    const parsed = JSON.parse(data);
    if (parsed.tool !== 'bash') return null;
    if (parsed.state?.status !== 'running') return null;
    const startTime = parsed.state?.time?.start;
    if (typeof startTime !== 'number' || startTime <= 0) return null;
    const command = parsed.state?.input?.command || '';
    return { sessionID, command, startTime };
  } catch {
    return null;
  }
}

/**
 * Check if a parsed bash part is wedged (running longer than threshold).
 * @param {{ sessionID: string, command: string, startTime: number }} part
 * @param {number} now - current epoch ms
 * @param {number} thresholdMs
 * @returns {boolean}
 */
export function isWedged(part, now, thresholdMs) {
  return (now - part.startTime) > thresholdMs;
}

/**
 * Build a map of parent→children from process list.
 * @param {{ pid: number, ppid: number }[]} processes
 * @returns {Map<number, number[]>} parentPid → childPids
 */
export function buildParentMap(processes) {
  const map = new Map();
  for (const p of processes) {
    if (!map.has(p.ppid)) map.set(p.ppid, []);
    map.get(p.ppid).push(p.pid);
  }
  return map;
}

/**
 * Collect all descendant PIDs of rootPid (recursive DFS).
 * @param {Map<number, number[]>} parentMap
 * @param {number} rootPid
 * @returns {number[]}
 */
export function buildDescendants(parentMap, rootPid) {
  const result = [];
  const stack = [rootPid];
  const visited = new Set();
  while (stack.length > 0) {
    const pid = stack.pop();
    if (visited.has(pid)) continue;
    visited.add(pid);
    const children = parentMap.get(pid) || [];
    for (const child of children) {
      result.push(child);
      stack.push(child);
    }
  }
  return result;
}

/**
 * Given a list of OS processes and a wedged bash command, find the hung process.
 * Strategy: among descendants of the opencode PID, find one whose CommandLine
 * contains a distinctive token from the wedged command. Prefer shell/interpreter
 * processes (powershell, node, python, etc.).
 *
 * @param {{ pid: number, ppid: number, name: string, commandLine: string }[]} processes
 * @param {string} command - the bash command from the wedged session
 * @param {number[]} descendantPids - PIDs that are descendants of opencode
 * @returns {{ pid: number, name: string, commandLine: string } | null}
 */
export function findHungProcess(processes, command, descendantPids) {
  if (!command || descendantPids.length === 0) return null;

  const descSet = new Set(descendantPids);

  // Extract meaningful tokens from the command (skip very short and pure-flag tokens)
  const tokens = command
    .replace(/[\\/]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !t.startsWith('-'))
    .map(t => t.toLowerCase());

  if (tokens.length === 0) return null;

  // Shell/interpreter process names that are likely the direct child
  const SHELL_NAMES = new Set(['powershell.exe', 'cmd.exe', 'node.exe', 'python.exe', 'python3.exe', 'pwsh.exe', 'bash.exe', 'sh.exe']);

  let bestMatch = null;
  let bestScore = -1;

  for (const proc of processes) {
    if (!descSet.has(proc.pid)) continue;

    const cmdLower = (proc.commandLine || '').toLowerCase();
    const nameLower = (proc.name || '').toLowerCase();

    let score = 0;
    for (const token of tokens) {
      if (cmdLower.includes(token)) score += 10;
      if (nameLower.includes(token)) score += 5;
    }

    // Prefer shell/interpreter processes (they're the direct child of opencode)
    // Only apply shell bonus when there's at least one token match — a shell
    // process with zero token matches is not a real match.
    if (score > 0 && SHELL_NAMES.has(nameLower)) score += 3;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = proc;
    }
  }

  // Require at least one token match to avoid false positives
  return bestScore > 0 ? bestMatch : null;
}

// ============================================================
// OS PROCESS ENUMERATION
// ============================================================

/**
 * Enumerate all running processes on Windows via PowerShell Get-CimInstance.
 * Returns Array<{ pid: number, ppid: number, name: string, commandLine: string }>
 */
function enumerateProcesses() {
  return new Promise((resolve) => {
    // Get-CimInstance Win32_Process is reliable and fast on Windows
    const psArgs = [
      '-NoProfile', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'
    ];
    execFile('powershell.exe', psArgs, {
      encoding: 'utf-8',
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    }, (err, stdout) => {
      if (err) {
        log(`WARN: Process enumeration failed: ${err.message}`);
        resolve([]);
        return;
      }
      try {
        const raw = JSON.parse(stdout);
        // Get-CimInstance returns a single object (not array) when only 1 process matches
        const arr = Array.isArray(raw) ? raw : [raw];
        const processes = arr
          .filter(p => p && typeof p.ProcessId === 'number')
          .map(p => ({
            pid: p.ProcessId,
            ppid: p.ParentProcessId || 0,
            name: p.Name || '',
            commandLine: p.CommandLine || '',
          }));
        resolve(processes);
      } catch (e) {
        log(`WARN: Failed to parse process list: ${e.message}`);
        resolve([]);
      }
    });
  });
}

// ============================================================
// PROCESS KILL + SESSION ABORT
// ============================================================

// Cooldown: prevent re-aborting the same session within ABORT_COOLDOWN_MS.
// Without this, stale DB entries would cause the watchdog to abort the same
// dead session every 30 seconds forever.
const ABORT_COOLDOWN_MS = 30 * 60 * 1000; // 30 min
const abortedSessions = new Map(); // sessionID → last abort timestamp

function isInCooldown(sessionID) {
  const lastAbort = abortedSessions.get(sessionID);
  if (!lastAbort) return false;
  if (Date.now() - lastAbort > ABORT_COOLDOWN_MS) {
    abortedSessions.delete(sessionID);
    return false;
  }
  return true;
}

function recordAbort(sessionID) {
  abortedSessions.set(sessionID, Date.now());
}

function taskkillPid(pid) {
  return new Promise((resolve) => {
    execFile('taskkill', ['/T', '/F', '/PID', String(pid)], {
      encoding: 'utf-8',
      timeout: 10000,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, error: (stderr && stderr.trim()) || err.message });
      else resolve({ ok: true, stdout: (stdout || '').trim() });
    });
  });
}

function abortSession(sessionID) {
  const nodeBin = getNodeExecutable();
  if (!existsSync(ABORT_SCRIPT)) {
    log(`WARN: abort-agent.mjs not found at ${ABORT_SCRIPT}`);
    return Promise.resolve({ ok: false, error: 'abort-agent.mjs not found' });
  }
  return new Promise((resolve) => {
    execFile(nodeBin, [ABORT_SCRIPT, sessionID], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: 30000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr || stdout || err.message || '').trim();
        resolve({ ok: false, error: detail });
      } else {
        resolve({ ok: true, stdout: (stdout || '').trim() });
      }
    });
  });
}

// ============================================================
// POLL LOOP
// ============================================================

async function pollOnce() {
  // Step 1: Check opencode is running
  if (!existsSync(OPENCODE_PID_FILE)) {
    log('SKIP: opencode.pid not found — opencode not running');
    return;
  }
  const opencodePid = parseInt(readFileSync(OPENCODE_PID_FILE, 'utf-8').trim(), 10);
  if (isNaN(opencodePid) || opencodePid <= 0) {
    log('SKIP: opencode.pid contains invalid PID');
    return;
  }

  // Step 2: Check DB exists
  if (!existsSync(OPENCODE_DB_PATH)) {
    log('SKIP: opencode.db not found');
    return;
  }

  if (!openDatabase) {
    log('SKIP: no SQLite driver available (neither bun:sqlite nor node:sqlite)');
    return;
  }

  // Step 3: Query for running bash parts
  let db;
  let rows;
  try {
    db = openDatabase(OPENCODE_DB_PATH);
    const stmt = db.prepare(
      `SELECT session_id, data FROM part WHERE json_extract(data, '$.state.status') = 'running' AND json_extract(data, '$.tool') = 'bash'`
    );
    rows = stmt.all();
    db.close();
  } catch (e) {
    log(`WARN: DB query failed: ${e.message}`);
    if (db) { try { db.close(); } catch {} }
    return;
  }

  if (!rows || rows.length === 0) return;

  // Step 4: Find wedged parts
  const now = Date.now();
  const wedged = [];
  for (const row of rows) {
    const parsed = parseBashPart(row.data, row.session_id);
    if (parsed && isWedged(parsed, now, THRESHOLD_MS)) {
      wedged.push(parsed);
    }
  }

  if (wedged.length === 0) return;

  log(`Found ${wedged.length} wedged bash session(s) — enumerating processes...`);

  // Step 5: Enumerate processes ONCE for all wedged sessions
  const processes = await enumerateProcesses();
  const parentMap = buildParentMap(processes);
  const descendantPids = buildDescendants(parentMap, opencodePid);

  log(`Opencode PID ${opencodePid} has ${descendantPids.length} descendant(s) across ${processes.length} total processes`);

  // Step 6: For each wedged session, kill the hung process and abort the session
  for (const part of wedged) {
    // Skip sessions we've already aborted recently (cooldown)
    if (isInCooldown(part.sessionID)) continue;

    const elapsed = Math.round((now - part.startTime) / 1000);
    log(`WEDGED: session=${part.sessionID} command="${part.command.slice(0, 120)}" running=${elapsed}s (threshold=${THRESHOLD_MS / 1000}s)`);

    const hung = findHungProcess(processes, part.command, descendantPids);

    if (hung) {
      log(`MATCHED process: PID=${hung.pid} name="${hung.name}" cmd="${(hung.commandLine || '').slice(0, 150)}"`);
      log(`Killing PID ${hung.pid} (taskkill /T /F)...`);
      const killResult = await taskkillPid(hung.pid);
      if (killResult.ok) {
        log(`Process ${hung.pid} killed successfully`);
      } else {
        log(`Kill failed: ${killResult.error}`);
      }
      // Also call abort-agent to clean up the session via API
      log(`Aborting session ${part.sessionID} via abort-agent.mjs (process ${hung.pid} already killed)...`);
      const abortResult = await abortSession(part.sessionID);
      if (abortResult.ok) {
        log(`Session ${part.sessionID} aborted`);
        recordAbort(part.sessionID);
      } else {
        log(`Abort failed: ${abortResult.error}`);
        recordAbort(part.sessionID); // cooldown even on failure to avoid spam
      }
    } else {
      log(`No matching process found for command "${part.command.slice(0, 120)}" — aborting session only`);
      const abortResult = await abortSession(part.sessionID);
      if (abortResult.ok) {
        log(`Session ${part.sessionID} aborted (no process match)`);
        recordAbort(part.sessionID);
      } else {
        log(`Abort failed: ${abortResult.error}`);
        recordAbort(part.sessionID); // cooldown even on failure to avoid spam
      }
    }
  }
}

// ============================================================
// MAIN (only runs when executed directly, not when imported by tests)
// ============================================================

async function main() {
  ensureLogDir();
  log('watchdog-external started');
  log(`  DB: ${OPENCODE_DB_PATH}`);
  log(`  PID file: ${OPENCODE_PID_FILE}`);
  log(`  Threshold: ${THRESHOLD_MS}ms (${THRESHOLD_MS / 1000}s)`);
  log(`  Poll interval: ${POLL_INTERVAL_MS}ms (${POLL_INTERVAL_MS / 1000}s)`);

  // Run the first poll immediately, then on interval
  while (true) {
    try {
      await pollOnce();
    } catch (e) {
      log(`ERROR: Poll failed unexpectedly: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

// Only run main when executed directly (not when imported for tests)
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('watchdog-external.mjs') ||
  process.argv[1].endsWith('watchdog-external.js')
);
if (isDirectRun) {
  main().catch(e => {
    log(`FATAL: ${e.message}`);
    process.exit(1);
  });
}
