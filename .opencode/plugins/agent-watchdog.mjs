// agent-watchdog.js — OpenCode plugin: detects hung sub-agent sessions in real-time
// and aborts them so the parent's task() call returns.
//
// Patterns followed:
//   - stuck-detector.js: per-session signal files (data/.agent-idle.<sessionID>.json),
//     experimental.chat.messages.transform injection, 15-min TTL + init sweep.
//   - dispatch-reflex.js: tool.execute.before/after hooks, execFileSync external
//     script calls (writeReviewPassMarker pattern).
//
// Detection model:
//   tool.execute.before records { sessionID, tool, startTime } in a Map keyed by
//   sessionID. tool.execute.after removes the entry (tool completed). A 30s
//   setInterval checks each entry: if a tool has been running longer than the
//   threshold, we write a signal file and call abort-agent.mjs to abort the
//   session via the opencode web API.
//
// Threshold logic (documented design choice):
//   - IDLE_THRESHOLD (default 300s = 5 min): applies to the `task` tool — a
//     sub-agent that itself dispatched and is waiting on a child. This is the
//     primary hung-agent signature. Aborting at 5 min is safe because a
//     well-behaved sub-agent should produce tool output within 5 min.
//   - AUTO_ABORT_THRESHOLD (default 600s = 10 min): applies to non-task tools.
//     The parent's own long-running tools (webfetch on slow sites, websearch,
//     read on huge files) can legitimately exceed 5 min. Using a higher
//     threshold for non-task tools avoids false-positive aborts of the parent.
//   - PARENT_SAFE_TOOLS (webfetch, websearch, read): even at the 10-min
//     threshold, these are the parent's own operations that are legitimately
//     slow. We write a signal file (for visibility) but do NOT auto-abort
//     these. The `task` tool is the only tool we auto-abort at the 5-min
//     threshold; all other tools auto-abort only at 10 min, and the safe-tools
//     set is excluded from auto-abort entirely.
//
// Signal freshness:
//   Signal files older than SIGNAL_TTL_MS (15 min) are stale. The transform
//   hook skips injection for stale signals and deletes them. sweepStaleSignals()
//   runs at plugin init to clean up leftover files.
//
// Signal visibility:
//   experimental.chat.messages.transform injects a synthetic text part into
//   the last message for the current sessionID when a fresh .agent-idle signal
//   exists, telling the parent that a sub-agent was aborted and to re-dispatch.

import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const ABORT_SCRIPT = resolve(REPO_ROOT, 'scripts', 'abort-agent.mjs');

// --- Pure helpers (exported for testability) ---

/**
 * Parse a threshold (ms) from an env var with a default fallback.
 * Logs a warning if the env var is set but parses to NaN.
 */
export function parseThreshold(envVar, defaultMs) {
  const raw = process.env[envVar];
  if (!raw) return defaultMs;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    console.warn(`[agent-watchdog] ${envVar}="${raw}" is not a valid integer — falling back to ${defaultMs}ms`);
    return defaultMs;
  }
  return parsed;
}

/**
 * Check whether a signal file is fresh (within ttlMs of detectedAt).
 * detectedAt may be an ISO string or epoch-ms number (schema-unified).
 */
export function isSignalFresh(signalPath, ttlMs) {
  try {
    const raw = readFileSync(signalPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const detectedAt = typeof parsed.detectedAt === 'number'
      ? parsed.detectedAt
      : new Date(parsed.detectedAt).getTime();
    if (isNaN(detectedAt)) return false;
    return (Date.now() - detectedAt) <= ttlMs;
  } catch {
    return false;
  }
}

/**
 * Decide whether the transform hook should inject a directive for a signal
 * into the current session's message stream.
 *
 * Rules:
 *   - Only PARENT sessions (those that have dispatched task tools) receive
 *     directives. Sub-agents have task:deny and cannot re-dispatch — injecting
 *     would loop or waste tokens (same class as PM-028 mulahazah loop).
 *   - If the parent has recorded children, only inject signals for those
 *     children. If no children are recorded (child tracking may fail because
 *     the task tool output shape doesn't reliably expose the child sessionID),
 *     fall back to injecting for any fresh signal — the parent is the one that
 *     dispatches sub-agents, so any idle signal is likely relevant to it.
 *
 * @param currentSessionID - the session whose message stream is being transformed
 * @param signalSessionID - the session that was detected idle/aborted
 * @param parentSessions - Set of sessionIDs that have called the task tool
 * @param childrenByParent - Map<parentSessionID, Set<childSessionID>>
 */
export function shouldInjectForSession(currentSessionID, signalSessionID, parentSessions, childrenByParent) {
  if (!currentSessionID || !signalSessionID) return false;
  // Only parent sessions receive directives.
  if (!parentSessions.has(currentSessionID)) return false;
  // If we have recorded children for this parent, only inject for those children.
  const children = childrenByParent.get(currentSessionID);
  if (children && children.size > 0) {
    if (!children.has(signalSessionID)) return false;
  }
  // No recorded children — fall back to injecting for any signal. The parent
  // is the only session type that dispatches sub-agents, so any idle signal
  // is likely for a child it dispatched (child tracking is best-effort).
  return true;
}

const IDLE_THRESHOLD_MS = parseThreshold('AGENT_IDLE_THRESHOLD_MS', 300_000);
const AUTO_ABORT_THRESHOLD_MS = parseThreshold('AGENT_AUTO_ABORT_THRESHOLD_MS', 600_000);
const POLL_INTERVAL_MS = 30_000;
const SIGNAL_TTL_MS = 15 * 60 * 1000;

// Tools that are the parent's own long-running operations — write a signal for
// visibility but never auto-abort these (they're not hung sub-agents).
const PARENT_SAFE_TOOLS = new Set(['webfetch', 'websearch', 'read']);

// --- Signal freshness ---

function sweepStaleSignals(dataDir, ttlMs) {
  const now = Date.now();
  let swept = 0;
  try {
    const files = readdirSync(dataDir);
    for (const file of files) {
      if (!file.startsWith('.agent-idle.') || !file.endsWith('.json')) continue;
      const fullPath = join(dataDir, file);
      try {
        const raw = readFileSync(fullPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const detectedAt = typeof parsed.detectedAt === 'number'
          ? parsed.detectedAt
          : new Date(parsed.detectedAt).getTime();
        if (isNaN(detectedAt) || (now - detectedAt) > ttlMs) {
          unlinkSync(fullPath);
          swept++;
        }
      } catch (e) {
        // Malformed signal file — remove it so it doesn't cause repeated errors.
        try { unlinkSync(fullPath); swept++; } catch (e2) { /* best-effort */ }
      }
    }
  } catch (e) {
    // dataDir not readable — nothing to sweep.
  }
  if (swept > 0) {
    console.log(`[agent-watchdog] 🧹 Swept ${swept} stale idle signal file(s) on init`);
  }
}

// --- Plugin ---

export const AgentWatchdogPlugin = async ({ directory }) => {
  const dataDir = join(directory, 'data');

  try {
    mkdirSync(dataDir, { recursive: true });
  } catch (e) {
    console.error(`[agent-watchdog] Failed to create data dir: ${e.message}`);
  }

  // m6: verify the abort script exists at startup — without it the plugin
  // can never abort, so warn early rather than failing silently at runtime.
  if (!existsSync(ABORT_SCRIPT)) {
    console.warn(`[agent-watchdog] abort-agent.mjs not found at expected path: ${ABORT_SCRIPT}`);
  }

  sweepStaleSignals(dataDir, SIGNAL_TTL_MS);

  // M2: Map keyed by composite key `${sessionID}|${tool}|${startTime}` to avoid
  // the race where tool A's after-hook deletes tool B's entry (overlapping or
  // delayed aborts). The after-hook only deletes if the tool name matches.
  // runningTools: Map<compositeKey, { sessionID, tool, startTime, aborted }>
  const runningTools = new Map();
  // Track which sessions we've already aborted to avoid repeat aborts.
  const abortedSessions = new Set();

  // M3: Track parent sessions (those that have called the task tool) and their
  // children. Only parent sessions receive transform directives; only signals
  // for children of the current parent are injected. This prevents injecting
  // into sub-agent sessions (task:deny — same class as PM-028 mulahazah loop).
  const parentSessions = new Set();
  const childrenByParent = new Map();

  function toolKey(sessionID, tool, startTime) {
    return `${sessionID}|${tool}|${startTime}`;
  }

  function sessionSignalPath(sessionID) {
    return join(dataDir, `.agent-idle.${sessionID}.json`);
  }

  function writeIdleSignal(sessionID, tool, idleSeconds, threshold) {
    try {
      const payload = {
        detectedAt: new Date().toISOString(),
        sessionID,
        tool,
        idleSeconds,
        threshold,
        recommendation: `Agent idle >${threshold}s — aborting and re-dispatching`,
      };
      writeFileSync(sessionSignalPath(sessionID), JSON.stringify(payload, null, 2), 'utf-8');
      console.log(`[agent-watchdog] ⚠️ Idle detected (session=${sessionID}, tool=${tool}, idle=${idleSeconds}s)`);
    } catch (e) {
      console.error(`[agent-watchdog] Failed to write idle signal: ${e.message}`);
    }
  }

  function abortSession(sessionID) {
    try {
      // M4: encoding utf-8 so execFileSync returns strings, not Buffers.
      execFileSync(process.execPath, [ABORT_SCRIPT, sessionID], {
        cwd: REPO_ROOT,
        timeout: 20000,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      console.log(`[agent-watchdog] ✅ Aborted session ${sessionID} via abort-agent.mjs`);
      return true;
    } catch (e) {
      // M4: extract stdout/stderr from the execFileSync error object so abort
      // failures are never silent.
      const detail = (e && (e.stderr || e.stdout)) || (e && e.message) || String(e);
      console.warn(`[agent-watchdog] ⚠️ abort-agent.mjs failed: ${detail}`);
      return false;
    }
  }

  function checkAndAbort() {
    const now = Date.now();
    for (const [key, entry] of runningTools) {
      const idleMs = now - entry.startTime;
      const idleSeconds = Math.round(idleMs / 1000);

      // Determine the effective threshold based on the tool type.
      // task tool = sub-agent waiting on a child → 5 min (IDLE_THRESHOLD).
      // Other tools = parent's own long-running ops → 10 min (AUTO_ABORT_THRESHOLD).
      const isTaskTool = entry.tool === 'task';
      const threshold = isTaskTool ? IDLE_THRESHOLD_MS : AUTO_ABORT_THRESHOLD_MS;

      if (idleMs < threshold) continue;
      if (entry.aborted) continue; // Already aborted, skip.

      // Write the signal file for visibility (always, on first detection).
      if (!existsSync(sessionSignalPath(entry.sessionID))) {
        writeIdleSignal(entry.sessionID, entry.tool, idleSeconds, threshold / 1000);
      }

      // Decide whether to auto-abort:
      // - task tool at IDLE_THRESHOLD → auto-abort (primary target).
      // - non-task tools at AUTO_ABORT_THRESHOLD → auto-abort UNLESS the tool
      //   is in PARENT_SAFE_TOOLS (webfetch/websearch/read are the parent's
      //   own legitimately slow operations — signal only, no abort).
      const shouldAutoAbort = isTaskTool
        ? idleMs >= IDLE_THRESHOLD_MS
        : (idleMs >= AUTO_ABORT_THRESHOLD_MS && !PARENT_SAFE_TOOLS.has(entry.tool));

      if (!shouldAutoAbort) continue;

      console.log(`[agent-watchdog] Auto-aborting session ${entry.sessionID} (tool=${entry.tool}, idle=${idleSeconds}s, threshold=${threshold / 1000}s)`);
      const aborted = abortSession(entry.sessionID);
      entry.aborted = aborted;
      if (aborted) {
        abortedSessions.add(entry.sessionID);
      }
    }
  }

  const poller = setInterval(checkAndAbort, POLL_INTERVAL_MS);
  // Don't keep the process alive just for the poller.
  if (poller.unref) poller.unref();

  return {
    'tool.execute.before': async (input, output) => {
      try {
        const sessionID = input.sessionID || 'unknown';
        const tool = input.tool || 'unknown';
        const startTime = Date.now();

        // M3: Track parent sessions — any session that calls the task tool is
        // a parent (it dispatches sub-agents). Record the child session if the
        // task input includes a sessionID for the child.
        if (tool === 'task') {
          parentSessions.add(sessionID);
          // The task tool's args may include the dispatched sub-agent's session
          // info. We record the child when we see it in the after-hook (once the
          // child sessionID is known). For now, just mark this as a parent.
        }

        // M2: Composite key prevents the race where tool A's after-hook deletes
        // tool B's entry. Each (sessionID, tool, startTime) is unique.
        const key = toolKey(sessionID, tool, startTime);
        runningTools.set(key, { sessionID, tool, startTime, aborted: false });
        // Clear any prior aborted flag for this session — a fresh tool start
        // means the session recovered (but don't delete other tools' entries).
        abortedSessions.delete(sessionID);
      } catch (e) {
        console.error(`[agent-watchdog] tool.execute.before failed: ${e.message}`);
      }
    },

    'tool.execute.after': async (input, output) => {
      try {
        const sessionID = input.sessionID || 'unknown';
        const tool = input.tool || 'unknown';

        // M3: If this is a task tool completing, record the child session.
        // The output may contain the child's sessionID (the dispatched sub-agent).
        if (tool === 'task' && parentSessions.has(sessionID)) {
          const childSessionID = output?.info?.sessionID
            || output?.result?.sessionID
            || output?.sessionID;
          if (childSessionID && childSessionID !== sessionID) {
            if (!childrenByParent.has(sessionID)) {
              childrenByParent.set(sessionID, new Set());
            }
            childrenByParent.get(sessionID).add(childSessionID);
          }
        }

        // M2: Only delete the entry whose tool matches. The composite key
        // includes startTime, so we find the matching entry by sessionID+tool
        // and delete only that one. This prevents tool A's after-hook from
        // deleting tool B's entry when they overlap.
        for (const [key, entry] of runningTools) {
          if (entry.sessionID === sessionID && entry.tool === tool) {
            runningTools.delete(key);
            break; // Only delete the first match (oldest startTime).
          }
        }
      } catch (e) {
        console.error(`[agent-watchdog] tool.execute.after failed: ${e.message}`);
      }
    },

    'experimental.chat.messages.transform': async (input, output) => {
      try {
        if (!Array.isArray(output.messages) || output.messages.length === 0) return;

        const lastMessage = output.messages[output.messages.length - 1];
        const currentSessionID = lastMessage?.info?.sessionID ?? output.messages[0]?.info?.sessionID;
        if (!currentSessionID) return;

        // M3: Only parent sessions receive directives. Sub-agents have task:deny
        // and cannot re-dispatch — injecting would loop or waste tokens.
        if (!parentSessions.has(currentSessionID)) return;

        // Scan idle signal files — but only inject for children of the current
        // parent session (shouldInjectForSession enforces this).
        const files = readdirSync(dataDir);
        for (const file of files) {
          if (!file.startsWith('.agent-idle.') || !file.endsWith('.json')) continue;
          const fullPath = join(dataDir, file);

          if (!isSignalFresh(fullPath, SIGNAL_TTL_MS)) {
            try { unlinkSync(fullPath); } catch (e) { /* best-effort cleanup */ }
            continue;
          }

          let signal;
          try {
            signal = JSON.parse(readFileSync(fullPath, 'utf-8'));
          } catch (e) {
            // Malformed signal — skip, don't inject garbage.
            continue;
          }
          if (!signal) continue;

          const signalSessionID = signal.sessionID;
          // M3: Only inject if the signal is for a child of the current parent.
          if (!shouldInjectForSession(currentSessionID, signalSessionID, parentSessions, childrenByParent)) {
            continue;
          }

          // Inject the directive into the parent's message stream.
          if (!lastMessage || !Array.isArray(lastMessage.parts)) continue;

          const msgSessionID = lastMessage.info?.sessionID ?? currentSessionID;
          const messageID = lastMessage.info?.id ?? `msg_${randomUUID()}`;

          // M1: defensive — signal.tool may be undefined if from an old-format
          // standalone script signal. Fall back to 'unknown'.
          const toolName = signal.tool ?? 'unknown';

          const directive =
            `⚠️ AGENT IDLE DETECTED: sub-agent session ${signalSessionID} was silent >${signal.threshold}s ` +
            `(tool: ${toolName}) and has been aborted. ` +
            `If you were waiting on it, re-dispatch the task fresh.`;

          lastMessage.parts.push({
            id: `prt_${randomUUID()}`,
            sessionID: msgSessionID,
            messageID,
            type: 'text',
            text: directive,
            synthetic: true,
          });

          // Delete the signal file after injection so it doesn't re-inject.
          try { unlinkSync(fullPath); } catch (e) { /* best-effort */ }

          console.log(`[agent-watchdog] injected idle directive for session ${currentSessionID} (aborted sub-agent ${signalSessionID})`);
          break; // Only inject one directive per transform call.
        }
      } catch (e) {
        console.error(`[agent-watchdog] experimental.chat.messages.transform failed: ${e.message}`);
      }
    },
  };
};
