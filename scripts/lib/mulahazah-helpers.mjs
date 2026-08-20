// mulahazah-helpers.mjs — pure logic + DB helpers for the mulahazah memory-trigger plugin
//
// Extracted from .opencode/plugins/mulahazah.js so the trigger decision logic is
// unit-testable without loading an OpenCode plugin (same pattern as
// agent-watchdog-helpers.mjs). The plugin imports these; tests import these.
//
// TRIGGER MODEL (two independent paths, both measured from the LAST trigger —
// i.e. the last memory write, since the trigger leads directly to the write):
//
//   1. HEARTBEAT (15 min): fires once 15 minutes after the last write IF at
//      least 1 tool call happened since. This is the guaranteed per-session
//      cadence. When a session goes quiet, it fires once at the 15-min mark
//      (capturing the final state = the session-end capture), then stops until
//      new activity. A dead session's flag is swept by the 24h stale reset.
//
//   2. TOKEN BURST (1M new tokens): fires when TOKEN_THRESHOLD new tokens
//      (input + output + reasoning) have accumulated since the last write,
//      even if under the 30-min window. This catches token-heavy bursts (e.g.
//      heavy parallel agent dispatch) so a session that "did a lot" in terms of
//      LLM compute is captured without waiting for the clock. Token totals are
//      read from the OpenCode SQLite DB (session table) — the same data source
//      the TUI/web UI uses to display usage.
//
// Both paths reset lastTriggerTime + lastTokenBaseline in fireTrigger, so they
// never double-fire: whichever comes first restarts the window.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getSqliteDriver, openDatabase } from "./sqlite-driver.mjs";

// SQLite access is runtime-adaptive (see sqlite-driver.mjs): opencode's
// embedded runtime is Bun (bun:sqlite), system Node has node:sqlite. If
// NEITHER is available, token-burst detection is disabled but the heartbeat
// + phrase triggers keep working. In practice this never fires — one of the
// two drivers is always present.
if (!getSqliteDriver()) {
  console.warn("[mulahazah] no SQLite driver (bun:sqlite/node:sqlite) — token-burst detection disabled (heartbeat + phrases still work)");
}

export const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000; // 15 min from last write
export const TIMER_CHECK_MS = 60 * 1000; // background timer cadence (60s)
export const TOKEN_THRESHOLD = 1_000_000; // new tokens (in+out+reasoning) since last write
export const COOLDOWN_MS = 5 * 60 * 1000; // phrase-trigger cooldown
export const STALE_RESET_MS = 24 * 60 * 60 * 1000; // session staleness

export function createSessionEntry(now = Date.now()) {
  return {
    toolCallCount: 0,
    toolCounts: {},
    lastTriggerTime: null,
    sessionStartTime: now,
    // isDispatcher: true only for sessions that can PROCESS a memory-trigger
    // flag. Normal primary sessions (glitch) call task() successfully and are
    // marked on first successful dispatch. glitch-omni sessions never call
    // task() (task: deny) but self-fulfill memory writes per the omni protocol
    // — they are marked flag-capable when the DB agent column reads glitch-omni.
    isDispatcher: false,
    // agent: null = not yet resolved from the DB; string = agent name.
    agent: null,
    // lastTokenBaseline: { input, output, reasoning, total } cumulative session
    // token totals at the last trigger (or first observation). The trigger
    // measures DELTA against this, so an old session with millions of tokens
    // accumulated before the plugin started never fires on its history.
    lastTokenBaseline: null,
    lastTokenReadTime: null,
  };
}

export function normalizeEntry(raw, now = Date.now()) {
  const e = createSessionEntry(now);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return e;
  e.toolCallCount = typeof raw.toolCallCount === "number" ? raw.toolCallCount : 0;
  e.toolCounts = raw.toolCounts && typeof raw.toolCounts === "object" ? raw.toolCounts : {};
  e.lastTriggerTime = typeof raw.lastTriggerTime === "number" ? raw.lastTriggerTime : null;
  e.sessionStartTime = typeof raw.sessionStartTime === "number" ? raw.sessionStartTime : now;
  e.isDispatcher = raw.isDispatcher === true;
  e.agent = typeof raw.agent === "string" ? raw.agent : null;
  e.lastTokenBaseline =
    raw.lastTokenBaseline && typeof raw.lastTokenBaseline === "object"
      ? raw.lastTokenBaseline
      : null;
  e.lastTokenReadTime = typeof raw.lastTokenReadTime === "number" ? raw.lastTokenReadTime : null;
  return e;
}

export function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) {
    const k = Math.round(n / 1_000);
    if (k >= 1000) return `${(n / 1_000_000).toFixed(1)}M`;
    return `${k}K`;
  }
  return String(n);
}

export function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes}min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}min`;
}

export function formatToolCounts(toolCounts) {
  const entries = Object.entries(toolCounts || {});
  if (entries.length === 0) return "none";
  entries.sort((a, b) => b[1] - a[1]);
  return entries.map(([tool, count]) => `${tool}=${count}`).join(", ");
}

/**
 * Pure trigger decision. Returns { reason, elapsed } when a trigger should fire,
 * or null when nothing has crossed a threshold.
 *
 * @param {object} ss        session state (createSessionEntry shape)
 * @param {number} now       epoch ms
 * @param {object|null} tokens session token totals { total, input, output, reasoning } or null
 */
export function evaluateTrigger(ss, now, tokens) {
  const anchor = ss.lastTriggerTime ?? ss.sessionStartTime;
  const elapsed = now - anchor;

  // 1) Heartbeat: 15 min since last write. No tool-call guard — sessions
  //    with zero tool calls still need conversation state recorded after 15 min.
  if (elapsed >= HEARTBEAT_INTERVAL_MS) {
    return {
      reason: `heartbeat: ${formatDuration(elapsed)} since last write, ${ss.toolCallCount} tool calls`,
      elapsed,
    };
  }

  // 2) Token burst: TOKEN_THRESHOLD new tokens since last write.
  if (tokens && ss.lastTokenBaseline && tokens.total > ss.lastTokenBaseline.total) {
    const delta = tokens.total - ss.lastTokenBaseline.total;
    if (delta >= TOKEN_THRESHOLD) {
      return {
        reason: `token burst: ${formatTokens(delta)} new tokens since last write`,
        elapsed,
      };
    }
  }
  return null;
}

// --- OpenCode DB helpers (read-only, fail-safe) -----------------------------

export function resolveDbPath() {
  if (process.env.OPENCODE_DB_PATH && existsSync(process.env.OPENCODE_DB_PATH)) {
    return process.env.OPENCODE_DB_PATH;
  }
  if (process.env.XDG_DATA_HOME) {
    const p = join(process.env.XDG_DATA_HOME, "opencode", "opencode.db");
    if (existsSync(p)) return p;
  }
  const p = join(homedir(), ".local", "share", "opencode", "opencode.db");
  return existsSync(p) ? p : null;
}

let cachedDb = null;
let dbOpenFailed = false;

export function getTokenDb() {
  if (cachedDb) return cachedDb;
  if (dbOpenFailed) return null;
  const path = resolveDbPath();
  if (!path) return null;
  try {
    cachedDb = openDatabase(path, { readonly: true });
    return cachedDb;
  } catch (err) {
    dbOpenFailed = true;
    console.error(`[mulahazah] failed to open opencode DB: ${err.message}`);
    return null;
  }
}

/** Close the cached token DB (test harness / diagnostics). */
export function closeTokenDb() {
  if (cachedDb) {
    try {
      cachedDb.close();
    } catch (err) {
      console.error(`[mulahazah] failed to close token DB: ${err.message}`);
    }
    cachedDb = null;
    dbOpenFailed = false;
  }
}

/** Read cumulative token totals for a session. Returns null on any failure. */
export function readSessionTokens(sessionID) {
  const db = getTokenDb();
  if (!db) return null;
  try {
    const row = db
      .prepare(
        "SELECT tokens_input, tokens_output, tokens_reasoning FROM session WHERE id = ?"
      )
      .get(sessionID);
    if (!row) return null;
    const input = row.tokens_input || 0;
    const output = row.tokens_output || 0;
    const reasoning = row.tokens_reasoning || 0;
    return { input, output, reasoning, total: input + output + reasoning };
  } catch {
    return null; // transient (DB mid-write / locked) — caller retries next tick
  }
}

/** Read the agent name for a session (used to detect glitch-omni). Null on failure. */
export function readSessionAgent(sessionID) {
  const db = getTokenDb();
  if (!db) return null;
  try {
    const row = db.prepare("SELECT agent FROM session WHERE id = ?").get(sessionID);
    return row && typeof row.agent === "string" ? row.agent : null;
  } catch {
    return null;
  }
}

/** Sessions that process memory flags via omni self-fulfillment (task denied). */
export function isOmniSession(agent) {
  return agent === "glitch-omni";
}
