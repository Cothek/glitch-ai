// mulahazah.js - OpenCode plugin: threshold-based memory trigger
//
// Observes every tool.execute.after event. Tracks tool call counts and session
// duration. When thresholds are met (or a trigger phrase is detected in args),
// writes a signal flag at data/MEMORY_TRIGGER_FLAG. The model reads this flag
// at response start, dispatches @memory to record observations, then deletes
// the flag.
//
// State persistence:
//   data/mulahazah/state.json       — counter, last trigger time, session start
//   data/mulahazah/observations.jsonl — append-only log of every tool call
//
// Signal flag:
//   data/MEMORY_TRIGGER_FLAG        — short text summary, deleted after dispatch
//
// Thresholds (hardcoded):
//   50 tool calls OR 15 minutes elapsed → fire trigger
//   2 minute cooldown between triggers
//   24 hour stale reset on session start
//
// Trigger phrases (case-insensitive scan of input.args):
//   "remember that", "i prefer", "from now on", "always do", "never do",
//   "i want", "make sure to", "don't forget"
//   → fire trigger immediately (subject to cooldown)
//
// Install: Add to .opencode/opencode.json:
//   "plugin": [".opencode/plugins/mulahazah.js"]

import { promises as fs } from "fs";
import { join } from "path";

const TOOL_CALL_THRESHOLD = 50;
const TIME_THRESHOLD_MS = 15 * 60 * 1000;       // 15 minutes
const COOLDOWN_MS = 2 * 60 * 1000;              // 2 minutes
const STALE_RESET_MS = 24 * 60 * 60 * 1000;     // 24 hours

const TRIGGER_PHRASES = [
  "remember that",
  "i prefer",
  "from now on",
  "always do",
  "never do",
  "i want",
  "make sure to",
  "don't forget",
];

export const MulahazahPlugin = async ({ directory }) => {
  const dataDir = join(directory, "data");
  const mulahazahDir = join(dataDir, "mulahazah");
  const stateFile = join(mulahazahDir, "state.json");
  const observationsFile = join(mulahazahDir, "observations.jsonl");
  const triggerFlag = join(dataDir, "MEMORY_TRIGGER_FLAG");

  // Ensure directories exist (async, non-blocking)
  try {
    await fs.mkdir(mulahazahDir, { recursive: true });
  } catch (err) {
    console.error(`[mulahazah] Failed to create directory: ${err.message}`);
  }

  // Load state from disk (or initialize defaults)
  let state = {
    toolCallCount: 0,
    lastTriggerTime: null,
    sessionStartTime: null,
  };

  try {
    const raw = await fs.readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    state = {
      toolCallCount: typeof parsed.toolCallCount === "number" ? parsed.toolCallCount : 0,
      lastTriggerTime: typeof parsed.lastTriggerTime === "number" ? parsed.lastTriggerTime : null,
      sessionStartTime: typeof parsed.sessionStartTime === "number" ? parsed.sessionStartTime : null,
    };
  } catch (err) {
    // File doesn't exist or is corrupt — use defaults
    if (err.code !== "ENOENT") {
      console.error(`[mulahazah] Failed to load state: ${err.message}`);
    }
  }

  // Tool count tracking (resets each trigger cycle)
  // Declared before stale-reset block to avoid temporal dead zone ReferenceError
  let toolCounts = {};

  // Stale reset: if last trigger was >24h ago, reset counter
  const now = Date.now();
  if (state.lastTriggerTime !== null && now - state.lastTriggerTime > STALE_RESET_MS) {
    state.toolCallCount = 0;
    toolCounts = {};
  }
  if (state.sessionStartTime !== null && now - state.sessionStartTime > STALE_RESET_MS) {
    state.toolCallCount = 0;
    toolCounts = {};
    state.sessionStartTime = now;
  }
  if (state.lastTriggerTime === null && state.toolCallCount > 1000) {
    state.toolCallCount = 0;
    toolCounts = {};
  }

  // Set session start time if not already set
  if (state.sessionStartTime === null) {
    state.sessionStartTime = now;
  }

  // Atomic state write helper
  async function saveState() {
    try {
      const tmpFile = stateFile + ".tmp";
      await fs.writeFile(tmpFile, JSON.stringify(state, null, 2), "utf8");
      await fs.rename(tmpFile, stateFile);
    } catch (err) {
      console.error(`[mulahazah] Failed to save state: ${err.message}`);
    }
  }

  // Append observation to JSONL log
  async function appendObservation(tool, sessionID) {
    try {
      const entry = {
        ts: new Date().toISOString(),
        tool,
        sessionID: sessionID || "unknown",
      };
      await fs.appendFile(observationsFile, JSON.stringify(entry) + "\n", "utf8");
    } catch (err) {
      console.error(`[mulahazah] Failed to append observation: ${err.message}`);
    }
  }

  // Format tool counts as sorted comma-separated list
  function formatToolCounts() {
    const entries = Object.entries(toolCounts);
    if (entries.length === 0) return "none";
    entries.sort((a, b) => b[1] - a[1]);
    return entries.map(([tool, count]) => `${tool}=${count}`).join(", ");
  }

  // Format session duration as "Xmin" or "Xh Ymin"
  function formatDuration(ms) {
    const totalMinutes = Math.floor(ms / 60000);
    if (totalMinutes < 60) return `${totalMinutes}min`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}min`;
  }

  // Build threshold-based summary
  function buildThresholdSummary() {
    const elapsed = Date.now() - state.sessionStartTime;
    return [
      `Mulahazah threshold reached: ${state.toolCallCount} tool calls / ${formatDuration(elapsed)} elapsed.`,
      `Tool breakdown: ${formatToolCounts()}`,
      `Trigger @memory to record observations.`,
    ].join("\n");
  }

  // Build trigger-phrase summary
  function buildPhraseSummary(phrase) {
    const elapsed = Date.now() - state.sessionStartTime;
    return [
      `Mulahazah trigger phrase detected: "${phrase}"`,
      `Tool calls since last trigger: ${state.toolCallCount}`,
      `Session duration: ${formatDuration(elapsed)}`,
      `Trigger @memory to record this preference/decision.`,
    ].join("\n");
  }

  // Fire trigger: write flag, update state, reset counters
  async function fireTrigger(summary) {
    try {
      await fs.writeFile(triggerFlag, summary + "\n", "utf8");
      state.lastTriggerTime = Date.now();
      state.toolCallCount = 0;
      toolCounts = {};
      await saveState();
      console.log("[mulahazah] threshold reached, flag written");
    } catch (err) {
      console.error(`[mulahazah] Failed to write trigger flag: ${err.message}`);
    }
  }

  // Check if cooldown has elapsed
  function isCooldownElapsed() {
    if (state.lastTriggerTime === null) return true;
    return Date.now() - state.lastTriggerTime >= COOLDOWN_MS;
  }

  // Scan args for trigger phrases (case-insensitive)
  function detectTriggerPhrase(args) {
    if (!args) return null;
    let argStr;
    try {
      if (typeof args === "string") {
        argStr = args;
      } else {
        argStr = JSON.stringify(args);
      }
      // Cap length to prevent processing huge args
      if (argStr.length > 2000) {
        argStr = argStr.substring(0, 2000);
      }
    } catch {
      return null;
    }
    const lower = argStr.toLowerCase();
    for (const phrase of TRIGGER_PHRASES) {
      if (lower.includes(phrase)) return phrase;
    }
    return null;
  }

  return {
    "tool.execute.after": async (input, output) => {
      const tool = input.tool || "unknown";
      const sessionID = input.sessionID || "unknown";

      // 1. Increment counter
      state.toolCallCount++;

      // 2. Track tool counts
      toolCounts[tool] = (toolCounts[tool] || 0) + 1;

      // 3. Append observation (fire-and-forget, don't await to keep handler fast)
      appendObservation(tool, sessionID).catch((err) => console.error(`[mulahazah] background task failed: ${err.message}`));

      // 4. Check cooldown
      if (!isCooldownElapsed()) {
        // Still in cooldown — save state and return
        saveState().catch((err) => console.error(`[mulahazah] background task failed: ${err.message}`));
        return;
      }

      // 5. Check trigger phrase (override path)
      const phrase = detectTriggerPhrase(input.args);
      if (phrase) {
        console.log(`[mulahazah] trigger phrase detected: "${phrase}"`);
        await fireTrigger(buildPhraseSummary(phrase));
        return;
      }

      // 6. Check thresholds
      const elapsed = Date.now() - state.sessionStartTime;
      const hitCallThreshold = state.toolCallCount >= TOOL_CALL_THRESHOLD;
      const hitTimeThreshold = elapsed >= TIME_THRESHOLD_MS;

      if (hitCallThreshold || hitTimeThreshold) {
        await fireTrigger(buildThresholdSummary());
        return;
      }

      // 7. No trigger — save state periodically (every 10 calls to reduce I/O)
      if (state.toolCallCount % 10 === 0) {
        saveState().catch((err) => console.error(`[mulahazah] background task failed: ${err.message}`));
      }
    },
  };
};
