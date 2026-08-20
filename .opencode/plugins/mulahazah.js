// mulahazah.js - OpenCode plugin: per-session memory trigger
//
// OBSERVATION MODEL (per-session state):
// Each chat session gets its own independent trigger state, keyed by sessionID.
// This prevents cross-session interference: session A's activity cannot trigger
// a directive in session B, and sub-agent tool calls (which run in their own
// sessionIDs) do not inflate the parent session's counter.
//
// TRIGGER MODEL (two independent paths, both measured from the LAST trigger —
// i.e. the last memory write, since the trigger leads directly to the write):
//
//   1. HEARTBEAT (15 min): a background timer checks every 60s and fires once
//      15 minutes after the last write IF at least 1 tool call happened since.
//      This is the guaranteed per-session cadence: active sessions are captured
//      every 15 min; a session that goes quiet fires once at the 15-min mark
//      (the session-end capture), then stops until new activity. A truly dead
//      session's flag is swept by the 24h stale reset.
//
//   2. TOKEN BURST (1M new tokens): fires when TOKEN_THRESHOLD new tokens
//      (input + output + reasoning) have accumulated since the last write, even
//      under the 30-min window. Catches token-heavy bursts (heavy parallel
//      agent dispatch) so a session that "did a lot" in LLM compute is captured
//      without waiting for the clock. Token totals are read from the OpenCode
//      SQLite DB (session table) via node:sqlite — the same data source the
//      TUI/web UI uses. If the DB is unavailable (open fails, or the runtime
//      node lacks node:sqlite), the heartbeat still works; token bursts are
//      skipped until the DB is readable again.
//
// Both paths reset lastTriggerTime + lastTokenBaseline in fireTrigger, so they
// never double-fire: whichever comes first restarts the window.
//
// CONSUMPTION (experimental.chat.messages.transform):
// The plugin hooks `experimental.chat.messages.transform`, which fires AFTER
// messages are read from the DB and BEFORE they are sent to the LLM. If a
// per-session trigger flag exists, its contents are appended as a text part
// to the LAST message's parts — so the model is forced to see the directive
// and dispatch @memory (or self-fulfill in omni mode). The transform hook
// derives sessionID from `output.messages[0].info.sessionID` (Message type has
// sessionID: string) and reads ONLY that session's flag file, preventing
// cross-session spam.
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
// Trigger paths (hardcoded, see scripts/lib/mulahazah-helpers.mjs):
//   15 min heartbeat (fires once 15 min after last write, regardless of tool calls)
//   OR 1M new tokens since last write (input+output+reasoning, from the DB)
//   OR trigger phrase detected in tool args (immediate, subject to 5-min cooldown)
//   24 hour stale reset per session entry
//
// NOTE (2026-08-18): thresholds raised from 50 calls / 30 min to 200 calls /
// 4 hours to cut @memory dispatch frequency (~19/day → ~3-5/day). Trigger
// phrases still fire immediately — preferences/decisions are captured in
// real time; only routine session observations are batched.
// NOTE (2026-08-18): time threshold now gated on TIME_THRESHOLD_MIN_CALLS (20)
// — a session with 1 tool call in 4h38m (observed live) must NOT fire.
// NOTE (2026-08-19): the call-count / time thresholds are REPLACED by the
// 15-min heartbeat + 1M-token burst model (heartbeat interval set to 15 min
// per Troy 2026-08-19). Session-end capture is implicit: a quiet session fires
// once at the 15-min mark after its last write, even with zero tool calls.
// glitch-omni sessions (task: deny, self-fulfilling) are now flag-capable —
// they are detected via the DB agent column.
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
import {
  HEARTBEAT_INTERVAL_MS,
  TIMER_CHECK_MS,
  TOKEN_THRESHOLD,
  COOLDOWN_MS,
  STALE_RESET_MS,
  createSessionEntry,
  normalizeEntry,
  formatTokens,
  formatDuration,
  formatToolCounts,
  evaluateTrigger,
  readSessionTokens,
  readSessionAgent,
  isOmniSession,
} from "../../scripts/lib/mulahazah-helpers.mjs";

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

// Double-start guard (PM-033 pattern): if the plugin factory runs twice in one
// process, only ONE heartbeat timer may exist. The first timer owns the checks.
const HEARTBEAT_TIMER_KEY = "__mulahazah_heartbeat_timer__";

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
      for (const [sid, rawEntry] of Object.entries(parsed)) {
        const e = normalizeEntry(rawEntry, now);
        if (e.lastTriggerTime !== null && now - e.lastTriggerTime > STALE_RESET_MS) {
          e.toolCallCount = 0;
          e.toolCounts = {};
          e.lastTokenBaseline = null;
        }
        if (now - e.sessionStartTime > STALE_RESET_MS) {
          e.toolCallCount = 0;
          e.toolCounts = {};
          e.sessionStartTime = now;
          e.lastTriggerTime = null;
          e.lastTokenBaseline = null;
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

  /** Resolve agent from DB once per session; mark glitch-omni as flag-capable.
   *  Returns true if the agent was resolved on THIS call (state changed). */
  function markFlagCapability(sessionID, ss) {
    if (ss.agent !== null) return false; // already resolved
    ss.agent = readSessionAgent(sessionID);
    if (isOmniSession(ss.agent)) {
      ss.isDispatcher = true;
      if (process.env.MULAHAZAH_DEBUG) {
        console.log(`[mulahazah] session ${sessionID} marked flag-capable (glitch-omni self-fulfillment)`);
      }
    }
    return true;
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
            // ENOENT is the EXPECTED case — the flag was already consumed
            // (deleted by @memory after the write, or never written). Only
            // surface real errors; a missing flag is not one.
            if (e.code !== "ENOENT") {
              console.warn(`[mulahazah] Failed to delete stale flag for session ${sid}: ${e.message}`);
            }
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

  function buildTriggerSummary(sessionState, reason) {
    return [
      `Mulahazah memory trigger: ${reason}.`,
      `Tool calls since last write: ${sessionState.toolCallCount}. Tool breakdown: ${formatToolCounts(sessionState.toolCounts)}`,
      `Session window since last write: ${formatDuration(Date.now() - (sessionState.lastTriggerTime ?? sessionState.sessionStartTime))}.`,
      `Trigger @memory to record session observations (or self-fulfill per your mode).`,
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
      // P0-1: Gate triggers to flag-capable sessions only (dispatchers, or
      // glitch-omni self-fulfillers). Sub-agents (reviewer, coder, explore,
      // etc.) have task: deny and cannot dispatch @memory — and they are NOT
      // glitch-omni, so they never become flag-capable. If we wrote a flag for
      // them, the transform hook would inject "DISPATCH @memory" into their
      // context on every subsequent message, and they'd loop forever trying
      // (and failing) to dispatch. Their observations are already captured in
      // observations.jsonl and swept by the parent at compaction.
      if (!ss || !ss.isDispatcher) {
        console.log(`[mulahazah] skipping memory trigger for non-capable session ${sessionID} (sub-agent) — observations already logged to observations.jsonl`);
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

      // Reset BEFORE the async write so a concurrent timer tick + hook call
      // cannot both pass the threshold in the same window and double-write.
      ss.lastTriggerTime = Date.now();
      ss.toolCallCount = 0;
      ss.toolCounts = {};
      // Refresh the token baseline so the next window measures from THIS write.
      const tokens = readSessionTokens(sessionID);
      if (tokens) {
        ss.lastTokenBaseline = tokens;
        ss.lastTokenReadTime = Date.now();
      }

      const flagPath = triggerFlagPath(sessionID);
      await fs.writeFile(flagPath, summary + "\n", "utf8");
      await saveState();
      if (process.env.MULAHAZAH_DEBUG) {
        console.log(`[mulahazah] trigger fired for session ${sessionID}, flag written`);
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

  // Background heartbeat: checks every TIMER_CHECK_MS for sessions that crossed
  // the 30-min window or the token-burst threshold since their last write.
  async function runHeartbeatCheck() {
    const now = Date.now();
    let dirty = false;
    for (const [sid, ss] of sessionStates) {
      if (!ss) continue;
      const lastActivity = ss.lastTriggerTime ?? ss.sessionStartTime;
      if (now - lastActivity > STALE_RESET_MS) continue; // stale — saveState cleans it

      const agentResolved = markFlagCapability(sid, ss);
      if (agentResolved) dirty = true;
      if (!ss.isDispatcher) continue;

      // Token data: initialize the baseline on first observation, else read
      // fresh totals to compute the burst delta. DB reads are cheap point
      // lookups; failures return null and are retried next tick.
      let tokens = null;
      if (ss.lastTokenBaseline === null) {
        tokens = readSessionTokens(sid);
        if (tokens) {
          ss.lastTokenBaseline = tokens;
          ss.lastTokenReadTime = now;
          dirty = true;
        }
      } else {
        tokens = readSessionTokens(sid);
      }

      const hit = evaluateTrigger(ss, now, tokens);
      if (hit && isCooldownElapsed(ss)) {
        await fireTrigger(sid, buildTriggerSummary(ss, hit.reason));
        dirty = true;
      }
    }
    // Persist only when something changed (agent resolved, baseline initialized,
    // or a trigger fired) — avoids a disk write every 60s tick on idle sessions.
    if (dirty) await saveState();
  }

  function startHeartbeatTimer() {
    if (globalThis[HEARTBEAT_TIMER_KEY]) return;
    globalThis[HEARTBEAT_TIMER_KEY] = setInterval(() => {
      runHeartbeatCheck().catch((err) =>
        console.error(`[mulahazah] heartbeat check failed: ${err.message}`)
      );
    }, TIMER_CHECK_MS);
    if (globalThis[HEARTBEAT_TIMER_KEY].unref) {
      globalThis[HEARTBEAT_TIMER_KEY].unref(); // never keep the process alive
    }
    if (process.env.MULAHAZAH_DEBUG) {
      console.log(`[mulahazah] heartbeat timer started (${TIMER_CHECK_MS}ms cadence)`);
    }
  }

  startHeartbeatTimer();

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
        // flag-capable (e.g. a stale flag left from before this fix, or an
        // edge case where fireTrigger's gate was bypassed), DELETE the flag
        // instead of injecting the directive. This guarantees a sub-agent can
        // never be told to dispatch.
        const ss = sessionStates.get(sessionID);
        if (!ss || !ss.isDispatcher) {
          try {
            await fs.unlink(flagPath);
            console.log(`[mulahazah] deleted stale trigger flag for non-capable session ${sessionID}`);
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
          `If you CAN dispatch: dispatch @memory to record session observations, then delete the flag file (data/MEMORY_TRIGGER_FLAG.${sessionID}).\n` +
          `If you are glitch-omni (self-fulfillment mode, task denied but memory-capable): record the observations yourself per the save-memory skill, then delete the flag file (data/MEMORY_TRIGGER_FLAG.${sessionID}).`;

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

      // P0-1: Mark session as flag-capable if it has successfully called task().
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

      // Omni-mode primary sessions (glitch-omni) have task: deny, so they never
      // get marked via a successful task() call. They self-fulfill memory flags,
      // so detect them via the DB agent column (once, cached in ss.agent).
      markFlagCapability(sessionID, ss);

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

      // Heartbeat + token-burst thresholds are evaluated by the background
      // timer (runHeartbeatCheck, every TIMER_CHECK_MS). No in-hook check
      // needed — the timer fires within 60s of any threshold being crossed.

      if (ss.toolCallCount % 10 === 0) {
        await saveState();
      }
    },
  };
};
