// mulahazah.js - OpenCode plugin: threshold-based memory trigger
//
// Observes every tool.execute.after event. Tracks tool call counts and session
// duration. When thresholds are met (or a trigger phrase is detected in args),
// writes a signal flag at data/MEMORY_TRIGGER_FLAG.
//
// CONSUMPTION (PM-022 fix): The plugin hooks `experimental.chat.messages.transform`,
// which fires AFTER messages are read from the DB and BEFORE they are sent to
// the LLM. If the trigger flag exists, its contents are appended as a text part
// to the LAST message's parts — so the model is forced to see the directive and
// dispatch @memory. This converts the previously-behavioral consumption step
// into a mechanical one. The model still deletes the flag after dispatching
// @memory (the plugin does NOT delete it — that keeps the protocol intact so
// @memory actually gets dispatched).
//
// Why this hook and not `chat.message`: `chat.message` fires inside
// createUserMessage AFTER parts are built but BEFORE they are saved to the DB.
// Pushing into output.parts there only publishes a PartUpdated event — it does
// NOT write to the DB. Model messages are constructed from DB rows via
// hydrate() → PartTable, so parts not in the DB never reach the LLM. The
// pushed part also lacks required fields (id, sessionID, messageID) and would
// fail schema validation. `experimental.chat.messages.transform` is the
// correct injection point — it fires after DB read, before LLM, and mutations
// to output.messages DO reach the model.
//
// State persistence:
//   data/mulahazah/state.json       — counter, last trigger time, session start
//   data/mulahazah/observations.jsonl — append-only log of every tool call
//
// Signal flag:
//   data/MEMORY_TRIGGER_FLAG        — short text summary, deleted after dispatch
//
// Thresholds (hardcoded):
//   25 tool calls OR 10 minutes elapsed → fire trigger
//   1 minute cooldown between triggers
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
import { randomUUID } from "crypto";

const TOOL_CALL_THRESHOLD = 25;
const TIME_THRESHOLD_MS = 10 * 60 * 1000;       // 10 minutes
const COOLDOWN_MS = 60 * 1000;                  // 1 minute
const STALE_RESET_MS = 24 * 60 * 60 * 1000;     // 24 hours
// Lowered from 50/15min/2min (2026-08-03) — PM-022 fix to make @memory dispatch more responsive.

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
    /**
     * Fires AFTER messages are read from the DB and BEFORE they are sent to
     * the LLM. If a memory trigger flag is pending, append its contents as a
     * text part to the LAST message's parts so the model MUST see the
     * directive. This is the PM-022 fix — converts the previously-behavioral
     * consumption step into a mechanical one. The model still deletes the
     * flag after dispatching @memory (the plugin does NOT delete it).
     *
     * Appending to the last message's parts is cleaner than injecting a
     * synthetic message — the model sees the directive without a confusing
     * fake user turn.
     */
    "experimental.chat.messages.transform": async (input, output) => {
      try {
        if (process.env.MULAHAZAH_DEBUG) {
          console.log(`[mulahazah] transform fired, ${output.messages?.length ?? 0} messages`);
        }

        const flagContent = await fs.readFile(triggerFlag, "utf8");
        if (!flagContent || !flagContent.trim()) return;

        // Guard: messages array must exist and be non-empty
        if (!Array.isArray(output.messages) || output.messages.length === 0) return;

        const lastMessage = output.messages[output.messages.length - 1];
        if (!lastMessage || !Array.isArray(lastMessage.parts)) return;

        const directive =
          `[MEMORY TRIGGER PENDING] data/MEMORY_TRIGGER_FLAG exists:\n` +
          `---\n${flagContent.trim()}\n---\n` +
          `DISPATCH @memory NOW to record session observations, then delete the flag file.`;

        // Guard: lastMessage.info may be undefined. If so, generate IDs so the
        // pushed part still satisfies the TextPart schema (id, sessionID,
        // messageID, type, text). Without these fields the part fails schema
        // validation and never reaches the LLM.
        const sessionID = lastMessage.info?.sessionID ?? `ses_${randomUUID()}`;
        const messageID = lastMessage.info?.id ?? `msg_${randomUUID()}`;

        lastMessage.parts.push({
          id: `prt_${randomUUID()}`,
          sessionID,
          messageID,
          type: "text",
          text: directive,
          synthetic: true,
        });

        console.log("[mulahazah] injected memory trigger directive into last message parts");
      } catch (err) {
        // ENOENT = no flag pending — normal case, no log noise
        if (err.code !== "ENOENT") {
          console.error(`[mulahazah] experimental.chat.messages.transform hook failed: ${err.message}`);
        }
      }
    },

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
