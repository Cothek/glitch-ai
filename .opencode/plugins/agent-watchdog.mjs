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
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseThreshold, isSignalFresh, shouldInjectForSession, isSessionToolRunning } from '../../scripts/lib/agent-watchdog-helpers.mjs';

// --- Thresholds (parsed once at module load) ---
// parseThreshold/isSignalFresh/shouldInjectForSession live in
// scripts/lib/agent-watchdog-helpers.mjs so this file has EXACTLY ONE named
// export (AgentWatchdogPlugin). opencode's plugin loader crashes silently on
// files with >1 named export (b0aaef8 crash class).

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
      execFileSync(process.execPath, [ABORT_SCRIPT, sessionID], {
        cwd: repoRoot,
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
      if (entry.aborted) continue; // Already aborted successfully, skip.

      // Fix 1: Liveness check — verify the session is still actually alive
      // and the tool is still running BEFORE signaling or aborting. This
      // prevents false positives on sessions that were aborted externally
      // (user cancel, parent cancel cascade, escape key) — the after-hook
      // never fires for those, so the runningTools entry lingers forever.
      // Query the opencode SQLite DB (same pattern as abort-agent.mjs
      // verifyStopped). If the DB check is unreliable (alive === null),
      // fail-closed on abort: do NOT abort, but MAY write a signal.
      const liveness = isSessionToolRunning(entry.sessionID);
      if (liveness.alive === false) {
        // Session is dead or tool already completed — remove the stale entry
        // (Fix 2) and skip. Do NOT write a signal for a dead session.
        runningTools.delete(key);
        console.log(`[agent-watchdog] Session ${entry.sessionID} is not running (liveness check) — removed stale entry (tool=${entry.tool}, idle=${idleSeconds}s)`);
        continue;
      }
      // liveness.alive === null: DB check unreliable. Fail-closed on abort
      // (do NOT abort without positive liveness confirmation), but allow
      // signal-write for visibility.

      // Decide whether to auto-abort:
      // - task tool at IDLE_THRESHOLD → auto-abort (primary target).
      // - non-task tools at AUTO_ABORT_THRESHOLD → auto-abort UNLESS the tool
      //   is in PARENT_SAFE_TOOLS (webfetch/websearch/read are the parent's
      //   own legitimately slow operations — signal only, no abort).
      const shouldAutoAbort = isTaskTool
        ? idleMs >= IDLE_THRESHOLD_MS
        : (idleMs >= AUTO_ABORT_THRESHOLD_MS && !PARENT_SAFE_TOOLS.has(entry.tool));

      // Fix 2: If the DB liveness check was unreliable, do NOT auto-abort
      // even if the threshold says we should — fail-closed on abort.
      const willAbort = shouldAutoAbort && liveness.alive === true;

      // MAJOR-1: Write the signal file for visibility (always, on first
      // detection). The `aborted` field is ALWAYS false at this point — we
      // have NOT attempted the abort yet. If an abort will be performed,
      // updateSignalAborted() rewrites the field with the ACTUAL outcome
      // after the attempt. This prevents the signal from permanently claiming
      // "aborted: true" when the abort actually failed (server unreachable,
      // auth failure, session not found) — the exact false claim this fix
      // was meant to prevent.
      if (!existsSync(sessionSignalPath(entry.sessionID))) {
        writeIdleSignal(entry.sessionID, entry.tool, idleSeconds, threshold / 1000, false);
      }

      // MINOR-4: Only set signaled=true for signal-only cases (no abort
      // needed). For abort cases, signaled stays false until the abort
      // SUCCEEDS — a failed abort gets retried on the next 30s poll. This
      // prevents a transient abort failure from permanently leaving the
      // session running. The signal file already exists (written above) so
      // re-processing on the next poll won't re-write it (the existsSync
      // guard above prevents duplicate signals).
      if (!shouldAutoAbort) {
        entry.signaled = true;
        continue;
      }

      if (!willAbort) {
        // Liveness check was unreliable (alive === null) — fail-closed.
        // Signal-only: mark signaled so we don't re-flag, but don't abort.
        entry.signaled = true;
        console.warn(`[agent-watchdog] Skipping auto-abort for ${entry.sessionID} (tool=${entry.tool}, idle=${idleSeconds}s) — liveness check unreliable, fail-closed`);
        continue;
      }

      console.log(`[agent-watchdog] Auto-aborting session ${entry.sessionID} (tool=${entry.tool}, idle=${idleSeconds}s, threshold=${threshold / 1000}s)`);
      const aborted = abortSession(entry.sessionID);
      entry.aborted = aborted;

      if (aborted) {
        // MAJOR-1: Rewrite the signal file with the actual outcome so the
        // transform hook's directive text is honest ("has been aborted").
        updateSignalAborted(entry.sessionID, true);
        // MINOR-4: Only mark signaled after a SUCCESSFUL abort — prevents
        // re-flagging on every poll while keeping the entry eligible for
        // retry if the abort had failed.
        entry.signaled = true;
      } else {
        // MAJOR-1: Abort failed — rewrite the signal with aborted=false so
        // the transform hook does NOT claim the session was aborted.
        updateSignalAborted(entry.sessionID, false);
        // MINOR-4: Leave signaled=false so the next poll retries the abort.
        // The signal file already exists (with aborted=false) so the
        // existsSync guard prevents duplicate signal writes on retry.
        console.warn(`[agent-watchdog] Abort failed for ${entry.sessionID} — will retry on next poll`);
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
        runningTools.set(key, { sessionID, tool, startTime, aborted: false, signaled: false });
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
          // is signal-only (PARENT_SAFE_TOOLS or liveness-unreliable fail-closed
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
