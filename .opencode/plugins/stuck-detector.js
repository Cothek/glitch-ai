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
//   1. tool_repetition: 3+ same non-readonly tool with >60%-similar args in last 8
//   2. error_cascade: 3+ consecutive errors (invalid counts as an error)
//   3. command_repetition: same bash command 2+ times in last 8
//   4. readonly_repetition: 6+ CONSECUTIVE same readonly tool (read/glob/grep)
//      with >60%-similar args in that session's recent history
//   5. permission_loop: 2+ consecutive "invalid" tool calls (denied dispatch)
//
// Unstuck (clear signal) ONLY on genuine progress by THAT session:
//   - successful write / edit
//   - successful bash with `git commit` in args.command
//   - successful task (dispatch completing = progress)
//   - successful todowrite after being flagged
// Never clear on read/glob/grep (that was the bug that wiped the signal).
//
// Signal visibility:
//   experimental.chat.messages.transform injects a synthetic text part into
//   the last message for the current sessionID when its per-session signal
//   file exists, so the stuck agent is FORCED to see the directive.

import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

export const StuckDetectorPlugin = async ({ directory }) => {
  const MAX_HISTORY = 20;
  const STUCK_THRESHOLD = 3;          // 3+ of the same non-readonly tool
  const ERROR_THRESHOLD = 3;          // 3+ consecutive errors
  const READONLY_THRESHOLD = 6;       // 6+ consecutive same readonly tool
  const INVALID_THRESHOLD = 2;        // 2+ consecutive invalid (denied) calls

  const dataDir = join(directory, "data");
  const GLOBAL_SIGNAL_FILE = join(dataDir, ".stuck-signal.json");

  // Ensure data directory exists
  try {
    mkdirSync(dataDir, { recursive: true });
  } catch {}

  // Per-session history: Map<sessionID, Array<{tool, args, error, timestamp}>>
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

  // Levenshtein distance for arg similarity comparison
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

  function argSimilar(a, b) {
    if (!a && !b) return 1;
    if (!a || !b) return 0;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    return 1 - levenshtein(a, b) / maxLen;
  }

  function argFingerprint(args) {
    if (!args) return "";
    try {
      return JSON.stringify(args).slice(0, 80);
    } catch {
      return "";
    }
  }

  function detectStuck(history) {
    if (history.length < 4) return null;

    const recent = history.slice(-8);

    // Check 4 (priority): permission_loop — 2+ consecutive denied calls.
    // Belt-and-suspenders: trigger on EITHER tool === "invalid" (the documented
    // contract for denied calls) OR tool === "task" with an error (a denied
    // dispatch attempt — sub-agents have task: deny and surface as errors).
    // The exact tool-name contract for denied calls is not formally documented,
    // so we cover both shapes observed in production.
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

    // Check 1: tool_repetition — 3+ same non-readonly tool with similar args
    const toolCounts = {};
    const toolArgs = {};
    for (const entry of recent) {
      const tool = entry.tool || "unknown";
      toolCounts[tool] = (toolCounts[tool] || 0) + 1;
      if (!toolArgs[tool]) toolArgs[tool] = [];
      const fp = argFingerprint(entry.args);
      if (fp) toolArgs[tool].push(fp);
    }

    for (const [tool, count] of Object.entries(toolCounts)) {
      // Skip readonly tools here — they have their own consecutive check below.
      if (tool === "read" || tool === "glob" || tool === "grep") continue;
      if (count < STUCK_THRESHOLD) continue;

      const args = toolArgs[tool] || [];
      if (args.length < STUCK_THRESHOLD) continue;

      let similarCount = 0;
      for (let i = 0; i < args.length; i++) {
        for (let j = i + 1; j < args.length; j++) {
          if (argSimilar(args[i], args[j]) > 0.6) similarCount++;
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

    // Check 5: readonly_repetition — 6+ CONSECUTIVE same readonly tool with similar args
    // Reviewers legitimately grep a lot, but not 6+ consecutive identical-arg greps.
    const READONLY_TOOLS = new Set(["read", "glob", "grep"]);
    const tail6 = history.slice(-READONLY_THRESHOLD);
    if (tail6.length >= READONLY_THRESHOLD) {
      const tool = tail6[0].tool || "";
      if (READONLY_TOOLS.has(tool) && tail6.every(e => (e.tool || "") === tool)) {
        const fps = tail6.map(e => argFingerprint(e.args));
        let similarCount = 0;
        for (let i = 0; i < fps.length; i++) {
          for (let j = i + 1; j < fps.length; j++) {
            if (argSimilar(fps[i], fps[j]) > 0.6) similarCount++;
          }
        }
        if (similarCount >= 1) {
          return {
            type: "readonly_repetition",
            tool,
            count: tail6.length,
            similarCalls: similarCount + 1,
            detail: `${tool} called ${tail6.length} consecutive times with similar arguments (tight read-only loop)`,
          };
        }
      }
    }

    // Check 2: error_cascade — 3+ consecutive errors (invalid counts as error)
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

      // Per-session signal file
      writeFileSync(sessionSignalPath(sessionID), content, "utf-8");
      // Global mirror — so the parent agent (which reads the global file per R21)
      // can see that a sub-agent is stuck. Includes sessionID so the parent
      // knows which sub-agent.
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
      // If the global file references this sessionID, clear it too.
      // (Simplest correct behavior: clear it. If another session is also
      // stuck, its next detection will rewrite the global mirror.)
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
    if (tool === "task") return true; // dispatch completing = progress
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

        // Push to per-session history
        const history = getHistory(sessionID);
        history.push({
          tool,
          args,
          error: hasError,
          timestamp: now,
        });

        // Trim history
        while (history.length > MAX_HISTORY) {
          history.shift();
        }

        // Clear signal ONLY on genuine progress by THIS session.
        // Never clear on read/glob/grep (that was the bug that wiped the signal).
        if (isGenuineProgress(tool, args, hasError)) {
          if (existsSync(sessionSignalPath(sessionID))) {
            clearSignal(sessionID);
          }
        }

        // Detect stuck patterns (only check every few calls to avoid overhead)
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

    // Proactive warning hook — scoped to the current sessionID.
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

    // Signal visibility: inject the stuck directive into the current session's
    // last message so the stuck agent is FORCED to see it (not expected to
    // notice a file). Pattern copied from mulahazah.js.
    "experimental.chat.messages.transform": async (input, output) => {
      try {
        if (!Array.isArray(output.messages) || output.messages.length === 0) return;

        const lastMessage = output.messages[output.messages.length - 1];
        const sessionID = lastMessage?.info?.sessionID ?? output.messages[0]?.info?.sessionID;
        if (!sessionID) return;

        const sp = sessionSignalPath(sessionID);
        if (!existsSync(sp)) return;

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
          `If you are a SUB-AGENT: STOP immediately. Do not keep retrying. Return your partial findings plus a note about this blocker to the parent agent and end your task.\n` +
          `If you are the primary agent: load skill("breakthrough") to reframe and use a different approach.`;

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
