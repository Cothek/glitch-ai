// test-dashboard-staleness.mjs — tests for findStaleDashboardSections
// Verifies: all-✅/❌ sections flagged, mixed/active sections not flagged,
// header/separator rows skipped, bullet-list sections ignored.
import { pathToFileURL } from "url";
import { join } from "path";

const MODULE = pathToFileURL(join(process.cwd(), "scripts", "run-compaction.mjs")).href;
const { findStaleDashboardSections } = await import(MODULE);

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { console.log(`  PASS: ${label}`); passed++; }
  else { console.error(`  FAIL: ${label}`); failed++; }
}
function assertDeep(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { console.log(`  PASS: ${label}`); passed++; }
  else { console.error(`  FAIL: ${label}\n    expected: ${e}\n    actual:   ${a}`); failed++; }
}

console.log("=== Dashboard staleness check tests ===\n");

// 1. All-✅ section → flagged
{
  const content = `# Dashboard
## Active Workstreams
### 🐞 Done Thing
| Status | Progress | Next Step |
|--------|----------|-----------|
| ✅ Built | ▰▰▰▰▰▰▰▰▰▰ 100% | — |
| ✅ Tested | ▰▰▰▰▰▰▰▰▰▰ 100% | — |
`;
  assertDeep(findStaleDashboardSections(content), ["🐞 Done Thing"], "all-✅ section flagged");
}

// 2. All-❌ section → flagged
{
  const content = `# Dashboard
### ❌ Abandoned Thing
| Status | Progress | Next Step |
|--------|----------|-----------|
| ❌ Dead | ▰▰▰▰▰▰▰▰▰▰ 100% | — |
`;
  assertDeep(findStaleDashboardSections(content), ["❌ Abandoned Thing"], "all-❌ section flagged");
}

// 3. Mixed ✅/🔲 section → NOT flagged (still active)
{
  const content = `# Dashboard
### 💰 Live Project
| Status | Progress | Next Step |
|--------|----------|-----------|
| ✅ Done part | ▰▰▰▰▰▰▰▰▰▰ 100% | — |
| 🔲 Next part | ▱▱▱▱▱▱▱▱▱▱ 0% | Do it |
`;
  assertDeep(findStaleDashboardSections(content), [], "mixed ✅/🔲 section NOT flagged");
}

// 4. 🔄 row → NOT flagged
{
  const content = `# Dashboard
### 🔄 In Progress
| Status | Progress | Next Step |
|--------|----------|-----------|
| 🔄 Scaffolded | ▰▰▰▰▰▰▰▰▰▰ 100% | — |
`;
  assertDeep(findStaleDashboardSections(content), [], "🔄 row NOT flagged");
}

// 5. Bullet-list section (no table rows) → NOT flagged
{
  const content = `# Dashboard
### ✅ Completed / Archived
- **🧠 Memory System** — done
- **🔧 Consistency** — done
`;
  assertDeep(findStaleDashboardSections(content), [], "bullet-list section NOT flagged");
}

// 6. Empty dashboard → no stale
{
  assertDeep(findStaleDashboardSections("# Dashboard\n"), [], "empty dashboard no stale");
}

// 7. Multiple sections — only stale ones returned
{
  const content = `# Dashboard
### 🐞 Done A
| Status | Progress | Next Step |
|--------|----------|-----------|
| ✅ Done | ▰▰▰▰▰▰▰▰▰▰ 100% | — |
### 💰 Live B
| Status | Progress | Next Step |
|--------|----------|-----------|
| 🔲 Todo | ▱▱▱▱▱▱▱▱▱▱ 0% | — |
### 🐞 Done C
| Status | Progress | Next Step |
|--------|----------|-----------|
| ❌ Dead | ▰▰▰▰▰▰▰▰▰▰ 100% | — |
`;
  assertDeep(findStaleDashboardSections(content), ["🐞 Done A", "🐞 Done C"], "only stale sections returned");
}

// 8. Real pre-trim dashboard shape — completed workstreams flagged, live ones not
{
  const content = `# Session Dashboard
## Active Workstreams
### 🔌 glitch-connector MCP Server
| Status | Progress | Next Step |
|--------|----------|-----------|
| ✅ Architecture design | ▰▰▰▰▰▰▰▰▰▰ 100% | — |
| ✅ Core server (index.mjs) | ▰▰▰▰▰▰▰▰▰▰ 100% | — |
| 🔲 Populate with real credentials | ▰▰▰▱▱▱▱▱▱▱ 25% | Add FireStore, Stripe, etc. |
### 🐞 Agent Watchdog — hung-agent fix
| Status | Progress | Next Step |
|--------|----------|-----------|
| ✅ Investigation complete | ▰▰▰▰▰▰▰▰▰▰ 100% | — |
| ✅ Implementation done | ▰▰▰▰▰▰▰▰▰▰ 100% | — |
### 💰 glitch-money
| Status | Progress | Next Step |
|--------|----------|-----------|
| ✅ Dashboard tabs | ▰▰▰▰▰▰▰▰▰▰ 100% | — |
| 🔲 Identity separation | ▱▱▱▱▱▱▱▱▱▱ 0% | Business email |
`;
  assertDeep(findStaleDashboardSections(content), ["🐞 Agent Watchdog — hung-agent fix"], "real-shape: done-only flagged, mixed not");
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);