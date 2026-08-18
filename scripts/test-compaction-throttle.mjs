// test-compaction-throttle.mjs — smoke test for compaction.js throttling
// Verifies: heavy steps (6-9) appear on cycle 1, 4, 7... and are omitted on 2, 3, 5, 6...
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

const PLUGIN_PATH = pathToFileURL(join(process.cwd(), ".opencode", "plugins", "compaction.js")).href;
const { CompactionPlugin } = await import(PLUGIN_PATH);

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { console.log(`  PASS: ${label}`); passed++; }
  else { console.error(`  FAIL: ${label}`); failed++; }
}

const tmp = mkdtempSync(join(tmpdir(), "compaction-throttle-"));
mkdirSync(join(tmp, "data"), { recursive: true });
mkdirSync(join(tmp, "user"), { recursive: true });

// Minimal user files so the plugin's reads don't throw
const { writeFileSync } = await import("fs");
writeFileSync(join(tmp, "user", "current-session.md"), "## Working Memory (Scratchpad)\n- test entry\n");
writeFileSync(join(tmp, "user", "pending-skill-improvements.md"), "- [2026-08-18] test\n");
writeFileSync(join(tmp, "user", "reminders.md"), "## Open\n- test reminder\n");

const plugin = await CompactionPlugin({ directory: tmp });
const hook = plugin["experimental.session.compacting"];

async function fireCycle() {
  const output = { prompt: "" };
  await hook({}, output);
  return output.prompt;
}

console.log("=== Compaction throttle smoke test ===\n");

// Cycle 1: heavy (first run, lastHeavyRun === null)
let prompt = await fireCycle();
assert(prompt.includes("## Step 6 — Pattern Scan"), "cycle 1 includes Step 6 (heavy)");
assert(prompt.includes("## Step 7 — Self-Review"), "cycle 1 includes Step 7 (heavy)");
assert(prompt.includes("## Step 8 — Curriculum"), "cycle 1 includes Step 8 (heavy)");
assert(prompt.includes("## Step 9 — Staleness Check"), "cycle 1 includes Step 9 (heavy)");
assert(prompt.includes("heavy cycle"), "cycle 1 notes heavy cycle");

// Cycle 2: light (2 % 3 !== 0)
prompt = await fireCycle();
assert(!prompt.includes("## Step 6 — Pattern Scan"), "cycle 2 omits Step 6 (light)");
assert(!prompt.includes("## Step 7 — Self-Review"), "cycle 2 omits Step 7 (light)");
assert(!prompt.includes("## Step 8 — Curriculum"), "cycle 2 omits Step 8 (light)");
assert(!prompt.includes("## Step 9 — Staleness Check"), "cycle 2 omits Step 9 (light)");
assert(prompt.includes("Heavy steps throttled"), "cycle 2 notes throttling");

// Cycle 3: heavy (3 % 3 === 0)
prompt = await fireCycle();
assert(prompt.includes("## Step 6 — Pattern Scan"), "cycle 3 includes Step 6 (heavy, 3%3=0)");

// Cycle 4: light (4 % 3 = 1)
prompt = await fireCycle();
assert(!prompt.includes("## Step 6 — Pattern Scan"), "cycle 4 omits Step 6 (light, 4%3=1)");

// Verify state file exists
const stateRaw = await import("fs").then(fs => fs.readFileSync(join(tmp, "data", "compaction-state.json"), "utf8"));
const state = JSON.parse(stateRaw);
assert(typeof state.count === "number" && state.count === 4, `state.count === 4 (got ${state.count})`);
assert(typeof state.lastHeavyRun === "number", "state.lastHeavyRun is a number");

// Verify prompt trimming: scratchpad capped at 10 lines
// Uses the ACTUAL current-session.md header ("## Working Memory (Scratchpad)")
// so the plugin's regex matches and the cap is genuinely exercised.
writeFileSync(join(tmp, "user", "current-session.md"),
  "## Working Memory (Scratchpad)\n" + Array.from({ length: 25 }, (_, i) => `- entry ${i}`).join("\n") + "\n");
prompt = await fireCycle();
const scratchMatch = prompt.match(/## Current Scratchpad Contents[\s\S]*?```\n([\s\S]*?)\n```/);
if (scratchMatch) {
  const lineCount = scratchMatch[1].split("\n").filter(l => l.trim()).length;
  assert(lineCount <= 10, `scratchpad capped at 10 lines (got ${lineCount})`);
  assert(scratchMatch[1].includes("entry 24"), "scratchpad shows the LAST entries (tail, not head)");
} else {
  assert(false, "scratchpad section found in prompt");
}

rmSync(tmp, { recursive: true, force: true });

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);