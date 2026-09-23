// test-blast-radius.mjs — end-to-end harness for blast-radius.js
//
// Proves the opencode hook mechanism works for PRE-edit blast radius against
// the REAL GitNexus backend (already installed + indexed in Glitch), by
// simulating the two hooks the plugin registers:
//   1. tool.execute.before  (edit/write detected -> command run -> signal written)
//   2. experimental.chat.messages.transform (signal -> synthetic part injected)
//
// Run: node scripts/test-blast-radius.mjs

import { promises as fs } from "fs";
import { join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

// Use the REAL GitNexus backend (default command). No env override needed.
const { BlastRadiusPlugin } = await import(
  pathToFileURL(join(repoRoot, ".opencode", "plugins", "blast-radius.js")).href
);

const plugin = await BlastRadiusPlugin({ directory: repoRoot });

const SESSION = "test-blast-session-789";
const FILE = "scripts/lib/plugin-manager.mjs";

// --- Step 1: simulate a PRE-edit tool call (tool.execute.before) ---
console.log("=== Step 1: tool.execute.before (edit) ===");
await plugin["tool.execute.before"](
  { tool: "edit", args: { filePath: FILE, oldString: "a", newString: "b" }, sessionID: SESSION },
  {}
);

// Give the fire-and-forget spawn time to complete (gitnexus impact).
await new Promise((r) => setTimeout(r, 2500));

const signalFile = join(repoRoot, "data", "blast-radius", `${SESSION}.json`);
let signalExists = false;
try {
  await fs.access(signalFile);
  signalExists = true;
} catch {}

console.log(`signal file written: ${signalExists}`);
if (signalExists) {
  const payload = JSON.parse(await fs.readFile(signalFile, "utf8"));
  console.log(`  filePath: ${payload.filePath}`);
  console.log(`  result (first 200 chars): ${payload.result.slice(0, 200)}`);
}

// --- Step 2: simulate the transform hook (next LLM message) ---
console.log("\n=== Step 2: experimental.chat.messages.transform ===");
const messages = [
  {
    info: { sessionID: SESSION, id: "msg_test" },
    parts: [{ id: "prt_1", sessionID: SESSION, messageID: "msg_test", type: "text", text: "user said: fix the plugin manager" }],
  },
];

await plugin["experimental.chat.messages.transform"]({}, { messages });

const injected = messages[0].parts.find((p) => p.synthetic === true);
console.log(`synthetic part injected: ${!!injected}`);
if (injected) {
  console.log("--- injected text ---");
  console.log(injected.text);
  console.log("---------------------");
}

// --- Step 3: verify signal was consumed (no re-injection) ---
let consumed = false;
try {
  await fs.access(signalFile);
} catch {
  consumed = true;
}
console.log(`\nsignal consumed after injection: ${consumed}`);

// --- Step 4: verify non-edit tools are ignored ---
console.log("\n=== Step 4: non-edit tool is ignored ===");
await plugin["tool.execute.before"](
  { tool: "read", args: { filePath: FILE }, sessionID: SESSION },
  {}
);
await new Promise((r) => setTimeout(r, 500));
let readSignal = false;
try {
  await fs.access(signalFile);
  readSignal = true;
} catch {}
console.log(`read tool produced NO signal: ${!readSignal}`);

console.log("\n✅ harness complete");