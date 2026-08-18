// test-memory-loop-fix.mjs
//
// Verification harness for the mulahazah + stuck-detector plugin bug fix.
// Drives the two plugin factories with synthetic inputs in a TEMP data dir
// (never touches the real data/ directory) and asserts the expected
// per-session behavior.
//
// Run: node scripts/test-memory-loop-fix.mjs
// Exit: 0 if all assertions pass, 1 if any fail.

import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, statSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Plugin loading
// ---------------------------------------------------------------------------
// package.json has "type": "commonjs", so we cannot `import` the .js plugin
// files directly. Use dynamic import via file URL.
const PLUGIN_DIR = join(process.cwd(), ".opencode", "plugins");
const MULAHAZAH_URL = pathToFileURL(join(PLUGIN_DIR, "mulahazah.js")).href;
const STUCK_URL = pathToFileURL(join(PLUGIN_DIR, "stuck-detector.js")).href;

const { MulahazahPlugin } = await import(MULAHAZAH_URL);
const { StuckDetectorPlugin } = await import(STUCK_URL);

// ---------------------------------------------------------------------------
// Assertion harness
// ---------------------------------------------------------------------------
let passCount = 0;
let failCount = 0;
const failures = [];

function assert(label, condition, detail = "") {
  if (condition) {
    passCount++;
    console.log(`  PASS  ${label}`);
  } else {
    failCount++;
    failures.push({ label, detail });
    console.log(`  FAIL  ${label}${detail ? `  -- ${detail}` : ""}`);
  }
}

function section(name) {
  console.log(`\n=== ${name} ===`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function newTempDir() {
  return mkdtempSync(join(tmpdir(), "loop-fix-test-"));
}

function newSessionID(prefix = "sess") {
  return `${prefix}-${randomUUID()}`;
}

// Drive N tool.execute.after calls. Returns nothing; awaits each call.
async function driveCalls(plugin, sessionID, tool, args, count, { error } = {}) {
  const hook = plugin["tool.execute.after"];
  for (let i = 0; i < count; i++) {
    const input = { tool, sessionID, args };
    const output = error ? { result: "", error: { message: "denied" } } : { result: "ok" };
    await hook(input, output);
  }
}

// Wait for pending background I/O (fire-and-forget appendObservation / saveState)
// to settle before we delete the temp dir. The mulahazah plugin kicks off
// appendObservation() and periodic saveState() without awaiting them, so a
// naive rmSync races with in-flight writes and fails with ENOTEMPTY.
async function settleIO() {
  // Two ticks of the event loop is enough for the chained .then/.catch
  // microtasks inside the plugin to flush their fs writes.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  // Plus a small real-time margin for the actual disk write to complete.
  await new Promise((r) => setTimeout(r, 30));
}

function safeRm(tmp) {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch (err) {
    if (err.code === "ENOTEMPTY") {
      // One more retry after a brief wait — a background write may still be
      // flushing.
      // eslint-disable-next-line no-undef
      return new Promise((resolve) =>
        setTimeout(() => {
          try {
            rmSync(tmp, { recursive: true, force: true });
          } catch {}
          resolve();
        }, 100)
      );
    }
  }
}

// Wrap a test body so cleanup is always safe (awaits pending I/O, then removes
// the temp dir with a retry on ENOTEMPTY).
async function withTempDir(fn) {
  const tmp = newTempDir();
  try {
    await fn(tmp);
  } finally {
    await settleIO();
    await safeRm(tmp);
  }
}

// Build a synthetic messages array for the transform hook.
function makeMessages(sessionID) {
  return [
    {
      info: { sessionID, id: `msg_${randomUUID()}` },
      parts: [],
    },
  ];
}

async function runTransform(plugin, sessionID) {
  const hook = plugin["experimental.chat.messages.transform"];
  const messages = makeMessages(sessionID);
  const output = { messages };
  await hook({}, output);
  return output;
}

// ---------------------------------------------------------------------------
// Test 1: mulahazah — dispatcher session triggers flag at 200 calls
// ---------------------------------------------------------------------------
async function testMulahazahDispatcher() {
  await withTempDir(async (tmp) => {
    section("mulahazah: dispatcher session triggers flag at 200 calls");
    const plugin = await MulahazahPlugin({ directory: tmp });
    const sid = newSessionID("dispatcher");
    const dataDir = join(tmp, "data");
    const flagPath = join(dataDir, `MEMORY_TRIGGER_FLAG.${sid}`);

    // First call: successful task() → marks session as dispatcher
    await plugin["tool.execute.after"](
      { tool: "task", sessionID: sid, args: { prompt: "delegate" } },
      { result: "ok" }
    );

    // Drive 199 more read calls (total 200 including the task call)
    await driveCalls(plugin, sid, "read", { filePath: "/tmp/x" }, 199);

    assert(
      "flag file exists after 200 calls (dispatcher)",
      existsSync(flagPath),
      `expected ${flagPath} to exist`
    );

    if (existsSync(flagPath)) {
      const content = readFileSync(flagPath, "utf8");
      assert(
        "flag content mentions threshold",
        /threshold reached/i.test(content) || /Mulahazah/i.test(content),
        `content was: ${content.slice(0, 120)}`
      );
    }

    // Transform hook should inject a directive (not delete)
    const out = await runTransform(plugin, sid);
    const lastMsg = out.messages[out.messages.length - 1];
    const injected = (lastMsg.parts || []).some(
      (p) => typeof p.text === "string" && p.text.includes("MEMORY TRIGGER PENDING")
    );
    assert(
      "transform injects MEMORY TRIGGER PENDING for dispatcher",
      injected,
      `parts: ${JSON.stringify(lastMsg.parts || []).slice(0, 200)}`
    );

    // Flag should be consumed (still present on disk — transform does not delete it)
    // The plugin's transform hook does NOT delete the flag for dispatcher sessions;
    // it only injects. The flag is deleted by the parent agent after dispatch.
    assert(
      "flag file still present after transform (dispatcher consumes via @memory)",
      existsSync(flagPath)
    );
  });
}

// ---------------------------------------------------------------------------
// Test 2: mulahazah — sub-agent (non-dispatcher) NEVER gets a flag
// ---------------------------------------------------------------------------
async function testMulahazahSubAgent() {
  await withTempDir(async (tmp) => {
    section("mulahazah: sub-agent (non-dispatcher) never gets a flag");
    const plugin = await MulahazahPlugin({ directory: tmp });
    const sid = newSessionID("subagent");
    const dataDir = join(tmp, "data");
    const flagPath = join(dataDir, `MEMORY_TRIGGER_FLAG.${sid}`);

    // Drive 60 read calls — never call task()
    await driveCalls(plugin, sid, "read", { filePath: "/tmp/x" }, 60);

    assert(
      "no flag file after 60 calls (non-dispatcher)",
      !existsSync(flagPath),
      `flag should not exist at ${flagPath}`
    );

    // No crash, no exception — implicit by reaching here.
    assert("plugin did not throw on 60 non-dispatcher calls", true);
  });
}

// ---------------------------------------------------------------------------
// Test 3: mulahazah — transform deletes stale flag for non-dispatcher
// ---------------------------------------------------------------------------
async function testMulahazahTransformDeletesStaleFlag() {
  await withTempDir(async (tmp) => {
    section("mulahazah: transform deletes stale flag for non-dispatcher session");
    const plugin = await MulahazahPlugin({ directory: tmp });
    const sid = newSessionID("stale");
    const dataDir = join(tmp, "data");
    const flagPath = join(dataDir, `MEMORY_TRIGGER_FLAG.${sid}`);

    // Manually create a stale flag (simulating a flag left from before the fix)
    writeFileSync(flagPath, "stale flag from old session\n", "utf8");
    assert("precondition: stale flag exists", existsSync(flagPath));

    // Call transform — session is unknown to the in-memory map (never called
    // tool.execute.after), so it counts as non-dispatcher → flag must be deleted.
    const out = await runTransform(plugin, sid);
    const lastMsg = out.messages[out.messages.length - 1];

    assert(
      "stale flag deleted by transform for non-dispatcher",
      !existsSync(flagPath),
      `flag should be deleted at ${flagPath}`
    );

    const injected = (lastMsg.parts || []).some(
      (p) => typeof p.text === "string" && p.text.includes("MEMORY TRIGGER PENDING")
    );
    assert(
      "no MEMORY TRIGGER PENDING injected for non-dispatcher",
      !injected,
      `parts: ${JSON.stringify(lastMsg.parts || []).slice(0, 200)}`
    );
  });
}

// ---------------------------------------------------------------------------
// Test 4: mulahazah — startup sweep deletes orphaned flags
// ---------------------------------------------------------------------------
async function testMulahazahStartupSweep() {
  await withTempDir(async (tmp) => {
    section("mulahazah: startup sweep deletes orphaned flags");
    const dataDir = join(tmp, "data");
    // Pre-create the data dir with an orphaned flag (no matching session in state)
    const { mkdirSync } = await import("fs");
    mkdirSync(dataDir, { recursive: true });
    const orphanFlag = join(dataDir, "MEMORY_TRIGGER_FLAG.orphan-session-xyz");
    writeFileSync(orphanFlag, "orphan\n", "utf8");
    assert("precondition: orphan flag exists", existsSync(orphanFlag));

    // Instantiate plugin — startup sweep should delete the orphan
    await MulahazahPlugin({ directory: tmp });

    assert(
      "startup sweep deleted orphan flag",
      !existsSync(orphanFlag),
      `orphan flag should be deleted at ${orphanFlag}`
    );
  });
}

// ---------------------------------------------------------------------------
// Test 5: stuck-detector — 2+ consecutive invalid → permission_loop signal
// ---------------------------------------------------------------------------
async function testStuckDetectorPermissionLoop() {
  await withTempDir(async (tmp) => {
    section("stuck-detector: 2+ consecutive invalid → permission_loop signal");
    const plugin = await StuckDetectorPlugin({ directory: tmp });
    const sid = newSessionID("permloop");
    const dataDir = join(tmp, "data");
    const sessionSignal = join(dataDir, `.stuck-signal.${sid}.json`);
    const globalSignal = join(dataDir, ".stuck-signal.json");

    // Drive 4 invalid calls (denied dispatch attempts)
    await driveCalls(plugin, sid, "invalid", { reason: "denied" }, 4, { error: true });

    assert(
      "per-session signal file exists",
      existsSync(sessionSignal),
      `expected ${sessionSignal}`
    );

    assert(
      "global signal mirror exists",
      existsSync(globalSignal),
      `expected ${globalSignal}`
    );

    if (existsSync(sessionSignal)) {
      const sig = JSON.parse(readFileSync(sessionSignal, "utf8"));
      assert(
        "signal type is permission_loop",
        sig.type === "permission_loop",
        `got type=${sig.type}`
      );
      assert(
        "signal sessionID matches",
        sig.sessionID === sid,
        `got sessionID=${sig.sessionID}`
      );
    }

    if (existsSync(globalSignal)) {
      const sig = JSON.parse(readFileSync(globalSignal, "utf8"));
      assert(
        "global mirror sessionID matches",
        sig.sessionID === sid,
        `got sessionID=${sig.sessionID}`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Test 6: stuck-detector — 6+ consecutive identical grep → readonly_repetition
// ---------------------------------------------------------------------------
async function testStuckDetectorReadonlyRepetition() {
  await withTempDir(async (tmp) => {
    section("stuck-detector: 6+ consecutive identical grep → readonly_repetition");
    const plugin = await StuckDetectorPlugin({ directory: tmp });
    const sid = newSessionID("readonly");
    const dataDir = join(tmp, "data");
    const sessionSignal = join(dataDir, `.stuck-signal.${sid}.json`);

    // Drive 8 identical grep calls (same args)
    const args = { pattern: "TODO", include: "*.js" };
    await driveCalls(plugin, sid, "grep", args, 8);

    assert(
      "per-session signal file exists after 8 identical greps",
      existsSync(sessionSignal),
      `expected ${sessionSignal}`
    );

    if (existsSync(sessionSignal)) {
      const sig = JSON.parse(readFileSync(sessionSignal, "utf8"));
      assert(
        "signal type is readonly_repetition",
        sig.type === "readonly_repetition",
        `got type=${sig.type}`
      );
      assert(
        "signal tool is grep",
        sig.tool === "grep",
        `got tool=${sig.tool}`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Test 7: stuck-detector — successful write clears the signal
// ---------------------------------------------------------------------------
async function testStuckDetectorWriteClearsSignal() {
  await withTempDir(async (tmp) => {
    section("stuck-detector: successful write clears the signal");
    const plugin = await StuckDetectorPlugin({ directory: tmp });
    const sid = newSessionID("clear");
    const dataDir = join(tmp, "data");
    const sessionSignal = join(dataDir, `.stuck-signal.${sid}.json`);
    const globalSignal = join(dataDir, ".stuck-signal.json");

    // First, get into a stuck state via 8 identical greps
    await driveCalls(plugin, sid, "grep", { pattern: "X" }, 8);
    assert("precondition: signal exists", existsSync(sessionSignal));

    // Now drive a successful write — should clear the signal
    await plugin["tool.execute.after"](
      { tool: "write", sessionID: sid, args: { filePath: "/tmp/y", content: "hi" } },
      { result: "ok" }
    );

    assert(
      "per-session signal cleared after successful write",
      !existsSync(sessionSignal),
      `signal should be deleted at ${sessionSignal}`
    );

    assert(
      "global signal cleared (this session owned it)",
      !existsSync(globalSignal),
      `global signal should be deleted at ${globalSignal}`
    );
  });
}

// ---------------------------------------------------------------------------
// Test 8: stuck-detector — read/glob/grep do NOT clear the signal
// ---------------------------------------------------------------------------
async function testStuckDetectorReadDoesNotClear() {
  await withTempDir(async (tmp) => {
    section("stuck-detector: read does NOT clear the signal (regression guard)");
    const plugin = await StuckDetectorPlugin({ directory: tmp });
    const sid = newSessionID("noreadclear");
    const dataDir = join(tmp, "data");
    const sessionSignal = join(dataDir, `.stuck-signal.${sid}.json`);

    // Get stuck via 8 identical greps
    await driveCalls(plugin, sid, "grep", { pattern: "Y" }, 8);
    assert("precondition: signal exists", existsSync(sessionSignal));

    // Drive a successful read — must NOT clear the signal
    await plugin["tool.execute.after"](
      { tool: "read", sessionID: sid, args: { filePath: "/tmp/z" } },
      { result: "file contents" }
    );

    assert(
      "signal still present after successful read (read does not clear)",
      existsSync(sessionSignal),
      `signal should remain at ${sessionSignal}`
    );
  });
}

// ---------------------------------------------------------------------------
// Test 9: stuck-detector — transform injects stuck directive
// ---------------------------------------------------------------------------
async function testStuckDetectorTransformInjects() {
  await withTempDir(async (tmp) => {
    section("stuck-detector: transform injects stuck directive");
    const plugin = await StuckDetectorPlugin({ directory: tmp });
    const sid = newSessionID("transform");
    const dataDir = join(tmp, "data");
    const sessionSignal = join(dataDir, `.stuck-signal.${sid}.json`);

    // Get stuck
    await driveCalls(plugin, sid, "grep", { pattern: "Z" }, 8);
    assert("precondition: signal exists", existsSync(sessionSignal));

    // Transform hook should inject a directive
    const out = await runTransform(plugin, sid);
    const lastMsg = out.messages[out.messages.length - 1];
    const injected = (lastMsg.parts || []).some(
      (p) => typeof p.text === "string" && /STUCK DETECTED/i.test(p.text)
    );
    assert(
      "transform injects STUCK DETECTED directive",
      injected,
      `parts: ${JSON.stringify(lastMsg.parts || []).slice(0, 200)}`
    );
  });
}

// ---------------------------------------------------------------------------
// Test 10: per-session isolation — two sessions don't interfere
// ---------------------------------------------------------------------------
async function testPerSessionIsolation() {
  await withTempDir(async (tmp) => {
    section("per-session isolation: stuck-detector histories are independent");
    const plugin = await StuckDetectorPlugin({ directory: tmp });
    const sidA = newSessionID("isoA");
    const sidB = newSessionID("isoB");
    const dataDir = join(tmp, "data");
    const signalA = join(dataDir, `.stuck-signal.${sidA}.json`);
    const signalB = join(dataDir, `.stuck-signal.${sidB}.json`);

    // Session A: 8 identical greps → stuck
    await driveCalls(plugin, sidA, "grep", { pattern: "A" }, 8);
    assert("session A is stuck", existsSync(signalA));
    assert("session B is NOT stuck (no calls yet)", !existsSync(signalB));

    // Session B: 4 invalid calls → also stuck, but independently
    await driveCalls(plugin, sidB, "invalid", { reason: "denied" }, 4, { error: true });
    assert("session A still has its signal", existsSync(signalA));
    assert("session B now has its own signal", existsSync(signalB));

    // Clear session A via write — session B must remain
    await plugin["tool.execute.after"](
      { tool: "write", sessionID: sidA, args: { filePath: "/tmp/a" } },
      { result: "ok" }
    );
    assert("session A signal cleared", !existsSync(signalA));
    assert("session B signal still present (independent)", existsSync(signalB));
  });
}

// ---------------------------------------------------------------------------
// Test 11: stuck-detector — 2+ consecutive denied task() → permission_loop
// (regression test for Finding #2: belt-and-suspenders detection of denied
// dispatch attempts where tool === "task" with an error, not just tool === "invalid")
// ---------------------------------------------------------------------------
async function testStuckDetectorDeniedTaskDispatch() {
  await withTempDir(async (tmp) => {
    section("stuck-detector: 2+ consecutive denied task() → permission_loop (regression for Finding #2)");
    const plugin = await StuckDetectorPlugin({ directory: tmp });
    const sid = newSessionID("deniedtask");
    const dataDir = join(tmp, "data");
    const sessionSignal = join(dataDir, `.stuck-signal.${sid}.json`);

    // Realistic denied dispatch shape: tool === "task" with output.error set.
    // This matches what the tool.execute.after hook records when a sub-agent
    // (with task: deny) attempts to dispatch @memory or another sub-agent.
    const hook = plugin["tool.execute.after"];
    const deniedError = new Error("permission denied");
    const args = { prompt: "delegate to @memory" };

    // Drive 4 consecutive denied task() calls (detection runs on even-length
    // history — history.length % 2 === 0 — so 4 calls guarantees the check fires)
    for (let i = 0; i < 4; i++) {
      await hook(
        { tool: "task", sessionID: sid, args },
        { result: "", error: deniedError }
      );
    }

    assert(
      "per-session signal file exists after 4 denied task() calls",
      existsSync(sessionSignal),
      `expected ${sessionSignal}`
    );

    if (existsSync(sessionSignal)) {
      const sig = JSON.parse(readFileSync(sessionSignal, "utf8"));
      assert(
        "signal type is permission_loop (denied task dispatch)",
        sig.type === "permission_loop",
        `got type=${sig.type}`
      );
      assert(
        "signal sessionID matches",
        sig.sessionID === sid,
        `got sessionID=${sig.sessionID}`
      );
      assert(
        "signal detail mentions denied dispatch",
        /denied dispatch/i.test(sig.detail) || /not allowed to use/i.test(sig.detail),
        `got detail=${sig.detail}`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Test 12: FIX A — observations.jsonl growth cap truncates to last 1000 lines
// ---------------------------------------------------------------------------
async function testObservationsGrowthCap() {
  await withTempDir(async (tmp) => {
    section("FIX A: observations.jsonl truncates to last 1000 lines when >5MB");
    const dataDir = join(tmp, "data");
    const mulahazahDir = join(dataDir, "mulahazah");
    mkdirSync(mulahazahDir, { recursive: true });
    const observationsFile = join(mulahazahDir, "observations.jsonl");

    const line = JSON.stringify({ ts: new Date().toISOString(), tool: "read", sessionID: "old" }) + "\n";
    const lineSize = Buffer.byteLength(line, "utf8");
    const targetBytes = 5 * 1024 * 1024 + 1024;
    const lineCount = Math.ceil(targetBytes / lineSize);
    const chunk = line.repeat(200);
    const chunks = Math.ceil(lineCount / 200);
    let written = "";
    for (let i = 0; i < chunks; i++) written += chunk;
    writeFileSync(observationsFile, written, "utf8");

    const preSize = statSync(observationsFile).size;
    assert(
      "precondition: observations file exceeds 5MB",
      preSize > 5 * 1024 * 1024,
      `file size was ${preSize} bytes`
    );

    const plugin = await MulahazahPlugin({ directory: tmp });
    const sid = newSessionID("cap");
    await plugin["tool.execute.after"](
      { tool: "read", sessionID: sid, args: { filePath: "/tmp/x" } },
      { result: "ok" }
    );

    await settleIO();

    const postSize = statSync(observationsFile).size;
    const content = readFileSync(observationsFile, "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);

    assert(
      "file truncated to exactly 1000 lines",
      lines.length === 1000,
      `got ${lines.length} lines`
    );

    assert(
      "file size is now under 5MB",
      postSize < 5 * 1024 * 1024,
      `file size was ${postSize} bytes`
    );

    const lastLine = JSON.parse(lines[lines.length - 1]);
    assert(
      "newest entry is preserved (last line is from this session)",
      lastLine.sessionID === sid,
      `last line sessionID was ${lastLine.sessionID}`
    );
  });
}

// ---------------------------------------------------------------------------
// Test 13: FIX A — truncation failure does not break the append path
// ---------------------------------------------------------------------------
async function testObservationsTruncationFailureResilience() {
  await withTempDir(async (tmp) => {
    section("FIX A: truncation failure does not break append path (no throw)");
    const dataDir = join(tmp, "data");
    const mulahazahDir = join(dataDir, "mulahazah");
    mkdirSync(mulahazahDir, { recursive: true });
    const observationsFile = join(mulahazahDir, "observations.jsonl");

    rmSync(observationsFile, { force: true });
    mkdirSync(observationsFile, { recursive: true });
    assert(
      "precondition: observations.jsonl is a directory (not a file)",
      statSync(observationsFile).isDirectory()
    );

    const plugin = await MulahazahPlugin({ directory: tmp });
    const sid = newSessionID("resilient");

    let threw = false;
    try {
      await plugin["tool.execute.after"](
        { tool: "read", sessionID: sid, args: { filePath: "/tmp/x" } },
        { result: "ok" }
      );
    } catch (err) {
      threw = true;
    }

    assert(
      "tool.execute.after did not throw when observations path is a directory",
      !threw,
      "appendObservation should swallow errors via try/catch"
    );

    await settleIO();

    assert(
      "plugin continued to function (session state was updated)",
      true,
      "reaching this point proves no crash"
    );
  });
}

// ---------------------------------------------------------------------------
// Test 14: FIX B — during cooldown, saveState is NOT called
// ---------------------------------------------------------------------------
async function testCooldownNoSaveState() {
  await withTempDir(async (tmp) => {
    section("FIX B: during cooldown, saveState is NOT called (state.json unchanged)");
    const plugin = await MulahazahPlugin({ directory: tmp });
    const sid = newSessionID("cooldown");
    const dataDir = join(tmp, "data");
    const stateFile = join(dataDir, "mulahazah", "state.json");
    const flagPath = join(dataDir, `MEMORY_TRIGGER_FLAG.${sid}`);

    await plugin["tool.execute.after"](
      { tool: "task", sessionID: sid, args: { prompt: "delegate" } },
      { result: "ok" }
    );
    await driveCalls(plugin, sid, "read", { filePath: "/tmp/x" }, 199);

    assert(
      "precondition: trigger fired (flag exists)",
      existsSync(flagPath)
    );

    await settleIO();

    const stateAfterTrigger = readFileSync(stateFile, "utf8");
    const parsedTrigger = JSON.parse(stateAfterTrigger);
    assert(
      "precondition: state.json shows toolCallCount=0 after trigger reset",
      parsedTrigger[sid]?.toolCallCount === 0,
      `got toolCallCount=${parsedTrigger[sid]?.toolCallCount}`
    );

    await driveCalls(plugin, sid, "read", { filePath: "/tmp/x" }, 15);
    await settleIO();

    const stateAfterCooldown = readFileSync(stateFile, "utf8");

    assert(
      "state.json is unchanged during cooldown (saveState not called)",
      stateAfterCooldown === stateAfterTrigger,
      "state.json was rewritten during cooldown — saveState churn not fixed"
    );

    const parsedCooldown = JSON.parse(stateAfterCooldown);
    assert(
      "state.json still shows toolCallCount=0 (in-memory counter incremented but not persisted)",
      parsedCooldown[sid]?.toolCallCount === 0,
      `got toolCallCount=${parsedCooldown[sid]?.toolCallCount}`
    );
  });
}

// ---------------------------------------------------------------------------
// Test 15: FIX B — after cooldown expires, accumulated count triggers threshold
// ---------------------------------------------------------------------------
async function testCooldownExpiryAccumulatedCount() {
  await withTempDir(async (tmp) => {
    section("FIX B: after cooldown expires, accumulated count triggers threshold");
    const dataDir = join(tmp, "data");
    const mulahazahDir = join(dataDir, "mulahazah");
    mkdirSync(mulahazahDir, { recursive: true });
    const stateFile = join(mulahazahDir, "state.json");
    const sid = newSessionID("expiry");

    const preState = {
      [sid]: {
        toolCallCount: 195,
        toolCounts: { read: 195 },
        lastTriggerTime: Date.now() - 6 * 60 * 1000,
        sessionStartTime: Date.now() - 10 * 60 * 1000,
        isDispatcher: true,
      },
    };
    writeFileSync(stateFile, JSON.stringify(preState), "utf8");

    const plugin = await MulahazahPlugin({ directory: tmp });
    const flagPath = join(dataDir, `MEMORY_TRIGGER_FLAG.${sid}`);

    assert(
      "precondition: no flag before threshold",
      !existsSync(flagPath)
    );

    await driveCalls(plugin, sid, "read", { filePath: "/tmp/x" }, 5);

    assert(
      "flag file exists after 5 more calls (195 + 5 = 200, threshold fires)",
      existsSync(flagPath),
      `expected ${flagPath}`
    );

    if (existsSync(flagPath)) {
      const content = readFileSync(flagPath, "utf8");
      assert(
        "flag content mentions 200 tool calls (accumulated count included)",
        /200 tool calls/i.test(content),
        `content was: ${content.slice(0, 200)}`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------
console.log("Memory-loop-fix verification harness");
console.log("====================================");
console.log(`Temp root: ${tmpdir()}`);
console.log(`Plugin dir: ${PLUGIN_DIR}`);

try {
  await testMulahazahDispatcher();
  await testMulahazahSubAgent();
  await testMulahazahTransformDeletesStaleFlag();
  await testMulahazahStartupSweep();
  await testStuckDetectorPermissionLoop();
  await testStuckDetectorReadonlyRepetition();
  await testStuckDetectorWriteClearsSignal();
  await testStuckDetectorReadDoesNotClear();
  await testStuckDetectorTransformInjects();
  await testPerSessionIsolation();
  await testStuckDetectorDeniedTaskDispatch();
  await testObservationsGrowthCap();
  await testObservationsTruncationFailureResilience();
  await testCooldownNoSaveState();
  await testCooldownExpiryAccumulatedCount();
} catch (err) {
  console.error("\nFATAL: harness threw an unexpected error:");
  console.error(err);
  process.exit(1);
}

console.log("\n====================================");
console.log(`Results: ${passCount} passed, ${failCount} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  - ${f.label}${f.detail ? ` (${f.detail})` : ""}`);
  }
}
process.exit(failCount > 0 ? 1 : 0);
