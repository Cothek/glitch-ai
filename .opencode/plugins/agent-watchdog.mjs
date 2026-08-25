// agent-watchdog.mjs — OpenCode plugin: detects hung sub-agent sessions in real-time
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
// Threshold logic (documented design choice — anti-over-culling, 2026-08-25):
//   - IDLE_THRESHOLD (default 600s = 10 min): applies to the `task` tool — a
//     parent waiting on a sub-agent. This is the primary hung-agent signature.
//     BUT a task tool is only aborted when its CHILD sub-agent is confirmed
//     idle (no running tool, no recent part activity) for STUCK_CONFIRM_POLLS
//     consecutive polls. Deep sub-agent work (multi-file edits, research, long
//     test runs) routinely exceeds 5 min, so the child-activity check is what
//     prevents culling healthy agents.
//   - AUTO_ABORT_THRESHOLD (default 600s = 10 min): applies to non-task tools.
//     Non-task tools are the parent's OWN long-running operations (bash, edit,
//     read, webfetch, websearch). These are NEVER auto-aborted — signal-only
//     for visibility. Aborting the parent's own tool is too aggressive and was
//     the cause of "watchdog killing agents too quickly".
//   - Only the `task` tool is ever auto-aborted, and only when its child is
//     confirmed idle. Everything else is signal-only.
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
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseThreshold, isSignalFresh, shouldInjectForSession, isSessionToolRunning, getChildSessions, hasRecentActivity } from '../../scripts/lib/agent-watchdog-helpers.mjs';

// --- Node.js executable resolution ---
// process.execPath inside opencode is opencode.exe (Go binary embedding Bun),
// NOT node. Spawning it with a .mjs arg causes ETIMEDOUT (opencode hangs
// initializing). Use portable Node from data/node/ instead.
function getNodeExecutable(repoRoot) {
  const candidates = [
    join(repoRoot, 'data', 'node', 'node.exe'),       // Windows portable
    join(repoRoot, 'data', 'node', 'bin', 'node'),     // Unix portable
  ];
  for (const p of candidates) {
    try { if (existsSync(p)) return p; } catch {}
  }
  return 'node'; // fallback to PATH
}

// --- Thresholds (parsed once at module load) ---
// parseThreshold/isSignalFresh/shouldInjectForSession live in
// scripts/lib/agent-watchdog-helpers.mjs so this file has EXACTLY ONE named
// export (AgentWatchdogPlugin). opencode's plugin loader crashes silently on
// files with >1 named export (b0aaef8 crash class).

const IDLE_THRESHOLD_MS = parseThreshold('AGENT_IDLE_THRESHOLD_MS', 600_000);
const AUTO_ABORT_THRESHOLD_MS = parseThreshold('AGENT_AUTO_ABORT_THRESHOLD_MS', 600_000);
const POLL_INTERVAL_MS = 30_000;
const SIGNAL_TTL_MS = 15 * 60 * 1000;

// --- Anti-over-culling tuning (2026-08-24) ---
// The original watchdog aborted a parent's `task` tool at 5 min regardless of
// whether the child sub-agent was still working — deep sub-agent work (multi-
// file edits, research, long test runs) routinely exceeds 5 min, so healthy
// agents were being killed. The redesign:
//   - Only `task` tools are ever auto-aborted (non-task tools are signal-only).
//   - A task tool is only aborted when its CHILD sub-agent is confirmed idle
//     (no running tool AND no recent part activity) for STUCK_CONFIRM_POLLS
//     consecutive polls. Active children are never culled.
//   - CHILD_ACTIVITY_WINDOW_MS = how recent a child's part activity must be to
//     count as "working" (default 5 min).
const CHILD_ACTIVITY_WINDOW_MS = parseThreshold('AGENT_CHILD_ACTIVITY_WINDOW_MS', 300_000);
const CHILD_CREATE_SLACK_MS = 10_000; // slack for child session creation after task start
const STUCK_CONFIRM_POLLS = 2;        // consecutive polls of confirmed-idle before abort
const ABORT_RETRY_CAP = 3;            // max abort attempts before giving up (anti-spam)

// Tools that are the parent's own long-running operations — historically
// signal-only. As of the anti-over-culling redesign (2026-08-25) ALL non-task
// tools are signal-only (never auto-aborted), so this set is no longer needed
// for the abort decision; it is retained only as documentation of intent.
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

  // m5: derive ABORT_SCRIPT from the opencode `directory` param (the project
  // root opencode was launched with) so dataDir and ABORT_SCRIPT use the same
  // root. The old code computed REPO_ROOT from the plugin's own path, which
  // could diverge from `directory` if the plugin were symlinked or relocated.
  const repoRoot = directory;
  const ABORT_SCRIPT = join(repoRoot, 'scripts', 'abort-agent.mjs');

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
  // runningTools: Map<compositeKey, { sessionID, tool, startTime, aborted, signaled }>
  const runningTools = new Map();

  // M3: Track parent sessions (those that have called the task tool) and their
  // children. Only parent sessions receive transform directives; only signals
  // for children of the current parent are injected. This prevents injecting
  // into sub-agent sessions (task:deny — same class as PM-028 mulahazah loop).
  const parentSessions = new Set();
  const childrenByParent = new Map();

  // m1: cache the signal-file list from readdirSync so the transform hot path
  // doesn't scan the directory on every message. The cache is refreshed by
  // writeIdleSignal() (when we write a new signal) and invalidated on a short
  // TTL (5s) so externally-written signals (e.g. from the standalone script)
  // are still picked up. readdirSync is only called on init + when the TTL
  // expires.
  const SIGNAL_LIST_TTL_MS = 5000;
  let signalFileCache = null; // string[] | null
  let signalFileCacheTime = 0;

  function getSignalFiles() {
    const now = Date.now();
    if (signalFileCache !== null && (now - signalFileCacheTime) < SIGNAL_LIST_TTL_MS) {
      return signalFileCache;
    }
    try {
      const all = readdirSync(dataDir);
      signalFileCache = all.filter(
        (f) => f.startsWith('.agent-idle.') && f.endsWith('.json')
      );
      signalFileCacheTime = now;
    } catch (e) {
      // dataDir not readable — return empty list.
      signalFileCache = [];
      signalFileCacheTime = now;
    }
    return signalFileCache;
  }

  function invalidateSignalFileCache() {
    signalFileCache = null;
  }

  function toolKey(sessionID, tool, startTime) {
    return `${sessionID}|${tool}|${startTime}`;
  }

  function sessionSignalPath(sessionID) {
    return join(dataDir, `.agent-idle.${sessionID}.json`);
  }

  function writeIdleSignal(sessionID, tool, idleSeconds, threshold, aborted) {
    try {
      const payload = {
        detectedAt: new Date().toISOString(),
        sessionID,
        tool,
        idleSeconds,
        threshold,
        aborted: aborted === true,
        recommendation: aborted
          ? `Agent idle >${threshold}s — aborting and re-dispatching`
          : `Agent idle >${threshold}s — idle signal only (no auto-abort)`,
      };
      writeFileSync(sessionSignalPath(sessionID), JSON.stringify(payload, null, 2), 'utf-8');
      // m1: invalidate the signal-file cache so the transform hook sees the
      // new file immediately rather than waiting for the TTL.
      invalidateSignalFileCache();
      console.log(`[agent-watchdog] ⚠️ Idle detected (session=${sessionID}, tool=${tool}, idle=${idleSeconds}s, aborted=${aborted === true})`);
    } catch (e) {
      console.error(`[agent-watchdog] Failed to write idle signal: ${e.message}`);
    }
  }

  // MAJOR-1: Update the `aborted` field of an existing signal file with the
  // ACTUAL abort outcome. Called after abortSession() returns so the signal
  // honestly reflects whether the abort succeeded — the transform hook's
  // directive text depends on this value. Preserves the original detectedAt
  // (the first-detection timestamp) so signal freshness is measured from when
  // the hang was first noticed, not when the abort completed.
  function updateSignalAborted(sessionID, aborted) {
    const signalPath = sessionSignalPath(sessionID);
    try {
      const raw = readFileSync(signalPath, 'utf-8');
      const parsed = JSON.parse(raw);
      parsed.aborted = aborted === true;
      parsed.recommendation = aborted
        ? `Agent idle >${parsed.threshold}s — aborting and re-dispatching`
        : `Agent idle >${parsed.threshold}s — idle signal only (no auto-abort)`;
      writeFileSync(signalPath, JSON.stringify(parsed, null, 2), 'utf-8');
      invalidateSignalFileCache();
    } catch (e) {
      // Signal file may have been consumed by the transform hook already —
      // that's fine, the directive was already injected with the initial
      // (honest) aborted=false value.
    }
  }

  function abortSession(sessionID) {
    try {
      // M4: encoding utf-8 so execFileSync returns strings, not Buffers.
      // Use portable Node.js, NOT process.execPath (opencode.exe — Go binary
      // embedding Bun, hangs on .mjs args → ETIMEDOUT).
      const nodeBin = getNodeExecutable(repoRoot);
      execFileSync(nodeBin, [ABORT_SCRIPT, sessionID], {
        cwd: repoRoot,
        timeout: 30000,
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

      // task tool = parent waiting on a sub-agent → IDLE_THRESHOLD (10 min).
      // Non-task tools = parent's own long-running ops → signal-only, NEVER
      // auto-aborted (aborting the parent's own tool is too aggressive and was
      // the cause of "watchdog killing agents too quickly").
      const isTaskTool = entry.tool === 'task';
      const threshold = isTaskTool ? IDLE_THRESHOLD_MS : AUTO_ABORT_THRESHOLD_MS;

      if (idleMs < threshold) continue;
      if (entry.aborted) continue; // Already aborted successfully, skip.

      // Liveness gate (parent): if the DB shows the session is NOT running,
      // remove the stale entry and skip (false-positive prevention).
      const liveness = isSessionToolRunning(entry.sessionID);
      if (liveness.alive === false) {
        runningTools.delete(key);
        console.log(`[agent-watchdog] Session ${entry.sessionID} is not running (liveness check) — removed stale entry (tool=${entry.tool}, idle=${idleSeconds}s)`);
        continue;
      }

      // Non-task tools: signal-only. The parent's own long-running operations
      // (bash, edit, read, webfetch, etc.) are the parent's responsibility —
      // never auto-abort them. Write a signal once for visibility.
      if (!isTaskTool) {
        if (!existsSync(sessionSignalPath(entry.sessionID))) {
          writeIdleSignal(entry.sessionID, entry.tool, idleSeconds, threshold / 1000, false);
        }
        entry.signaled = true;
        continue;
      }

      // ---- task tool: verify the child sub-agent is actually stuck ----
      // A parent's task tool lingers while it waits on a sub-agent. That is
      // NORMAL for deep work (5-10+ min). Only abort when the child is
      // confirmed idle: no running tool AND no recent part activity.
      const childCheck = getChildSessions(entry.sessionID, entry.startTime - CHILD_CREATE_SLACK_MS);
      if (!childCheck.ok || childCheck.children.length === 0) {
        // Can't confirm the child is idle (DB unreliable or no child found).
        // Fail-open: do NOT abort — protecting healthy agents is the priority.
        // Signal once for visibility.
        if (!existsSync(sessionSignalPath(entry.sessionID))) {
          writeIdleSignal(entry.sessionID, entry.tool, idleSeconds, threshold / 1000, false);
        }
        entry.signaled = true;
        console.warn(`[agent-watchdog] Task idle ${idleSeconds}s for ${entry.sessionID} but child status unknown — NOT aborting (fail-open)`);
        continue;
      }

      // Check each child for activity (running tool OR recent part update).
      let anyActive = false;
      for (const cid of childCheck.children) {
        const act = hasRecentActivity(cid, CHILD_ACTIVITY_WINDOW_MS);
        if (act.ok && act.active) { anyActive = true; break; }
        const run = isSessionToolRunning(cid);
        if (run.alive === true) { anyActive = true; break; }
      }
      if (anyActive) {
        // Child is actively working — NOT stuck. Reset the confirmation
        // counter and skip. This is the key fix: deep sub-agent work is
        // never culled while it keeps making progress.
        entry.stuckPolls = 0;
        continue;
      }

      // All children idle — increment the stuck confirmation counter. Require
      // STUCK_CONFIRM_POLLS consecutive polls before aborting (debounce).
      entry.stuckPolls = (entry.stuckPolls || 0) + 1;
      if (entry.stuckPolls < STUCK_CONFIRM_POLLS) {
        if (!existsSync(sessionSignalPath(entry.sessionID))) {
          writeIdleSignal(entry.sessionID, entry.tool, idleSeconds, threshold / 1000, false);
        }
        console.warn(`[agent-watchdog] Task idle ${idleSeconds}s for ${entry.sessionID}, child idle — confirming stuck (${entry.stuckPolls}/${STUCK_CONFIRM_POLLS})`);
        continue;
      }

      // Confirmed stuck — abort.
      console.log(`[agent-watchdog] Auto-aborting stuck session ${entry.sessionID} (tool=${entry.tool}, idle=${idleSeconds}s, threshold=${threshold / 1000}s)`);
      const aborted = abortSession(entry.sessionID);
      entry.aborted = aborted;

      if (aborted) {
        // Rewrite the signal with the actual outcome so the transform hook's
        // directive text is honest ("has been aborted").
        updateSignalAborted(entry.sessionID, true);
        entry.signaled = true;
      } else {
        // Abort failed — rewrite the signal with aborted=false so the
        // transform hook does NOT claim the session was aborted.
        updateSignalAborted(entry.sessionID, false);

        // Retry cap: after ABORT_RETRY_CAP failed attempts (fetch timeout,
        // server unreachable, etc.), give up to prevent infinite retry spam.
        entry.abortRetries = (entry.abortRetries || 0) + 1;
        if (entry.abortRetries >= ABORT_RETRY_CAP) {
          entry.aborted = true;   // Stops future polls (guard at top)
          entry.signaled = true;  // Prevents re-flagging
          console.warn(`[agent-watchdog] Giving up abort for ${entry.sessionID} after ${entry.abortRetries} attempts — will not retry`);
        } else {
          console.warn(`[agent-watchdog] Abort failed for ${entry.sessionID} (${entry.abortRetries}/${ABORT_RETRY_CAP}) — will retry on next poll`);
        }
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
        runningTools.set(key, { sessionID, tool, startTime, aborted: false, signaled: false, abortRetries: 0, stuckPolls: 0 });
        // m2: only clear the aborted flag when the new tool is a `task` tool
        // (parent re-dispatching after a previous child was aborted). For
        // non-task tools, leave the aborted flag intact — a parent running a
        // read/webfetch after a child was aborted has NOT recovered the child;
        // clearing the flag here would let a second abort fire on the same
        // session prematurely.
        // (MINOR-3: the dead abortedSessions Set was removed; entry.aborted on
        // the composite-keyed entry already prevents duplicate aborts per-entry.)
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
        // m1: use the cached signal-file list instead of readdirSync on every
        // transform call. The cache is invalidated when we write/delete a signal
        // and refreshed on a 5s TTL so externally-written signals are picked up.
        const files = getSignalFiles();
        for (const file of files) {
          const fullPath = join(dataDir, file);

          if (!isSignalFresh(fullPath, SIGNAL_TTL_MS)) {
            try { unlinkSync(fullPath); } catch (e) { /* best-effort cleanup */ }
            invalidateSignalFileCache();
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

          // Fix 3: Honest directive text. The signal payload now carries an
          // `aborted` boolean (recorded at signal-write time). If the signal
          // is signal-only (non-task tool, or child-status-unknown fail-open,
          // or no abort performed), the directive must NOT claim the session
          // was aborted. Also: if the signal sessionID is the same as the
          // receiving session (currentSessionID === signalSessionID), the
          // parent's OWN tool was flagged — phrase it as "your own session's
          // tool was idle", never "sub-agent ... aborted."
          const wasAborted = signal.aborted === true;
          const isOwnSession = signalSessionID === currentSessionID;

          let directive;
          if (wasAborted && !isOwnSession) {
            directive =
              `⚠️ AGENT IDLE DETECTED: sub-agent session ${signalSessionID} was silent >${signal.threshold}s ` +
              `(tool: ${toolName}) and has been aborted. ` +
              `If you were waiting on it, re-dispatch the task fresh.`;
          } else if (wasAborted && isOwnSession) {
            directive =
              `⚠️ AGENT IDLE DETECTED: your own session's tool was silent >${signal.threshold}s ` +
              `(tool: ${toolName}) and has been aborted. ` +
              `Review manually if it matters.`;
          } else if (isOwnSession) {
            directive =
              `⚠️ AGENT IDLE DETECTED: your own session's tool was silent >${signal.threshold}s ` +
              `(tool: ${toolName}) — idle signal only, session NOT aborted ` +
              `(safe tool / no abort performed). Review manually if it matters.`;
          } else {
            directive =
              `⚠️ AGENT IDLE DETECTED: sub-agent session ${signalSessionID} was silent >${signal.threshold}s ` +
              `(tool: ${toolName}) — idle signal only, session NOT aborted ` +
              `(safe tool / no abort performed). Review manually if it matters.`;
          }

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
          invalidateSignalFileCache();

          console.log(`[agent-watchdog] injected idle directive for session ${currentSessionID} (signal session ${signalSessionID}, aborted=${wasAborted}, own=${isOwnSession})`);
          break; // Only inject one directive per transform call.
        }
      } catch (e) {
        console.error(`[agent-watchdog] experimental.chat.messages.transform failed: ${e.message}`);
      }
    },
  };
};
