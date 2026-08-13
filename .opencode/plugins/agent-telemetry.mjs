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

// Extract the agent name from the task tool input. The field has been observed
// as `agent`, `subagent_type`, and `subagentType` across opencode versions.
function extractAgentName(input) {
  return input?.agent || input?.subagent_type || input?.subagentType || 'unknown';
}

function extractModel(input) {
  return input?.model || input?.modelID || '';
}

function extractTaskDescription(input) {
  if (!input) return '';
  // The task prompt may be under `prompt`, `description`, `task`, or `message`.
  const text = input?.prompt || input?.description || input?.task || input?.message || '';
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

  // Map<parentSessionID|startTime, eventID> — remembers which event id we
  // assigned at `before` time so the `after` hook can emit a matching
  // `agent.run.finished` with the same id. The dashboard matches by id.
  // Keyed by parent session + start time (composite) to avoid collisions
  // when a parent dispatches multiple sub-agents.
  const dispatchMap = new Map();

  function dispatchKey(parentSessionID, startTime) {
    return `${parentSessionID}|${startTime}`;
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

        dispatchMap.set(dispatchKey(parentSessionID, startTime), {
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
        const now = Date.now();

        // Find the matching `before` entry. We don't have the exact startTime
        // here, so we search for the most recent entry for this parent session.
        // This is safe because the parent dispatches sub-agents sequentially
        // (one task() call blocks until it returns before the next starts).
        let key = null;
        let entry = null;
        let oldestKey = null;
        let oldestTime = Infinity;
        for (const [k, v] of dispatchMap) {
          if (v.agent === extractAgentName(input) || k.startsWith(`${parentSessionID}|`)) {
            // Prefer the oldest matching entry (FIFO — the longest-waiting
            // dispatch is the one completing now).
            if (v.startTime < oldestTime) {
              oldestTime = v.startTime;
              oldestKey = k;
              entry = v;
            }
          }
        }
        key = oldestKey;

        if (!entry) {
          // No matching `before` entry — could happen if the plugin loaded
          // mid-session or the before-hook failed. Emit a finished event with
          // a fresh id anyway so the dashboard still gets a completion signal.
          // The started event will be missing (the dashboard warns but doesn't
          // crash on a finished-without-started).
          const eventID = randomUUID();
          const event = {
            type: 'agent.run.finished',
            id: eventID,
            ts: new Date(now).toISOString(),
            status: 'completed',
            elapsedSec: 0,
            errors: 0,
          };
          pushEvents([event]);
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
