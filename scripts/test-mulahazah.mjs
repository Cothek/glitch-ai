// test-mulahazah.mjs — Verification harness for the mulahazah memory-trigger
// helpers (scripts/lib/mulahazah-helpers.mjs).
//
// Tests:
//   1. Heartbeat trigger — fires at >= 30 min elapsed with >= 1 tool call;
//      does NOT fire under 30 min, or at >= 30 min with 0 tool calls (idle guard).
//   2. Token burst trigger — fires at >= 1M new tokens since last write;
//      does NOT fire below the threshold, with no baseline, or with no delta.
//   3. Session entry + normalization — defaults, field preservation, bad input.
//   4. Formatting helpers — formatTokens, formatDuration, formatToolCounts.
//   5. Omni detection — glitch-omni flag-capable, sub-agents not.
//   6. DB helpers — resolveDbPath honors OPENCODE_DB_PATH; readSessionTokens /
//      readSessionAgent return real rows from a temp SQLite DB.
//
// Run: node scripts/test-mulahazah.mjs
// (or: data\node\node.exe scripts/test-mulahazah.mjs)

import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  HEARTBEAT_INTERVAL_MS,
  TOKEN_THRESHOLD,
  createSessionEntry,
  normalizeEntry,
  formatTokens,
  formatDuration,
  formatToolCounts,
  evaluateTrigger,
  resolveDbPath,
  readSessionTokens,
  readSessionAgent,
  isOmniSession,
  closeTokenDb,
} from "../scripts/lib/mulahazah-helpers.mjs";

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
console.log("\n1. Heartbeat trigger (interval from last write):");
// ============================================================

test("fires at exactly the interval elapsed with >= 1 tool call", () => {
  const ss = createSessionEntry(1_000_000);
  ss.toolCallCount = 5;
  const hit = evaluateTrigger(ss, 1_000_000 + HEARTBEAT_INTERVAL_MS, null);
  assert.ok(hit, "expected heartbeat to fire at the interval");
  assert.match(hit.reason, /heartbeat/);
  assert.ok(hit.elapsed >= HEARTBEAT_INTERVAL_MS);
});

test("does NOT fire under the interval", () => {
  const ss = createSessionEntry(1_000_000);
  ss.toolCallCount = 5;
  const hit = evaluateTrigger(ss, 1_000_000 + HEARTBEAT_INTERVAL_MS - 1, null);
  assert.strictEqual(hit, null, "1ms under the interval must not fire");
});

test("does NOT fire at >= the interval with 0 tool calls (idle guard)", () => {
  const ss = createSessionEntry(1_000_000);
  ss.toolCallCount = 0;
  const hit = evaluateTrigger(ss, 1_000_000 + HEARTBEAT_INTERVAL_MS * 2, null);
  assert.strictEqual(hit, null, "idle session with no calls must not fire");
});

test("measures from lastTriggerTime, not sessionStartTime, after a write", () => {
  const t0 = 1_000_000;
  const ss = createSessionEntry(t0); // session start t0
  ss.lastTriggerTime = t0 + 5 * 60_000; // write at t0+5min
  ss.toolCallCount = 3;
  // SessionStart anchor (t0 + interval) would have fired long ago — the
  // lastTrigger anchor is what matters.
  assert.ok(
    ss.lastTriggerTime + HEARTBEAT_INTERVAL_MS > t0 + HEARTBEAT_INTERVAL_MS,
    "lastTrigger anchor must be later than sessionStart anchor"
  );
  const under = evaluateTrigger(ss, ss.lastTriggerTime + HEARTBEAT_INTERVAL_MS - 60_000, null);
  assert.strictEqual(under, null, "just under the interval since last write — must not fire");
  const at = evaluateTrigger(ss, ss.lastTriggerTime + HEARTBEAT_INTERVAL_MS, null);
  assert.ok(at, "at the interval since last write — must fire");
});

// ============================================================
console.log("\n2. Token burst trigger (1M new tokens since last write):");
// ============================================================

test("fires at exactly TOKEN_THRESHOLD delta", () => {
  const ss = createSessionEntry(1_000_000);
  ss.lastTokenBaseline = { input: 1000, output: 1000, reasoning: 0, total: 2000 };
  const tokens = { input: 501_000, output: 501_000, reasoning: 0, total: 1_002_000 };
  const hit = evaluateTrigger(ss, Date.now(), tokens);
  assert.ok(hit, "expected token burst to fire at exactly 1M delta");
  assert.match(hit.reason, /token burst/);
});

test("does NOT fire below TOKEN_THRESHOLD delta", () => {
  const ss = createSessionEntry(1_000_000);
  ss.lastTokenBaseline = { input: 1000, output: 1000, reasoning: 0, total: 2000 };
  const tokens = { input: 400_000, output: 400_000, reasoning: 0, total: 800_000 };
  const hit = evaluateTrigger(ss, Date.now(), tokens);
  assert.strictEqual(hit, null, "800K delta must not fire at 1M threshold");
});

test("does NOT fire when tokens has no delta or negative delta", () => {
  const ss = createSessionEntry(1_000_000);
  ss.lastTokenBaseline = { input: 1000, output: 1000, reasoning: 0, total: 2000 };
  const noDelta = evaluateTrigger(ss, Date.now(), { ...ss.lastTokenBaseline });
  assert.strictEqual(noDelta, null, "no delta must not fire");
  const less = evaluateTrigger(ss, Date.now(), { input: 500, output: 500, reasoning: 0, total: 1000 });
  assert.strictEqual(less, null, "negative delta must not fire");
});

test("does NOT fire when baseline is null (init window, handled by caller)", () => {
  const ss = createSessionEntry(1_000_000);
  ss.lastTokenBaseline = null;
  const tokens = { input: 2_000_000, output: 100_000, reasoning: 0, total: 2_100_000 };
  const hit = evaluateTrigger(ss, Date.now(), tokens);
  assert.strictEqual(hit, null, "no baseline means we cannot compute delta yet");
});

test("token burst fires under the heartbeat window (burst detector)", () => {
  const ss = createSessionEntry(1_000_000);
  ss.lastTokenBaseline = { input: 0, output: 0, reasoning: 0, total: 0 };
  const tokens = { input: 600_000, output: 400_000, reasoning: 50_000, total: 1_050_000 };
  const hit = evaluateTrigger(ss, 1_000_000 + 5 * 60_000, tokens); // only 5 min in
  assert.ok(hit, "1M tokens in 5 min must fire even though heartbeat window is open");
});

// ============================================================
console.log("\n3. Session entry + normalization:");
// ============================================================

test("createSessionEntry has all fields with defaults", () => {
  const e = createSessionEntry(1234);
  assert.strictEqual(e.toolCallCount, 0);
  assert.deepStrictEqual(e.toolCounts, {});
  assert.strictEqual(e.lastTriggerTime, null);
  assert.strictEqual(e.sessionStartTime, 1234);
  assert.strictEqual(e.isDispatcher, false);
  assert.strictEqual(e.agent, null);
  assert.strictEqual(e.lastTokenBaseline, null);
  assert.strictEqual(e.lastTokenReadTime, null);
});

test("normalizeEntry preserves persisted fields", () => {
  const raw = {
    toolCallCount: 12,
    toolCounts: { bash: 10, read: 2 },
    lastTriggerTime: 5_000,
    sessionStartTime: 1_000,
    isDispatcher: true,
    agent: "glitch-omni",
    lastTokenBaseline: { input: 10, output: 20, reasoning: 0, total: 30 },
    lastTokenReadTime: 4_000,
  };
  const e = normalizeEntry(raw, 9_999);
  assert.strictEqual(e.toolCallCount, 12);
  assert.strictEqual(e.toolCounts.bash, 10);
  assert.strictEqual(e.lastTriggerTime, 5_000);
  assert.strictEqual(e.sessionStartTime, 1_000);
  assert.strictEqual(e.isDispatcher, true);
  assert.strictEqual(e.agent, "glitch-omni");
  assert.strictEqual(e.lastTokenBaseline.total, 30);
  assert.strictEqual(e.lastTokenReadTime, 4_000);
});

test("normalizeEntry defaults missing/new fields and rejects bad input", () => {
  const e = normalizeEntry({ toolCallCount: 7 }, 9_999);
  assert.strictEqual(e.isDispatcher, false);
  assert.strictEqual(e.agent, null);
  assert.strictEqual(e.lastTokenBaseline, null);
  assert.strictEqual(e.lastTokenReadTime, null);
  assert.strictEqual(e.sessionStartTime, 9_999);

  const bad = normalizeEntry(null, 9_999);
  assert.strictEqual(bad.toolCallCount, 0);

  const arr = normalizeEntry([1, 2], 9_999);
  assert.strictEqual(arr.isDispatcher, false);
});

// ============================================================
console.log("\n4. Formatting helpers:");
// ============================================================

test("formatTokens", () => {
  assert.strictEqual(formatTokens(1_200_000), "1.2M");
  assert.strictEqual(formatTokens(999_999), "1.0M");
  assert.strictEqual(formatTokens(500_000), "500K");
  assert.strictEqual(formatTokens(1_000), "1K");
  assert.strictEqual(formatTokens(250), "250");
});

test("formatDuration", () => {
  assert.strictEqual(formatDuration(30 * 60_000), "30min");
  assert.strictEqual(formatDuration(90 * 60_000), "1h 30min");
  assert.strictEqual(formatDuration(4 * 3_600_000 + 38 * 60_000), "4h 38min");
  assert.strictEqual(formatDuration(59_000), "0min");
});

test("formatToolCounts sorts by count desc and handles empty", () => {
  assert.strictEqual(formatToolCounts({}), "none");
  assert.strictEqual(formatToolCounts({ bash: 10, read: 2 }), "bash=10, read=2");
});

// ============================================================
console.log("\n5. Omni detection:");
// ============================================================

test("isOmniSession true for glitch-omni, false for sub-agents", () => {
  assert.strictEqual(isOmniSession("glitch-omni"), true);
  assert.strictEqual(isOmniSession("coder"), false);
  assert.strictEqual(isOmniSession("reviewer"), false);
  assert.strictEqual(isOmniSession("memory"), false);
  assert.strictEqual(isOmniSession(null), false);
});

// ============================================================
console.log("\n6. DB helpers (temp SQLite DB):");
// ============================================================

test("resolveDbPath honors OPENCODE_DB_PATH", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "mulahazah-test-"));
  const dbPath = join(tmpDir, "opencode.db");
  writeFileSync(dbPath, "");
  try {
    const prev = process.env.OPENCODE_DB_PATH;
    process.env.OPENCODE_DB_PATH = dbPath;
    try {
      assert.strictEqual(resolveDbPath(), dbPath);
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_DB_PATH;
      else process.env.OPENCODE_DB_PATH = prev;
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("readSessionTokens + readSessionAgent return real rows", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "mulahazah-db-"));
  const dbPath = join(tmpDir, "opencode.db");
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE session (id TEXT PRIMARY KEY, agent TEXT, tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER, cost REAL)"
  );
  db.prepare(
    "INSERT INTO session (id, agent, tokens_input, tokens_output, tokens_reasoning, cost) VALUES (?, ?, ?, ?, ?, ?)"
  ).run("ses_test_abc", "glitch-omni", 1000, 500, 250, 0.42);
  db.close();

  try {
    const prev = process.env.OPENCODE_DB_PATH;
    process.env.OPENCODE_DB_PATH = dbPath;
    try {
      const tokens = readSessionTokens("ses_test_abc");
      assert.ok(tokens, "expected token row");
      assert.strictEqual(tokens.input, 1000);
      assert.strictEqual(tokens.output, 500);
      assert.strictEqual(tokens.reasoning, 250);
      assert.strictEqual(tokens.total, 1750);

      const agent = readSessionAgent("ses_test_abc");
      assert.strictEqual(agent, "glitch-omni");

      const missing = readSessionTokens("ses_nope");
      assert.strictEqual(missing, null, "unknown session returns null");
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_DB_PATH;
      else process.env.OPENCODE_DB_PATH = prev;
      closeTokenDb(); // release the file handle so rmSync can delete on Windows
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
