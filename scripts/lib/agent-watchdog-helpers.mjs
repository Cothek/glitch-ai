// agent-watchdog-helpers.mjs — Pure helpers extracted from the agent-watchdog
// plugin so the plugin file has EXACTLY ONE named export (AgentWatchdogPlugin).
// opencode's plugin loader crashes silently if a plugin file has more than one
// named export (see b0aaef8 — the stuck-detector fix for the same crash class).
//
// These functions are imported by:
//   - .opencode/plugins/agent-watchdog.mjs (the plugin)
//   - scripts/test-agent-watchdog.mjs (the verification harness)

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getSqliteDriver, openDatabase } from './sqlite-driver.mjs';

// SQLite access is runtime-adaptive (see sqlite-driver.mjs): opencode's
// embedded runtime is Bun (bun:sqlite), system Node has node:sqlite. If
// NEITHER is available, auto-abort degrades to signal-only mode (liveness
// checks always return alive:null → fail-closed on abort). In practice this
// never fires — one of the two drivers is always present.
if (!getSqliteDriver()) {
  console.warn('[agent-watchdog] no SQLite driver (bun:sqlite/node:sqlite) — auto-abort disabled, signal-only mode');
}

/**
 * Locate the opencode SQLite DB. Mirrors abort-agent.mjs's DEFAULT_DB.
 * Allows override via OPENCODE_DB_PATH env var (used by tests).
 */
function defaultDbPath() {
  if (process.env.OPENCODE_DB_PATH) return process.env.OPENCODE_DB_PATH;
  return join(homedir(), '.local', 'share', 'opencode', 'opencode.db');
}

/**
 * Check whether a session still has a tool in the "running" state by querying
 * the opencode SQLite DB directly. Reuses the exact query pattern from
 * abort-agent.mjs's verifyStopped(): SELECT from part WHERE session_id = ? AND
 * json_extract(data, '$.state.status') = 'running'.
 *
 * This is the liveness signal for the watchdog: if the DB shows no running
 * parts for a session, the session is either dead (aborted externally, user
 * cancel, escape key) or the tool already completed — either way the watchdog
 * must NOT signal or abort it (false-positive prevention).
 *
 * Returns:
 *   { alive: true }  — session has a running tool part (genuinely active)
 *   { alive: false } — no running parts (dead or completed)
 *   { alive: null, error: string } — DB check unreliable (DB busy/missing/schema
 *     change). Caller must treat null as "do NOT abort" (fail-closed on abort)
 *     but MAY write a signal for visibility.
 *
 * @param sessionID - the session to check
 * @param dbPath - optional DB path override (used by tests)
 */
export function isSessionToolRunning(sessionID, dbPath) {
  if (!getSqliteDriver()) {
    return { alive: null, error: 'no SQLite driver (bun:sqlite/node:sqlite unavailable)' };
  }
  const path = dbPath || defaultDbPath();
  let db;
  try {
    db = openDatabase(path, { readonly: true });
  } catch (e) {
    return { alive: null, error: `DB open failed: ${e.message}` };
  }
  try {
    const row = db.prepare(
      `SELECT data FROM part WHERE session_id = ? AND json_extract(data, '$.state.status') = 'running' ORDER BY time_updated DESC LIMIT 1`
    ).get(sessionID);
    db.close();
    if (!row) return { alive: false };
    try {
      const d = JSON.parse(row.data);
      if (d?.state?.status === 'running') return { alive: true, tool: d.tool ?? 'unknown' };
      return { alive: false };
    } catch (e) {
      // Malformed part data — can't confirm liveness, treat as not-alive
      // (safer than aborting based on corrupt data).
      return { alive: false, error: `Malformed part data: ${e.message}` };
    }
  } catch (e) {
    try { db.close(); } catch { /* best-effort */ }
    return { alive: null, error: e.message };
  }
}

/**
 * Parse a threshold (ms) from an env var with a default fallback.
 * Logs a warning if the env var is set but parses to NaN.
 */
export function parseThreshold(envVar, defaultMs) {
  const raw = process.env[envVar];
  if (!raw) return defaultMs;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    console.warn(`[agent-watchdog] ${envVar}="${raw}" is not a valid integer — falling back to ${defaultMs}ms`);
    return defaultMs;
  }
  return parsed;
}

/**
 * Check whether a signal file is fresh (within ttlMs of detectedAt).
 * detectedAt may be an ISO string or epoch-ms number (schema-unified).
 */
export function isSignalFresh(signalPath, ttlMs) {
  try {
    const raw = readFileSync(signalPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const detectedAt = typeof parsed.detectedAt === 'number'
      ? parsed.detectedAt
      : new Date(parsed.detectedAt).getTime();
    if (isNaN(detectedAt)) return false;
    return (Date.now() - detectedAt) <= ttlMs;
  } catch {
    return false;
  }
}

/**
 * Decide whether the transform hook should inject a directive for a signal
 * into the current session's message stream.
 *
 * Rules:
 *   - Only PARENT sessions (those that have dispatched task tools) receive
 *     directives. Sub-agents have task:deny and cannot re-dispatch — injecting
 *     would loop or waste tokens (same class as PM-028 mulahazah loop).
 *   - If the parent has recorded children, only inject signals for those
 *     children. If no children are recorded (child tracking may fail because
 *     the task tool output shape doesn't reliably expose the child sessionID),
 *     fall back to injecting for any fresh signal — the parent is the one that
 *     dispatches sub-agents, so any idle signal is likely relevant to it.
 *
 * @param currentSessionID - the session whose message stream is being transformed
 * @param signalSessionID - the session that was detected idle/aborted
 * @param parentSessions - Set of sessionIDs that have called the task tool
 * @param childrenByParent - Map<parentSessionID, Set<childSessionID>>
 */
export function shouldInjectForSession(currentSessionID, signalSessionID, parentSessions, childrenByParent) {
  if (!currentSessionID || !signalSessionID) return false;
  // Only parent sessions receive directives.
  if (!parentSessions.has(currentSessionID)) return false;
  // If we have recorded children for this parent, only inject for those children.
  const children = childrenByParent.get(currentSessionID);
  if (children && children.size > 0) {
    if (!children.has(signalSessionID)) return false;
  }
  // No recorded children — fall back to injecting for any signal. The parent
  // is the only session type that dispatches sub-agents, so any idle signal
  // is likely for a child it dispatched (child tracking is best-effort).
  return true;
}
