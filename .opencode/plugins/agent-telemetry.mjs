// agent-telemetry.mjs — OpenCode plugin: push live agent dispatch events to the
// glitch-money dashboard's ingest API so the fleet view shows real data.
//
// Hooks `tool.execute.before` and `tool.execute.after` for the `task` tool:
//   - before  → agent.run.started  (sub-agent dispatched)
//   - after   → agent.run.finished (sub-agent returned)
//
// Event schema matches the dashboard's actual ingest handler (dashboard/lib/ingest.mjs),
// NOT the spec's approximate version:
//   - agent.run.started: { id, role, task, model, parentId }
//   - agent.run.finished: { id, status, elapsedSec, errors }
// The dashboard matches started/finished by `id`, so we use the sub-agent's
// session ID as the event id (stable across both hooks). If the child session
// ID isn't known at `before` time, we generate a UUID and remember it keyed by
// the parent session + dispatch time so the `after` hook can reuse it.
//
// Body format: { events: [...] } (server.mjs expects body.events to be an array,
// NOT a bare array).
//
// Constraints (b0aaef8 crash class — same as agent-watchdog.mjs):
//   - EXACTLY ONE named export: AgentTelemetryPlugin. No other exports.
//   - No module-level side effects: all work inside the factory.
//   - Fire-and-forget: never await the fetch in the hook (would block parent).
//   - Graceful degradation: dashboard down → warn, never crash.
//   - 5s timeout on fetch (AbortSignal.timeout).
//   - Token cached after first read.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const FETCH_TIMEOUT_MS = 5000;

// Token cache: read once, reuse. The token file is created by the dashboard on
// first run and never changes during a session. Kept at module level so the
// cache survives across hook invocations within a session.
let cachedToken = null;
let tokenChecked = false;

// Extract the sub-agent session ID from the task tool's output. The child
// session ID is only known AFTER the task completes (opencode assigns it when
// the sub-agent session is created). We try several shapes because the output
// structure varies across opencode versions.
function extractChildSessionId(output) {
  if (!output) return null;
  return output?.info?.sessionID
    || output?.result?.sessionID
    || output?.sessionID
    || output?.info?.id
    || null;
}

// Extract the agent name from the task tool input. The opencode task tool
// exposes the agent name as a flat top-level `agent` property (confirmed by
// dispatch-reflex.js line 108 and stuck-detector.js line 84). The `subagent_type`
// alias is kept as a fallback for older opencode versions.
function extractAgentName(input) {
  if (!input) return 'unknown';
  return input.agent || input.subagent_type || input.subagent || 'unknown';
}

// The opencode task tool input does NOT carry the model — the model is resolved
// internally by opencode based on the agent config (config/opencode-*.json). We
// return an empty string; the dashboard shows "unknown" for the model column
// until cost records or a future opencode API exposes the resolved model.
function extractModel(input) {
  if (!input) return '';
  return input.model || input.modelID || '';
}

// Extract the task description from the task tool input. The opencode task tool
// exposes the prompt as a flat top-level `prompt` property (confirmed by
// plan-reflex.js lines 81, 106). The `description` alias is kept as a fallback.
function extractTaskDescription(input) {
  if (!input) return '';
  const text = input.prompt || input.description || '';
  if (typeof text !== 'string') return '';
  // Truncate to keep the event payload reasonable — the dashboard shows this
  // as a one-line summary in the fleet view.
  return text.length > 500 ? text.slice(0, 497) + '...' : text;
}

export const AgentTelemetryPlugin = async ({ directory }) => {
  // Derive dashboard URL and token path from the `directory` param (the opencode
  // project root) rather than process.cwd() / module-level env reads. This
  // makes the plugin portable: the money repo is at
  // <parent-of-glitch-ai>/code/glitch-money, so join(directory, '..', 'code',
  // 'glitch-money') resolves correctly regardless of cwd. Env overrides stay
  // available for non-standard layouts.
  const dashboardUrl = process.env.MONEY_DASHBOARD_URL || 'http://localhost:4110';
  const moneyDir = process.env.MONEY_DASHBOARD_DIR || join(directory, '..', 'code', 'glitch-money');
  const tokenPath = process.env.MONEY_DASHBOARD_TOKEN_PATH || join(moneyDir, 'data', '.dashboard-token');

  function getToken() {
    if (tokenChecked) return cachedToken;
    tokenChecked = true;
    try {
      if (existsSync(tokenPath)) {
        cachedToken = readFileSync(tokenPath, 'utf-8').trim();
      }
    } catch (e) {
      // Token file unreadable — dashboard not configured. Stay silent; the warn
      // happens only when we actually try to push and fail.
      cachedToken = null;
    }
    return cachedToken;
  }

  // Fire-and-forget POST. Never awaited by the caller. Catches all errors so a
  // down dashboard never crashes the parent's task dispatch.
  function pushEvents(events) {
    const token = getToken();
    if (!token) return; // dashboard not configured, skip silently

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    fetch(`${dashboardUrl}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ events }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) {
          // Don't read the body — fire-and-forget. Just log the status.
          console.warn(`[agent-telemetry] ingest responded ${res.status} ${res.statusText}`);
        }
      })
      .catch((err) => {
        // AbortError = timeout; everything else = network/parse failure. Either
        // way, warn but don't crash. The dashboard being down is an expected
        // state (not running yet, wrong port, etc.).
        const reason = err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || String(err);
        console.warn(`[agent-telemetry] push failed (${reason})`);
      })
      .finally(() => {
        clearTimeout(timer);
      });
  }

  // Map<parentSessionID|agent, { eventID, startTime, agent, model, task }> —
  // remembers which event id we assigned at `before` time so the `after` hook
  // can emit a matching `agent.run.finished` with the same id. The dashboard
  // matches by id.
  //
  // Keyed by parent session + agent name (composite) to avoid cross-session
  // mismatches. The parent dispatches sub-agents sequentially (one task() call
  // blocks until it returns before the next starts), so for a given parent +
  // agent there is at most one in-flight dispatch at a time.
  //
  // Bounded to MAX_DISPATCH_MAP_SIZE entries (FIFO eviction) to prevent
  // unbounded growth if the after-hook ever fails to fire (e.g., plugin loaded
  // mid-session, before-hook succeeded but after-hook crashed).
  const MAX_DISPATCH_MAP_SIZE = 100;
  const dispatchMap = new Map();

  function dispatchKey(parentSessionID, agent) {
    return `${parentSessionID}|${agent}`;
  }

  return {
    'tool.execute.before': async (input, output) => {
      try {
        if (input?.tool !== 'task') return;

        const parentSessionID = input?.sessionID || 'unknown';
        const agent = extractAgentName(input);
        const model = extractModel(input);
        const task = extractTaskDescription(input);
        const startTime = Date.now();

        // We don't know the child session ID yet (opencode assigns it when the
        // sub-agent session is created, which happens during the task tool's
        // execution). Generate a stable event id now and remember it so the
        // `after` hook can reuse it. If the after-hook can extract the real
        // child session ID, we'll use that as a secondary key for correlation.
        const eventID = randomUUID();

        // Evict the oldest entry if the map is full (FIFO — Map preserves
        // insertion order, so the first entry is the oldest).
        if (dispatchMap.size >= MAX_DISPATCH_MAP_SIZE) {
          const oldestKey = dispatchMap.keys().next().value;
          if (oldestKey !== undefined) {
            dispatchMap.delete(oldestKey);
          }
        }

        dispatchMap.set(dispatchKey(parentSessionID, agent), {
          eventID,
          startTime,
          agent,
          model,
          task,
        });

        const event = {
          type: 'agent.run.started',
          id: eventID,
          ts: new Date(startTime).toISOString(),
          role: agent,
          task,
          model,
          parentId: parentSessionID,
        };

        pushEvents([event]);
      } catch (e) {
        // Never crash the parent's dispatch because telemetry failed.
        console.warn(`[agent-telemetry] tool.execute.before failed: ${e && e.message || e}`);
      }
    },

    'tool.execute.after': async (input, output) => {
      try {
        if (input?.tool !== 'task') return;

        const parentSessionID = input?.sessionID || 'unknown';
        const agent = extractAgentName(input);
        const now = Date.now();

        // Find the matching `before` entry by composite key (parent session +
        // agent name). This avoids cross-session mismatches that the old
        // OR-based matching caused. The parent dispatches sub-agents
        // sequentially, so there is at most one in-flight entry per
        // parent+agent pair.
        const key = dispatchKey(parentSessionID, agent);
        const entry = dispatchMap.get(key);

        if (!entry) {
          // No matching `before` entry — could happen if the plugin loaded
          // mid-session, the before-hook failed, or the entry was evicted.
          // Skip the finished event rather than emitting with wrong data
          // (a finished-without-started would leave an orphan on the
          // dashboard that can never be matched).
          console.warn(`[agent-telemetry] after: no before-entry for ${key}, skipping finished event`);
          return;
        }

        // Clean up the map entry.
        dispatchMap.delete(key);

        const elapsedSec = Math.max(0, Math.round((now - entry.startTime) / 1000));

        // Determine completion status. The task tool's output may carry an
        // error flag, or the output may be null/empty on abort.
        let status = 'completed';
        let errors = 0;
        if (output == null) {
          status = 'error';
          errors = 1;
        } else if (output?.error) {
          status = 'error';
          errors = 1;
        } else if (output?.ok === false) {
          status = 'error';
          errors = 1;
        }

        const event = {
          type: 'agent.run.finished',
          id: entry.eventID,
          ts: new Date(now).toISOString(),
          status,
          elapsedSec,
          errors,
        };

        pushEvents([event]);
      } catch (e) {
        // Never crash the parent's dispatch because telemetry failed.
        console.warn(`[agent-telemetry] tool.execute.after failed: ${e && e.message || e}`);
      }
    },
  };
};
