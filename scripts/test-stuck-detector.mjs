// test-stuck-detector.mjs — Unit tests for stuck-detector.js detectStuck()
//
// Run: node scripts/test-stuck-detector.mjs
// (or: data\node\node.exe scripts/test-stuck-detector.mjs)

import { detectStuck } from "../.opencode/plugins/stuck-detector.js";
import assert from "node:assert";

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

function entry(tool, args, error = false) {
  return { tool, args: args || {}, error, timestamp: Date.now() };
}

function padHistory(history, minLen = 4) {
  while (history.length < minLen) {
    history.unshift(entry("_pad", {}));
  }
  return history;
}

// ============================================================
console.log("\nFALSE POSITIVE tests (must return null):");
// ============================================================

test("6 reads of DIFFERENT files in same directory \u2192 no readonly_repetition", () => {
  const history = [];
  for (let i = 0; i < 6; i++) {
    history.push(entry("read", { filePath: `E:\\Glitch AI\\glitch-ai\\data\\file${i}.json` }));
  }
  const result = detectStuck(history);
  assert.strictEqual(result, null, `Expected null, got: ${JSON.stringify(result)}`);
});

test("8 sequential edits to same file \u2192 no tool_repetition (edit excluded)", () => {
  const history = [];
  for (let i = 0; i < 8; i++) {
    history.push(entry("edit", {
      filePath: "E:\\Glitch AI\\glitch-ai\\scripts\\install.ps1",
      oldString: `old ${i}`,
      newString: `new ${i}`,
    }));
  }
  const result = detectStuck(history);
  assert.strictEqual(result, null, `Expected null, got: ${JSON.stringify(result)}`);
});

test("6 task() calls to same agent with DIFFERENT prompts \u2192 no tool_repetition (task excluded)", () => {
  const history = [];
  for (let i = 0; i < 6; i++) {
    history.push(entry("task", {
      subagent_type: "@coder",
      prompt: `Implement feature ${i} with completely different requirements and scope`,
    }));
  }
  const result = detectStuck(history);
  assert.strictEqual(result, null, `Expected null, got: ${JSON.stringify(result)}`);
});

test("5 sequential different bash git commands \u2192 no tool_repetition, no command_repetition", () => {
  const history = padHistory([
    entry("bash", { command: "git add scripts/install.ps1" }),
    entry("bash", { command: "git status" }),
    entry("bash", { command: "git commit -m 'fix: something'" }),
    entry("bash", { command: "git push origin develop" }),
    entry("bash", { command: "git log --oneline -5" }),
  ]);
  const result = detectStuck(history);
  assert.strictEqual(result, null, `Expected null, got: ${JSON.stringify(result)}`);
});

test("6 different grep calls with different patterns \u2192 no readonly_repetition", () => {
  const history = [];
  const patterns = ["function foo", "function bar", "const baz", "import.*react", "export default", "class Handler"];
  for (const p of patterns) {
    history.push(entry("grep", { pattern: p, include: "*.ts" }));
  }
  const result = detectStuck(history);
  assert.strictEqual(result, null, `Expected null, got: ${JSON.stringify(result)}`);
});

test("3 different webfetch calls with different URLs \u2192 no tool_repetition", () => {
  const history = padHistory([
    entry("webfetch", { url: "https://example.com/api/users/list" }),
    entry("webfetch", { url: "https://github.com/Cothek/glitch-ai/issues" }),
    entry("webfetch", { url: "https://docs.google.com/spreadsheets/d/abc123" }),
  ]);
  const result = detectStuck(history);
  assert.strictEqual(result, null, `Expected null, got: ${JSON.stringify(result)}`);
});

// ============================================================
console.log("\nGENUINE detection tests (must fire):");
// ============================================================

test("6 consecutive reads of SAME file \u2192 readonly_repetition", () => {
  const history = [];
  for (let i = 0; i < 6; i++) {
    history.push(entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\data\\same-file.json" }));
  }
  const result = detectStuck(history);
  assert.notStrictEqual(result, null, "Expected a signal, got null");
  assert.strictEqual(result.type, "readonly_repetition");
  assert.strictEqual(result.tool, "read");
});

test("6 consecutive globs of SAME pattern \u2192 readonly_repetition", () => {
  const history = [];
  for (let i = 0; i < 6; i++) {
    history.push(entry("glob", { pattern: "**/*.ts" }));
  }
  const result = detectStuck(history);
  assert.notStrictEqual(result, null, "Expected a signal, got null");
  assert.strictEqual(result.type, "readonly_repetition");
  assert.strictEqual(result.tool, "glob");
});

test("3+ identical webfetch with identical URL \u2192 tool_repetition", () => {
  const history = padHistory([
    entry("webfetch", { url: "https://example.com/api/data" }),
    entry("webfetch", { url: "https://example.com/api/data" }),
    entry("webfetch", { url: "https://example.com/api/data" }),
  ]);
  const result = detectStuck(history);
  assert.notStrictEqual(result, null, "Expected a signal, got null");
  assert.strictEqual(result.type, "tool_repetition");
  assert.strictEqual(result.tool, "webfetch");
});

test("3+ identical bash command \u2192 command_repetition", () => {
  const history = padHistory([
    entry("bash", { command: "git status" }),
    entry("bash", { command: "git status" }),
    entry("bash", { command: "git status" }),
  ]);
  const result = detectStuck(history);
  assert.notStrictEqual(result, null, "Expected a signal, got null");
  assert.strictEqual(result.type, "command_repetition");
});

test("2 consecutive denied task calls \u2192 permission_loop", () => {
  const history = padHistory([
    entry("task", { prompt: "do something" }, true),
    entry("task", { prompt: "do something else" }, true),
  ]);
  const result = detectStuck(history);
  assert.notStrictEqual(result, null, "Expected a signal, got null");
  assert.strictEqual(result.type, "permission_loop");
});

test("2 consecutive invalid tool calls \u2192 permission_loop", () => {
  const history = padHistory([
    entry("invalid", {}),
    entry("invalid", {}),
  ]);
  const result = detectStuck(history);
  assert.notStrictEqual(result, null, "Expected a signal, got null");
  assert.strictEqual(result.type, "permission_loop");
});

test("3 consecutive errored calls \u2192 error_cascade", () => {
  const history = padHistory([
    entry("bash", { command: "npm install" }, true),
    entry("bash", { command: "npm test" }, true),
    entry("bash", { command: "npm run build" }, true),
  ]);
  const result = detectStuck(history);
  assert.notStrictEqual(result, null, "Expected a signal, got null");
  assert.strictEqual(result.type, "error_cascade");
});

// ============================================================
console.log("\nEDGE CASE tests:");
// ============================================================

test("history shorter than 4 \u2192 null", () => {
  const history = [
    entry("read", { filePath: "a.json" }),
    entry("read", { filePath: "a.json" }),
    entry("read", { filePath: "a.json" }),
  ];
  const result = detectStuck(history);
  assert.strictEqual(result, null, `Expected null for short history, got: ${JSON.stringify(result)}`);
});

test("empty history \u2192 null", () => {
  const result = detectStuck([]);
  assert.strictEqual(result, null, `Expected null for empty history, got: ${JSON.stringify(result)}`);
});

test("exactly 4 entries, no pattern \u2192 null", () => {
  const history = [
    entry("read", { filePath: "a.json" }),
    entry("write", { filePath: "b.json" }),
    entry("bash", { command: "ls" }),
    entry("edit", { filePath: "c.json" }),
  ];
  const result = detectStuck(history);
  assert.strictEqual(result, null, `Expected null, got: ${JSON.stringify(result)}`);
});

test("skill calls are never stuck (excluded from tool_repetition)", () => {
  const history = padHistory([
    entry("skill", { name: "debugging" }),
    entry("skill", { name: "debugging" }),
    entry("skill", { name: "debugging" }),
  ]);
  const result = detectStuck(history);
  assert.strictEqual(result, null, `Expected null, got: ${JSON.stringify(result)}`);
});

test("question calls are never stuck (excluded from tool_repetition)", () => {
  const history = padHistory([
    entry("question", { questions: [{ question: "q1" }] }),
    entry("question", { questions: [{ question: "q1" }] }),
    entry("question", { questions: [{ question: "q1" }] }),
  ]);
  const result = detectStuck(history);
  assert.strictEqual(result, null, `Expected null, got: ${JSON.stringify(result)}`);
});

test("todowrite calls are never stuck (excluded from tool_repetition)", () => {
  const history = padHistory([
    entry("todowrite", { todos: [] }),
    entry("todowrite", { todos: [] }),
    entry("todowrite", { todos: [] }),
  ]);
  const result = detectStuck(history);
  assert.strictEqual(result, null, `Expected null, got: ${JSON.stringify(result)}`);
});

// ============================================================
console.log("\nBOUNDARY tests (reviewer MINOR-2):");
// ============================================================

// Test A: exactly 2 identical bash commands must NOT fire command_repetition.
// The plugin gates command_repetition on bashCommands.length >= 3, so 2 identical
// bash calls are treated as non-stuck (could be a legit re-run). Only 3+ bash calls
// in the window with a 2+ repeated command fires.
test("exactly 2 identical bash commands \u2192 no command_repetition (gate: >= 3 bash calls)", () => {
  const history = padHistory([
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\a.ts" }),
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\b.ts" }),
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\c.ts" }),
    entry("bash", { command: "npm test" }),
    entry("bash", { command: "npm test" }),
  ]);
  const result = detectStuck(history);
  assert.strictEqual(result, null, `Expected null (2 identical bash calls below gate), got: ${JSON.stringify(result)}`);
});

// Test B: tool_repetition boundary at exactly 3 similar calls.
// webfetch is NOT in the excluded-tools list, so 3 identical webfetch calls in the
// last 8 must fire tool_repetition (count=3). Companion: exactly 2 identical webfetch
// calls must NOT fire (count < 3).
test("exactly 3 identical webfetch calls \u2192 tool_repetition fires (count=3)", () => {
  const history = padHistory([
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\a.ts" }),
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\b.ts" }),
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\c.ts" }),
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\d.ts" }),
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\e.ts" }),
    entry("webfetch", { url: "https://example.com/api/data" }),
    entry("webfetch", { url: "https://example.com/api/data" }),
    entry("webfetch", { url: "https://example.com/api/data" }),
  ]);
  const result = detectStuck(history);
  assert.notStrictEqual(result, null, "Expected a signal, got null");
  assert.strictEqual(result.type, "tool_repetition");
  assert.strictEqual(result.tool, "webfetch");
});

test("exactly 2 identical webfetch calls \u2192 no tool_repetition (count < 3)", () => {
  const history = padHistory([
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\a.ts" }),
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\b.ts" }),
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\c.ts" }),
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\d.ts" }),
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\e.ts" }),
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\f.ts" }),
    entry("webfetch", { url: "https://example.com/api/data" }),
    entry("webfetch", { url: "https://example.com/api/data" }),
  ]);
  const result = detectStuck(history);
  assert.strictEqual(result, null, `Expected null (2 webfetch below threshold), got: ${JSON.stringify(result)}`);
});

// Test C: same-file read loop with varying offset/limit must still fire readonly_repetition.
// The fingerprint for read is filePath-only, so offset/limit variation does NOT break
// the loop detection. 6 consecutive reads of the same file with different offsets
// must fire.
test("6 reads of SAME file with varying offset/limit \u2192 readonly_repetition fires", () => {
  const history = [];
  for (let i = 0; i < 6; i++) {
    history.push(entry("read", {
      filePath: "E:\\Glitch AI\\glitch-ai\\scripts\\install.ps1",
      offset: i * 100,
      limit: 100,
    }));
  }
  const result = detectStuck(history);
  assert.notStrictEqual(result, null, "Expected a signal, got null");
  assert.strictEqual(result.type, "readonly_repetition");
  assert.strictEqual(result.tool, "read");
});

// Test D: mixed sequence interrupts readonly run.
// 5 reads of different files + 1 write + 1 read = NOT 6 consecutive same readonly tool,
// so readonly_repetition must NOT fire. The write breaks the consecutive readonly run.
test("5 reads of different files + 1 write + 1 read \u2192 no readonly_repetition", () => {
  const history = [
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\a.ts" }),
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\b.ts" }),
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\c.ts" }),
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\d.ts" }),
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\e.ts" }),
    entry("write", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\f.ts", content: "x" }),
    entry("read", { filePath: "E:\\Glitch AI\\glitch-ai\\src\\g.ts" }),
  ];
  const result = detectStuck(history);
  assert.strictEqual(result, null, `Expected null (write breaks readonly run), got: ${JSON.stringify(result)}`);
});

// ============================================================
// Summary
// ============================================================

console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${"=".repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
