// stuck-detector.js — OpenCode plugin: detects stuck patterns in tool calls
//
// Per-session model:
//   - Each sessionID gets its own toolHistory (Map keyed by sessionID).
//   - Each session gets its own signal file: data/.stuck-signal.<sessionID>.json
//   - A global mirror data/.stuck-signal.json reflects the most recently
//     written active signal so the parent agent (which reads the global file
//     per R21) can see that a sub-agent is stuck.
//
// Detection rules (per session):
//   1. tool_repetition: 3+ same tool (excluding progress tools) with >75%-similar
//      args in last 8. Excluded: edit, write, bash, read, glob, grep, task,
//      todowrite, skill, question (these are genuine progress or have dedicated rules).
//      webfetch uses exact-URL matching (different URL = never similar) and a
//      raised threshold of 5, so bulk sweeps over distinct URLs never trip it.
//   2. error_cascade: 3+ consecutive errors (invalid counts as an error)
//   3. command_repetition: same bash command 2+ times in last 8 (first 60 chars)
//   4. readonly_repetition: 6+ CONSECUTIVE same readonly tool (read/glob/grep)
//      with IDENTICAL fingerprints (filePath for read/glob, pattern for grep).
//      Different files/patterns NEVER count as similar.
//   5. permission_loop: 2+ consecutive "invalid" tool calls (denied dispatch)
//
// Similarity:
//   - read/glob: exact match on filePath (different files = never similar)
//   - grep: exact match on pattern
//   - webfetch: exact match on url (different URLs = never similar; format ignored)
//   - task: fingerprint on subagent_type + description (or first 40 chars of prompt)
//   - generic: JSON.stringify(args).slice(0,80), threshold >0.75
//
// Unstuck (clear signal) ONLY on genuine progress by THAT session:
//   - successful write / edit
//   - successful bash with `git commit` in args.command
//   - successful task (dispatch completing = progress)
//   - successful todowrite after being flagged
// Never clear on read/glob/grep (that was the bug that wiped the signal).
//
// Signal freshness:
//   Signals older than SIGNAL_TTL_MS (15 min) are stale. The transform hook
//   skips injection for stale signals and deletes them. sweepStaleSignals()
//   runs at plugin init to clean up any leftover stale files.
//
// Signal visibility:
//   experimental.chat.messages.transform injects a synthetic text part into
//   the last message for the current sessionID when its per-session signal
//   file exists and is fresh, so the stuck agent is FORCED to see the directive.
//   Sub-agents get a softer directive: self-check before stopping.

import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

// --- Pure helpers ---

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function genericFingerprint(args) {
  if (!args) return "";
  try {
    return JSON.stringify(args).slice(0, 80);
  } catch {
    return "";
  }
}

function toolFingerprint(tool, args) {
  if (!args) return "";
  if (tool === "read" || tool === "glob") {
    return args.filePath || "";
  }
  if (tool === "grep") {
    return args.pattern || "";
  }
  if (tool === "webfetch") {
    // URL-only fingerprint: the `format` param is intentionally ignored so that
    // the same endpoint fetched with a different representation is still
    // recognized as a repeat. Different URLs must NEVER look similar (see
    // fingerprintsMatch) — this is what kills bulk-sweep false positives where
    // many distinct URLs share a long common prefix (e.g. RDAP domain checks).
    return args.url || "";
  }
  if (tool === "task") {
    const subagent = args.subagent_type || args.subagent || "";
    const desc = args.description || "";
    if (subagent || desc) return `${subagent}|${desc}`.slice(0, 80);
    return (args.prompt || "").trim().slice(0, 40);
  }
  return genericFingerprint(args);
}

// Tools whose fingerprints use EXACT-match semantics (different fingerprint =
// never similar), mirroring the readonly exact-match fix from 2026-08-09.
// webfetch joins this set: a URL is the natural identity of a fetch, and
// Levenshtein over URL strings produces false positives on shared prefixes.
const EXACT_FINGERPRINT_TOOLS = new Set(["read", "glob", "grep", "webfetch"]);

function readonlyFingerprintsMatch(tool, fp1, fp2) {
  if (!fp1 && !fp2) return true;
  if (!fp1 || !fp2) return false;
  return fp1 === fp2;
}

function genericSimilar(a, b, threshold) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return true;
  return (1 - levenshtein(a, b) / maxLen) > threshold;
}

// --- Exported pure detection function ---

const PROGRESS_TOOLS = new Set([
  "edit", "write", "bash", "read", "glob", "grep",
  "task", "todowrite", "skill", "question",
]);

const READONLY_TOOLS = new Set(["read", "glob", "grep"]);

// Per-tool tool_repetition thresholds. Fetch-like tools (webfetch) tolerate
// small same-endpoint repeats within a batched sweep, so their threshold is
// raised from the default 3 to 5. Other tools keep the default. This does NOT
// weaken detection for genuine loops: 5+ identical-URL fetches in 8 calls is
// still a tight loop; a bulk sweep over distinct URLs never reaches the count
// on a single fingerprint anyway (exact-match makes different URLs dissimilar).
const TOOL_REPETITION_THRESHOLDS = {
  webfetch: 5,
};

function detectStuck(history, options = {}) {
  const STUCK_THRESHOLD = options.STUCK_THRESHOLD ?? 3;
  const ERROR_THRESHOLD = options.ERROR_THRESHOLD ?? 3;
  const READONLY_THRESHOLD = options.READONLY_THRESHOLD ?? 6;
  const INVALID_THRESHOLD = options.INVALID_THRESHOLD ?? 2;
  const GENERIC_SIMILARITY_THRESHOLD = options.GENERIC_SIMILARITY_THRESHOLD ?? 0.75;

  if (history.length < 4) return null;

  const recent = history.slice(-8);

  // Check 4 (priority): permission_loop — 2+ consecutive denied calls.
  const tail = history.slice(-INVALID_THRESHOLD);
  if (tail.length >= INVALID_THRESHOLD && tail.every(e => {
    const t = e.tool || "";
    if (t === "invalid") return true;
    if (t === "task" && e.error) return true;
    return false;
  })) {
    return {
      type: "permission_loop",
      count: tail.length,
      detail: `${tail.length} consecutive denied tool calls. The agent is repeatedly attempting tools it is not allowed to use, or a denied dispatch (task) attempt.`,
    };
  }

  // Check 1: tool_repetition — 3+ same non-excluded tool with similar args
  const toolCounts = {};
  const toolFps = {};
  for (const entry of recent) {
    const tool = entry.tool || "unknown";
    if (PROGRESS_TOOLS.has(tool)) continue;
    toolCounts[tool] = (toolCounts[tool] || 0) + 1;
    if (!toolFps[tool]) toolFps[tool] = [];
    const fp = toolFingerprint(tool, entry.args);
    if (fp) toolFps[tool].push(fp);
  }

  for (const [tool, count] of Object.entries(toolCounts)) {
    const threshold = TOOL_REPETITION_THRESHOLDS[tool] ?? STUCK_THRESHOLD;
    if (count < threshold) continue;
    const fps = toolFps[tool] || [];
    if (fps.length < threshold) continue;

    const useExact = EXACT_FINGERPRINT_TOOLS.has(tool);
    let similarCount = 0;
    for (let i = 0; i < fps.length; i++) {
      for (let j = i + 1; j < fps.length; j++) {
        const similar = useExact
          ? readonlyFingerprintsMatch(tool, fps[i], fps[j])
          : genericSimilar(fps[i], fps[j], GENERIC_SIMILARITY_THRESHOLD);
        if (similar) similarCount++;
      }
    }
    if (similarCount >= 1) {
      return {
        type: "tool_repetition",
        tool,
        count,
        similarCalls: similarCount + 1,
        detail: `${tool} called ${count} times in last ${recent.length} calls with similar arguments`,
      };
    }
  }

  // Check 5: readonly_repetition — 6+ CONSECUTIVE same readonly tool,
  // ALL with fingerprints identical to the FIRST call.
  const tailN = history.slice(-READONLY_THRESHOLD);
  if (tailN.length >= READONLY_THRESHOLD) {
    const tool = tailN[0].tool || "";
    if (READONLY_TOOLS.has(tool) && tailN.every(e => (e.tool || "") === tool)) {
      const firstFp = toolFingerprint(tool, tailN[0].args);
      const allMatchFirst = tailN.every(e => {
        const fp = toolFingerprint(tool, e.args);
        return readonlyFingerprintsMatch(tool, firstFp, fp);
      });
      if (allMatchFirst) {
        return {
          type: "readonly_repetition",
          tool,
          count: tailN.length,
          detail: `${tool} called ${tailN.length} consecutive times with identical arguments (tight read-only loop)`,
        };
      }
    }
  }

  // Check 2: error_cascade — 3+ consecutive errors
  const lastFew = recent.slice(-ERROR_THRESHOLD);
  if (lastFew.length >= ERROR_THRESHOLD && lastFew.every(e => e.error)) {
    return {
      type: "error_cascade",
      count: lastFew.length,
      detail: `${lastFew.length} consecutive tool calls returned errors`,
    };
  }

  // Check 3: command_repetition — same bash command 2+ times
  const bashCommands = recent.filter(e => e.tool === "bash");
  if (bashCommands.length >= 3) {
    const cmdTexts = bashCommands.map(e => (e.args || {}).command || "");
    const cmdCounts = {};
    for (const cmd of cmdTexts) {
      const shortCmd = cmd.slice(0, 60);
      cmdCounts[shortCmd] = (cmdCounts[shortCmd] || 0) + 1;
    }
    for (const [cmd, count] of Object.entries(cmdCounts)) {
      if (count >= 2 && cmd.length > 5) {
        return {
          type: "command_repetition",
          command: cmd.slice(0, 80),
          count,
          detail: `bash command "${cmd.slice(0, 60)}..." repeated ${count} times`,
        };
      }
    }
  }

  return null;
}

// --- Signal freshness ---

const SIGNAL_TTL_MS = 15 * 60 * 1000;

function sweepStaleSignals(dataDir, ttlMs) {
  const now = Date.now();
  let swept = 0;
  try {
    const files = readdirSync(dataDir);
    for (const file of files) {
      if (!file.startsWith(".stuck-signal") || !file.endsWith(".json")) continue;
      const fullPath = join(dataDir, file);
      try {
        const raw = readFileSync(fullPath, "utf-8");
        const parsed = JSON.parse(raw);
        const detectedAt = new Date(parsed.detected_at).getTime();
        if (isNaN(detectedAt) || (now - detectedAt) > ttlMs) {
          unlinkSync(fullPath);
          swept++;
        }
      } catch {}
    }
  } catch {}
  if (swept > 0) {
    console.log(`[stuck-detector] 🧹 Swept ${swept} stale signal file(s) on init`);
  }
}

function isSignalFresh(signalPath, ttlMs) {
  try {
    const raw = readFileSync(signalPath, "utf-8");
    const parsed = JSON.parse(raw);
    const detectedAt = new Date(parsed.detected_at).getTime();
    if (isNaN(detectedAt)) return false;
    return (Date.now() - detectedAt) <= ttlMs;
  } catch {
    return false;
  }
}

// --- Plugin ---

export const StuckDetectorPlugin = async ({ directory }) => {
  const MAX_HISTORY = 20;

  const dataDir = join(directory, "data");
  const GLOBAL_SIGNAL_FILE = join(dataDir, ".stuck-signal.json");

  try {
    mkdirSync(dataDir, { recursive: true });
  } catch {}

  sweepStaleSignals(dataDir, SIGNAL_TTL_MS);

  const histories = new Map();

  function getHistory(sessionID) {
    if (!histories.has(sessionID)) {
      histories.set(sessionID, []);
    }
    return histories.get(sessionID);
  }

  function sessionSignalPath(sessionID) {
    return join(dataDir, `.stuck-signal.${sessionID}.json`);
  }

  function writeSignal(sessionID, signal) {
    try {
      const payload = {
        detected_at: new Date().toISOString(),
        stuck: true,
        sessionID,
        type: signal.type,
        detail: signal.detail,
        tool: signal.tool || signal.command || "unknown",
        recommendation: "You appear to be stuck in a loop. Load skill(\"breakthrough\") to reframe the problem using a different approach.",
      };
      const content = JSON.stringify(payload, null, 2);

      writeFileSync(sessionSignalPath(sessionID), content, "utf-8");
      writeFileSync(GLOBAL_SIGNAL_FILE, content, "utf-8");

      console.log(`[stuck-detector] ⚠️ Stuck detected (session=${sessionID}): ${signal.type} — ${signal.detail}`);
    } catch (e) {
      console.error(`[stuck-detector] Failed to write signal: ${e.message}`);
    }
  }

  function clearSignal(sessionID) {
    try {
      const sp = sessionSignalPath(sessionID);
      if (existsSync(sp)) {
        unlinkSync(sp);
      }
      try {
        if (existsSync(GLOBAL_SIGNAL_FILE)) {
          const raw = readFileSync(GLOBAL_SIGNAL_FILE, "utf-8");
          const parsed = JSON.parse(raw);
          if (parsed && parsed.sessionID === sessionID) {
            unlinkSync(GLOBAL_SIGNAL_FILE);
          }
        }
      } catch {}
      console.log(`[stuck-detector] ✅ Unstuck detected (session=${sessionID}) — cleared signal`);
    } catch (e) {
      console.error(`[stuck-detector] Failed to clear signal: ${e.message}`);
    }
  }

  function isGenuineProgress(tool, args, hasError) {
    if (hasError) return false;
    if (tool === "write" || tool === "edit") return true;
    if (tool === "task") return true;
    if (tool === "todowrite") return true;
    if (tool === "bash") {
      const cmd = (args && args.command) || "";
      if (typeof cmd === "string" && /\bgit\s+commit\b/.test(cmd)) return true;
    }
    return false;
  }

  return {
    "tool.execute.after": async (input, output) => {
      try {
        const now = Date.now();
        const tool = input.tool || "unknown";
        const args = input.args || {};
        const sessionID = input.sessionID || "unknown";

        const hasError = output.error !== undefined && output.error !== null
          || (output.result && typeof output.result === "string" && (
            /^Error:/m.test(output.result) ||
            /^error:/m.test(output.result) ||
            /^\s*Command failed/im.test(output.result) ||
            /^\s*FAILED/im.test(output.result)
          ));

        const history = getHistory(sessionID);
        history.push({
          tool,
          args,
          error: hasError,
          timestamp: now,
        });

        while (history.length > MAX_HISTORY) {
          history.shift();
        }

        if (isGenuineProgress(tool, args, hasError)) {
          if (existsSync(sessionSignalPath(sessionID))) {
            clearSignal(sessionID);
          }
        }

        if (history.length % 2 === 0) {
          const signal = detectStuck(history);
          if (signal && !existsSync(sessionSignalPath(sessionID))) {
            writeSignal(sessionID, signal);
          }
        }
      } catch (e) {
        console.error(`[stuck-detector] tool.execute.after failed: ${e.message}`);
      }
    },

    "tool.execute.before": async (input, output) => {
      try {
        const sessionID = input.sessionID || "unknown";
        if (input.tool === "bash" && existsSync(sessionSignalPath(sessionID))) {
          const cmd = (input.args || {}).command || "";
          const history = getHistory(sessionID);
          const recentBash = history.filter(e => e.tool === "bash").slice(-3);
          const similarCmd = recentBash.some(e => {
            const prevCmd = (e.args || {}).command || "";
            return prevCmd.slice(0, 40) === cmd.slice(0, 40);
          });

          if (similarCmd) {
            console.warn(`[stuck-detector] ⚠️ Warning (session=${sessionID}): Command "${cmd.slice(0, 60)}..." was already executed recently. If stuck, try skill("breakthrough") for a fresh approach.`);
          }
        }
      } catch (e) {
        console.error(`[stuck-detector] tool.execute.before failed: ${e.message}`);
      }
    },

    "experimental.chat.messages.transform": async (input, output) => {
      try {
        if (!Array.isArray(output.messages) || output.messages.length === 0) return;

        const lastMessage = output.messages[output.messages.length - 1];
        const sessionID = lastMessage?.info?.sessionID ?? output.messages[0]?.info?.sessionID;
        if (!sessionID) return;

        const sp = sessionSignalPath(sessionID);
        if (!existsSync(sp)) return;

        if (!isSignalFresh(sp, SIGNAL_TTL_MS)) {
          try { unlinkSync(sp); } catch {}
          try {
            if (existsSync(GLOBAL_SIGNAL_FILE)) {
              const raw = readFileSync(GLOBAL_SIGNAL_FILE, "utf-8");
              const parsed = JSON.parse(raw);
              if (parsed && parsed.sessionID === sessionID) {
                unlinkSync(GLOBAL_SIGNAL_FILE);
              }
            }
          } catch {}
          return;
        }

        if (!lastMessage || !Array.isArray(lastMessage.parts)) return;

        let signal;
        try {
          signal = JSON.parse(readFileSync(sp, "utf-8"));
        } catch {
          return;
        }
        if (!signal || !signal.stuck) return;

        const msgSessionID = lastMessage.info?.sessionID ?? sessionID;
        const messageID = lastMessage.info?.id ?? `msg_${randomUUID()}`;

        const directive =
          `⚠️ STUCK DETECTED (type: ${signal.type}): ${signal.detail}\n` +
          `If you are a SUB-AGENT: pause and check — are you repeating the SAME failing action with no progress? ` +
          `If yes (genuinely stuck), stop and return partial findings plus a note about this blocker to the parent agent. ` +
          `If you are making progress (e.g., reading different files, dispatching different tasks, sequential successful steps), ` +
          `this is likely a false positive — CONTINUE your task normally.\n` +
          `If you are the primary agent: load skill("breakthrough") only if you truly cannot make progress.`;

        lastMessage.parts.push({
          id: `prt_${randomUUID()}`,
          sessionID: msgSessionID,
          messageID,
          type: "text",
          text: directive,
          synthetic: true,
        });

        console.log(`[stuck-detector] injected stuck directive for session ${sessionID}`);
      } catch (e) {
        console.error(`[stuck-detector] experimental.chat.messages.transform failed: ${e.message}`);
      }
    },
  };
};

// Expose detectStuck as a property for test access (single-export pattern).
StuckDetectorPlugin.detectStuck = detectStuck;
