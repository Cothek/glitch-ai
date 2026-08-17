// mulahazah.js - OpenCode plugin: per-session threshold-based memory trigger
//
// OBSERVATION MODEL (per-session state):
// Each chat session gets its own independent trigger state, keyed by sessionID.
// This prevents cross-session interference: session A's activity cannot trigger
// a directive in session B, and sub-agent tool calls (which run in their own
// sessionIDs) do not inflate the parent session's counter.
//
// TIME THRESHOLD (rolling window):
// The time threshold measures elapsed time since the LAST TRIGGER for that
// session (or since session start if never triggered). When the rolling window
// fires, lastTriggerTime resets to now — so it fires at most once per
// TIME_THRESHOLD_MS per session. This fixes the old bug where elapsed was
// measured from a never-resetting sessionStartTime, causing the time threshold
// to fire forever once 10 min passed.
//
// CONSUMPTION (experimental.chat.messages.transform):
// The plugin hooks `experimental.chat.messages.transform`, which fires AFTER
// messages are read from the DB and BEFORE they are sent to the LLM. If a
// per-session trigger flag exists, its contents are appended as a text part
// to the LAST message's parts — so the model is forced to see the directive
// and dispatch @memory. The transform hook derives sessionID from
// `output.messages[0].info.sessionID` (Message type has sessionID: string)
// and reads ONLY that session's flag file, preventing cross-session spam.
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
//   data/mulahazah/state.json       — per-session map keyed by sessionID
//   data/mulahazah/observations.jsonl — append-only log of every tool call
//
// Signal flags (per-session):
//   data/MEMORY_TRIGGER_FLAG.<sessionID> — short text summary, deleted after dispatch
//
// Thresholds (hardcoded):
//   50 tool calls OR 30 minutes rolling window → fire trigger (per session)
//   5 minute cooldown between triggers (per session)
//   24 hour stale reset per session entry
//
// Trigger phrases (case-insensitive scan of input.args):
//   "remember that", "i prefer", "from now on", "always do", "never do",
//   "i want", "make sure to", "don't forget"
//   → fire trigger immediately (subject to per-session cooldown)
//
// Install: Add to .opencode/opencode.json:
//   "plugin": [".opencode/plugins/mulahazah.js"]

import { promises as fs, readFileSync, writeFileSync, statSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const TOOL_CALL_THRESHOLD = 50;
const TIME_THRESHOLD_MS = 30 * 60 * 1000;
const COOLDOWN_MS = 5 * 60 * 1000;
const STALE_RESET_MS = 24 * 60 * 60 * 1000;
const OBSERVATIONS_MAX_BYTES = 5 * 1024 * 1024;
const OBSERVATIONS_MAX_LINES = 1000;

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

function createSessionEntry() {
  return {
    toolCallCount: 0,
    toolCounts: {},
    lastTriggerTime: null,
    sessionStartTime: Date.now(),
    // isDispatcher: true only for sessions that have successfully called task()
    // (i.e. parent agents that can delegate to sub-agents). Sub-agents have
    // task: deny in their agent definitions and cannot dispatch @memory, so
    // we must never inject a memory-trigger directive into their context.
    isDispatcher: false,
  };
}

export const MulahazahPlugin = async ({ directory }) => {
  const dataDir = join(directory, "data");
  const mulahazahDir = join(dataDir, "mulahazah");
  const stateFile = join(mulahazahDir, "state.json");
  const observationsFile = join(mulahazahDir, "observations.jsonl");

  try {
    await fs.mkdir(mulahazahDir, { recursive: true });
  } catch (err) {
    console.error(`[mulahazah] Failed to create directory: ${err.message}`);
  }

  const sessionStates = new Map();

  try {
    const raw = await fs.readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const now = Date.now();
      for (const [sid, entry] of Object.entries(parsed)) {
        if (!entry || typeof entry !== "object") continue;
        const e = {
          toolCallCount: typeof entry.toolCallCount === "number" ? entry.toolCallCount : 0,
          toolCounts: (entry.toolCounts && typeof entry.toolCounts === "object") ? entry.toolCounts : {},
          lastTriggerTime: typeof entry.lastTriggerTime === "number" ? entry.lastTriggerTime : null,
          sessionStartTime: typeof entry.sessionStartTime === "number" ? entry.sessionStartTime : now,
          // Backward-compatible: missing field defaults to false. On next save
          // it will be persisted.
          isDispatcher: entry.isDispatcher === true,
        };
        if (e.lastTriggerTime !== null && now - e.lastTriggerTime > STALE_RESET_MS) {
          e.toolCallCount = 0;
          e.toolCounts = {};
        }
        if (now - e.sessionStartTime > STALE_RESET_MS) {
          e.toolCallCount = 0;
          e.toolCounts = {};
          e.sessionStartTime = now;
          e.lastTriggerTime = null;
        }
        if (e.lastTriggerTime === null && e.toolCallCount > 1000) {
          e.toolCallCount = 0;
          e.toolCounts = {};
        }
        sessionStates.set(sid, e);
      }
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error(`[mulahazah] Failed to load state: ${err.message}`);
    }
  }

  // P1-3: Startup sweep — delete orphaned flag files. A flag is orphaned if:
  //   (a) its sessionID is not present in the loaded state map, OR
  //   (b) its file mtime is older than STALE_RESET_MS (24h).
  // This handles flags left behind by crashed sessions, flags from before
  // this fix, and any other stale state. Wrapped in try/catch — never throws.
  try {
    const entries = await fs.readdir(dataDir);
    const now = Date.now();
    for (const name of entries) {
      if (!name.startsWith("MEMORY_TRIGGER_FLAG.")) continue;
      const sid = name.slice("MEMORY_TRIGGER_FLAG.".length);
      if (!sid) continue;
      const flagPath = join(dataDir, name);
      let stale = !sessionStates.has(sid);
      if (!stale) {
        try {
          const st = await fs.stat(flagPath);
          if (now - st.mtimeMs > STALE_RESET_MS) stale = true;
        } catch {
          stale = true;
        }
      }
      if (stale) {
        try {
          await fs.unlink(flagPath);
          if (process.env.MULAHAZAH_DEBUG) {
            console.log(`[mulahazah] startup sweep: deleted orphaned flag for session ${sid}`);
          }
        } catch (unlinkErr) {
          if (unlinkErr.code !== "ENOENT") {
            console.error(`[mulahazah] startup sweep: failed to delete flag for ${sid}: ${unlinkErr.message}`);
          }
        }
      }
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error(`[mulahazah] startup sweep failed: ${err.message}`);
    }
  }

  function getSessionState(sessionID) {
    if (!sessionStates.has(sessionID)) {
      sessionStates.set(sessionID, createSessionEntry());
    }
    return sessionStates.get(sessionID);
  }

  async function saveState() {
    try {
      const now = Date.now();
      for (const [sid, entry] of sessionStates) {
        const lastActivity = entry.lastTriggerTime ?? entry.sessionStartTime;
        if (now - lastActivity > STALE_RESET_MS) {
          sessionStates.delete(sid);
          try {
            await fs.unlink(triggerFlagPath(sid));
          } catch (e) {
            console.warn(`[mulahazah] Failed to delete stale flag for session ${sid}: ${e.message}`);
          }
        }
      }
      const obj = Object.fromEntries(sessionStates);
      const tmpFile = stateFile + ".tmp";
      await fs.writeFile(tmpFile, JSON.stringify(obj, null, 2), "utf8");
      await fs.rename(tmpFile, stateFile);
    } catch (err) {
      console.error(`[mulahazah] Failed to save state: ${err.message}`);
    }
  }

  async function appendObservation(tool, sessionID) {
    try {
      const entry = {
        ts: new Date().toISOString(),
        tool,
        sessionID: sessionID || "unknown",
      };
      await fs.appendFile(observationsFile, JSON.stringify(entry) + "\n", "utf8");
      // Note: fire-and-forget appendObservation calls can interleave here; truncation is best-effort (observation log is approximate heuristic data, not authoritative).
      try {
        const stat = statSync(observationsFile);
        if (stat.size > OBSERVATIONS_MAX_BYTES) {
          const content = readFileSync(observationsFile, "utf8");
          const lines = content.split("\n").filter((l) => l.length > 0);
          const kept = lines.slice(-OBSERVATIONS_MAX_LINES);
          writeFileSync(observationsFile, kept.join("\n") + "\n", "utf8");
        }
      } catch (truncateErr) {
        console.error(`[mulahazah] Failed to truncate observations: ${truncateErr.message}`);
      }
    } catch (err) {
      console.error(`[mulahazah] Failed to append observation: ${err.message}`);
    }
  }

  function formatToolCounts(toolCounts) {
    const entries = Object.entries(toolCounts);
    if (entries.length === 0) return "none";
    entries.sort((a, b) => b[1] - a[1]);
    return entries.map(([tool, count]) => `${tool}=${count}`).join(", ");
  }

  function formatDuration(ms) {
    const totalMinutes = Math.floor(ms / 60000);
    if (totalMinutes < 60) return `${totalMinutes}min`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}min`;
  }

  function buildThresholdSummary(sessionState) {
    const anchor = sessionState.lastTriggerTime ?? sessionState.sessionStartTime;
    const elapsed = Date.now() - anchor;
    return [
      `Mulahazah threshold reached: ${sessionState.toolCallCount} tool calls / ${formatDuration(elapsed)} elapsed.`,
      `Tool breakdown: ${formatToolCounts(sessionState.toolCounts)}`,
      `Trigger @memory to record observations.`,
    ].join("\n");
  }

  function buildPhraseSummary(phrase, sessionState) {
    const anchor = sessionState.lastTriggerTime ?? sessionState.sessionStartTime;
    const elapsed = Date.now() - anchor;
    return [
      `Mulahazah trigger phrase detected: "${phrase}"`,
      `Tool calls since last trigger: ${sessionState.toolCallCount}`,
      `Session window: ${formatDuration(elapsed)}`,
      `Trigger @memory to record this preference/decision.`,
    ].join("\n");
  }

  function triggerFlagPath(sessionID) {
    return join(dataDir, `MEMORY_TRIGGER_FLAG.${sessionID}`);
  }

  async function fireTrigger(sessionID, summary) {
    try {
      const ss = sessionStates.get(sessionID);
      // P0-1: Gate triggers to dispatcher sessions only. Sub-agents (reviewer,
      // coder, explore, etc.) have task: deny in their agent definitions and
      // cannot dispatch @memory. If we wrote a flag for them, the transform
      // hook would inject "DISPATCH @memory" into their context on every
      // subsequent message, and they'd loop forever trying (and failing) to
      // dispatch. Their observations are already captured in observations.jsonl
      // and swept by the parent at compaction.
      if (!ss || !ss.isDispatcher) {
        console.log(`[mulahazah] skipping memory trigger for non-dispatcher session ${sessionID} (sub-agent) — observations already logged to observations.jsonl`);
        // Still reset counters so we don't re-fire in a tight loop on the
        // same session. lastTriggerTime advances to enforce cooldown.
        if (ss) {
          ss.lastTriggerTime = Date.now();
          ss.toolCallCount = 0;
          ss.toolCounts = {};
        }
        await saveState();
        return;
      }

      const flagPath = triggerFlagPath(sessionID);
      await fs.writeFile(flagPath, summary + "\n", "utf8");
      ss.lastTriggerTime = Date.now();
      ss.toolCallCount = 0;
      ss.toolCounts = {};
      await saveState();
      if (process.env.MULAHAZAH_DEBUG) {
        console.log(`[mulahazah] threshold reached for session ${sessionID}, flag written`);
      }
    } catch (err) {
      console.error(`[mulahazah] Failed to write trigger flag: ${err.message}`);
    }
  }

  function isCooldownElapsed(sessionState) {
    if (sessionState.lastTriggerTime === null) return true;
    return Date.now() - sessionState.lastTriggerTime >= COOLDOWN_MS;
  }

  function detectTriggerPhrase(args) {
    if (!args) return null;
    let argStr;
    try {
      if (typeof args === "string") {
        argStr = args;
      } else {
        argStr = JSON.stringify(args);
      }
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
    "experimental.chat.messages.transform": async (input, output) => {
      try {
        if (process.env.MULAHAZAH_DEBUG) {
          console.log(`[mulahazah] transform fired, ${output.messages?.length ?? 0} messages`);
        }

        if (!Array.isArray(output.messages) || output.messages.length === 0) return;

        const lastMessage = output.messages[output.messages.length - 1];
        const sessionID = lastMessage?.info?.sessionID ?? output.messages[0]?.info?.sessionID;
        if (!sessionID) {
          if (process.env.MULAHAZAH_DEBUG) {
            console.log("[mulahazah] transform: no sessionID on messages, skipping");
          }
          return;
        }

        const flagPath = triggerFlagPath(sessionID);
        let flagContent;
        try {
          flagContent = await fs.readFile(flagPath, "utf8");
        } catch (err) {
          if (err.code === "ENOENT") return;
          throw err;
        }
        if (!flagContent || !flagContent.trim()) return;

        if (!lastMessage || !Array.isArray(lastMessage.parts)) return;

        // P0-1 (defense in depth): if a flag exists for a session that is NOT
        // a dispatcher (e.g. a stale flag left from before this fix, or an
        // edge case where fireTrigger's gate was bypassed), DELETE the flag
        // instead of injecting the dispatch directive. This guarantees a
        // sub-agent can never be told to dispatch.
        const ss = sessionStates.get(sessionID);
        if (!ss || !ss.isDispatcher) {
          try {
            await fs.unlink(flagPath);
            console.log(`[mulahazah] deleted stale trigger flag for non-dispatcher session ${sessionID}`);
          } catch (unlinkErr) {
            if (unlinkErr.code !== "ENOENT") {
              console.error(`[mulahazah] Failed to delete stale flag: ${unlinkErr.message}`);
            }
          }
          return;
        }

        const msgSessionID = lastMessage.info?.sessionID ?? sessionID;
        const messageID = lastMessage.info?.id ?? `msg_${randomUUID()}`;

        // P1-2: Hardened directive — safe if it ever reaches an incapable
        // session. Sub-agents see the warning and know to skip dispatch and
        // include observations in their final report instead.
        const directive =
          `[MEMORY TRIGGER PENDING] data/MEMORY_TRIGGER_FLAG.${sessionID} exists:\n` +
          `---\n${flagContent.trim()}\n---\n` +
          `⚠️ IMPORTANT: If you are a SUB-AGENT and CANNOT call task()/@memory (task denied): DO NOT attempt to dispatch. Do NOT try to delete this flag with file tools if you cannot. Instead, include any notable observations in your final report to the parent agent, then continue your task normally.\n` +
          `If you CAN dispatch: dispatch @memory to record session observations, then delete the flag file (data/MEMORY_TRIGGER_FLAG.${sessionID}).`;

        lastMessage.parts.push({
          id: `prt_${randomUUID()}`,
          sessionID: msgSessionID,
          messageID,
          type: "text",
          text: directive,
          synthetic: true,
        });

        console.log(`[mulahazah] injected memory trigger directive for session ${sessionID}`);
      } catch (err) {
        if (err.code !== "ENOENT") {
          console.error(`[mulahazah] experimental.chat.messages.transform hook failed: ${err.message}`);
        }
      }
    },

    "tool.execute.after": async (input, output) => {
      const tool = input.tool || "unknown";
      const sessionID = input.sessionID || "unknown";

      const ss = getSessionState(sessionID);

      ss.toolCallCount++;
      ss.toolCounts[tool] = (ss.toolCounts[tool] || 0) + 1;

      appendObservation(tool, sessionID).catch((err) => console.error(`[mulahazah] background task failed: ${err.message}`));

      // P0-1: Mark session as a dispatcher if it has successfully called task().
      // Only the delegating parent agent can successfully call task — sub-agents
      // have task: deny and their attempts surface as tool name "invalid" in the
      // observation log. We check for an error on the output to distinguish a
      // real delegation from a denied attempt.
      if (tool === "task" && output && !output.error) {
        if (!ss.isDispatcher) {
          ss.isDispatcher = true;
          if (process.env.MULAHAZAH_DEBUG) {
            console.log(`[mulahazah] session ${sessionID} marked as dispatcher (successful task() call)`);
          }
        }
      }

      // Note: counters persist only on next trigger or every-10th-call save; cooldown-window increments are in-memory only (acceptable — heuristic data).
      if (!isCooldownElapsed(ss)) {
        return;
      }

      const phrase = detectTriggerPhrase(input.args);
      if (phrase) {
        if (process.env.MULAHAZAH_DEBUG) {
          console.log(`[mulahazah] trigger phrase detected: "${phrase}" in session ${sessionID}`);
        }
        await fireTrigger(sessionID, buildPhraseSummary(phrase, ss));
        return;
      }

      const anchor = ss.lastTriggerTime ?? ss.sessionStartTime;
      const elapsed = Date.now() - anchor;
      const hitCallThreshold = ss.toolCallCount >= TOOL_CALL_THRESHOLD;
      const hitTimeThreshold = elapsed >= TIME_THRESHOLD_MS;

      if (hitCallThreshold || hitTimeThreshold) {
        await fireTrigger(sessionID, buildThresholdSummary(ss));
        return;
      }

      if (ss.toolCallCount % 10 === 0) {
        await saveState();
      }
    },
  };
};
