// stuck-detector.js — OpenCode plugin: detects stuck patterns in tool calls
// Tracks tool call history, detects repetition and failure cascades.
// Writes data/.stuck-signal.json when stuck is detected.
// The AI reads this file and loads skill("breakthrough") to reframe.

import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";

export const StuckDetectorPlugin = async ({ directory }) => {
  const MAX_HISTORY = 20;
  const toolHistory = [];
  const STUCK_THRESHOLD = 3; // 3+ of the same tool = potential stuck
  const ERROR_THRESHOLD = 3; // 3+ consecutive errors = stuck
  const SIGNAL_FILE = join(directory, "data", ".stuck-signal.json");
  const signalDir = join(directory, "data");

  // Ensure data directory exists
  try {
    const { mkdirSync } = await import("fs");
    mkdirSync(signalDir, { recursive: true });
  } catch {}

  function detectStuck() {
    if (toolHistory.length < 4) return null; // Need minimum history

    // Check 1: Same tool called 3+ times in recent history
    const recent = toolHistory.slice(-8);
    const toolCounts = {};
    const toolArgs = {};
    for (const entry of recent) {
      const tool = entry.tool || "unknown";
      toolCounts[tool] = (toolCounts[tool] || 0) + 1;
      if (!toolArgs[tool]) toolArgs[tool] = [];
      // Store first 30 chars of relevant args for pattern detection
      const argStr = entry.args ? JSON.stringify(entry.args).slice(0, 80) : "";
      if (argStr) toolArgs[tool].push(argStr);
    }

    for (const [tool, count] of Object.entries(toolCounts)) {
      if (count >= STUCK_THRESHOLD && tool !== "read" && tool !== "glob" && tool !== "grep") {
        // Check if the tool is being called with SIMILAR args (same pattern repeated)
        const args = toolArgs[tool] || [];
        if (args.length >= STUCK_THRESHOLD) {
          // If 2+ args are very similar (>60% same), it's a repeat loop
          let similarCount = 0;
          for (let i = 0; i < args.length; i++) {
            for (let j = i + 1; j < args.length; j++) {
              const maxLen = Math.max(args[i].length, args[j].length);
              if (maxLen === 0) continue;
              const distance = levenshtein(args[i], args[j]);
              const similarity = 1 - distance / maxLen;
              if (similarity > 0.6) similarCount++;
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
      }
    }

    // Check 2: Consecutive errors
    const lastFew = recent.slice(-ERROR_THRESHOLD);
    if (lastFew.length >= ERROR_THRESHOLD && lastFew.every(e => e.error)) {
      return {
        type: "error_cascade",
        count: lastFew.length,
        detail: `${lastFew.length} consecutive tool calls returned errors`,
      };
    }

    // Check 3: Same commands repeated 3+ times (for bash tools)
    const bashCommands = recent.filter(e => e.tool === "bash");
    if (bashCommands.length >= 3) {
      const cmdTexts = bashCommands.map(e => (e.args || {}).command || "");
      // Check if same command appears 2+ times
      const cmdCounts = {};
      for (const cmd of cmdTexts) {
        const shortCmd = cmd.slice(0, 60); // Compare first 60 chars
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

  function writeSignal(signal) {
    try {
      const content = JSON.stringify({
        detected_at: new Date().toISOString(),
        stuck: true,
        type: signal.type,
        detail: signal.detail,
        tool: signal.tool || signal.command || "unknown",
        recommendation: "You appear to be stuck in a loop. Load skill(\"breakthrough\") to reframe the problem using a different approach.",
      }, null, 2);
      writeFileSync(SIGNAL_FILE, content, "utf-8");
      console.log(`[stuck-detector] ⚠️ Stuck detected: ${signal.type} — ${signal.detail}`);
    } catch (e) {
      console.error(`[stuck-detector] Failed to write signal: ${e.message}`);
    }
  }

  function clearSignal() {
    try {
      if (existsSync(SIGNAL_FILE)) {
        unlinkSync(SIGNAL_FILE);
      }
    } catch {}
  }

  return {
    "tool.execute.after": async (input, output) => {
      const now = Date.now();
      const tool = input.tool;
      const args = input.args || {};
      const hasError = output.error !== undefined && output.error !== null
        || (output.result && typeof output.result === 'string' && (
          /^Error:/m.test(output.result) || 
          /^error:/m.test(output.result) || 
          /^\s*Command failed/im.test(output.result) ||
          /^\s*FAILED/im.test(output.result)
        ));

      // Push to history
      toolHistory.push({
        tool,
        args,
        error: hasError,
        timestamp: now,
      });

      // Trim history
      while (toolHistory.length > MAX_HISTORY) {
        toolHistory.shift();
      }

      // Clear signal on first non-error call after a successful sequence
      // (if we see a read or task call that's not an error, likely unstuck)
      if (!hasError && (tool === "read" || tool === "task" || tool === "glob")) {
        // Only clear if we previously had a signal
        if (existsSync(SIGNAL_FILE)) {
          clearSignal();
          console.log("[stuck-detector] ✅ Unstuck detected — cleared signal");
        }
      }

      // Detect stuck patterns (only check every few calls to avoid overhead)
      if (toolHistory.length % 2 === 0) {
        const signal = detectStuck();
        if (signal && !existsSync(SIGNAL_FILE)) {
          writeSignal(signal);
        }
      }
    },

    // Also hook tool.execute.before to provide proactive warnings
    "tool.execute.before": async (input, output) => {
      // If we detect the SAME bash command running again while stuck signal exists
      if (input.tool === "bash" && existsSync(SIGNAL_FILE)) {
        const cmd = (input.args || {}).command || "";
        const recentBash = toolHistory.filter(e => e.tool === "bash").slice(-3);
        const similarCmd = recentBash.some(e => {
          const prevCmd = (e.args || {}).command || "";
          return prevCmd.slice(0, 40) === cmd.slice(0, 40);
        });
        
        if (similarCmd) {
          // Prepend a warning to the bash command output
          // We can't modify output before execution, but we can console.warn
          console.warn(`[stuck-detector] ⚠️ Warning: Command "${cmd.slice(0, 60)}..." was already executed recently. If stuck, try skill("breakthrough") for a fresh approach.`);
        }
      }
    },
  };
};
