// agent-watchdog-helpers.mjs — Pure helpers extracted from the agent-watchdog
// plugin so the plugin file has EXACTLY ONE named export (AgentWatchdogPlugin).
// opencode's plugin loader crashes silently if a plugin file has more than one
// named export (see b0aaef8 — the stuck-detector fix for the same crash class).
//
// These functions are imported by:
//   - .opencode/plugins/agent-watchdog.mjs (the plugin)
//   - scripts/test-agent-watchdog.mjs (the verification harness)

import { readFileSync } from 'node:fs';

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
