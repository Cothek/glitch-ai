#!/usr/bin/env node
// agent-watchdog.mjs — detect hung sub-agent sessions by silence in the opencode SQLite DB.
// Read-only: NEVER writes to the DB. Writes signal files to data/.agent-idle.<sessionID>.json.
// Exit 0 always (monitor, not a gate).

import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const DATA_DIR = join(REPO_ROOT, 'data');
const DEFAULT_DB = join(homedir(), '.local', 'share', 'opencode', 'opencode.db');

function parseArgs(argv) {
  const args = { idleThreshold: 300, json: false, db: DEFAULT_DB };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--idle-threshold') args.idleThreshold = parseInt(argv[++i], 10);
    else if (a === '--json') args.json = true;
    else if (a === '--db') args.db = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: agent-watchdog.mjs [--idle-threshold 300] [--json] [--db <path>]');
      process.exit(0);
    }
  }
  if (!Number.isFinite(args.idleThreshold) || args.idleThreshold < 1) {
    console.error('Invalid --idle-threshold');
    process.exit(1);
  }
  return args;
}

function atomicWrite(path, content) {
  const tmp = path + '.tmp';
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, path);
}

function writeSignal(sessionID, info) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const path = join(DATA_DIR, `.agent-idle.${sessionID}.json`);
  atomicWrite(path, JSON.stringify(info, null, 2) + '\n');
}

function detectHung(args) {
  const now = Date.now();
  const twoHoursAgo = now - 2 * 60 * 60 * 1000;
  let db;
  try {
    db = new DatabaseSync(args.db, { readonly: true });
  } catch (e) {
    const msg = `Failed to open DB read-only: ${e.message}`;
    if (args.json) { console.log('[]'); } else { console.error(msg); }
    process.exit(0);
  }

  let candidates;
  try {
    candidates = db.prepare(
      `SELECT id, parent_id, title, agent, time_created
       FROM session
       WHERE parent_id IS NOT NULL AND time_created > ?
       ORDER BY time_created DESC`
    ).all(twoHoursAgo);
  } catch (e) {
    console.error(`Query failed: ${e.message}`);
    db.close();
    if (args.json) console.log('[]');
    process.exit(0);
  }

  const hung = [];
  for (const s of candidates) {
    let lastActivity = null;
    let runningTool = null;
    try {
      const row = db.prepare(
        `SELECT MAX(time_updated) as last_activity FROM part WHERE session_id = ?`
      ).get(s.id);
      lastActivity = row?.last_activity ?? null;
    } catch (e) {
      console.error(`Activity query failed for session ${s.id}: ${e.message}`);
    }

    try {
      // Precise match: json_extract avoids false positives from '%"running"%' substring.
      const r = db.prepare(
        `SELECT data FROM part WHERE session_id = ? AND json_extract(data, '$.state.status') = 'running' ORDER BY time_updated DESC LIMIT 1`
      ).get(s.id);
      if (r?.data) {
        const d = JSON.parse(r.data);
        if (d?.state?.status === 'running') runningTool = d.tool ?? 'unknown';
      }
    } catch (e) {
      // Malformed JSON in part.data — skip but log at debug level for diagnostics.
      console.error(`Running-tool query failed for session ${s.id}: ${e.message}`);
    }

    if (lastActivity == null) continue;
    const idleSeconds = Math.floor((now - lastActivity) / 1000);
    const extremeIdle = idleSeconds > args.idleThreshold * 2;
    const isHung = (runningTool && idleSeconds > args.idleThreshold) || extremeIdle;
    if (!isHung) continue;

    const info = {
      sessionID: s.id,
      agent: s.agent,
      title: s.title,
      idleSeconds,
      lastActivity,
      threshold: args.idleThreshold,
      detectedAt: new Date().toISOString(),
      tool: runningTool,
      recommendation: `Agent idle >${args.idleThreshold}s — aborting and re-dispatching`,
    };
    hung.push(info);
    try { writeSignal(s.id, info); } catch (e) { console.error(`Signal write failed for session ${s.id}: ${e.message}`); }
  }
  db.close();
  return hung;
}

const args = parseArgs(process.argv.slice(2));
const hung = detectHung(args);

if (args.json) {
  console.log(JSON.stringify(hung, null, 2));
} else {
  if (hung.length === 0) {
    console.log('No hung sub-agent sessions detected.');
  } else {
    console.log(`Hung sub-agent sessions (${hung.length}):`);
    for (const h of hung) {
      console.log(`  ${h.sessionID}  agent=${h.agent}  idle=${h.idleSeconds}s  tool=${h.tool ?? 'none'}`);
      console.log(`    title: ${h.title}`);
    }
  }
}
process.exit(0);
