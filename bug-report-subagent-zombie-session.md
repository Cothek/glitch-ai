# Bug Report: `task` tool blocks parent session indefinitely when sub-agent LLM call fails

**Title:** Sub-agent zombie session — `task` tool blocks parent forever with no timeout or cancel mechanism when LLM call fails

---

## Description

When a sub-agent's LLM call fails with `AI_APICallError` (related to #29566), the sub-agent session enters a zombie state — it is never terminated, and the error is never propagated back to the parent session. The `task` tool blocks the parent session indefinitely with no timeout, no cancel mechanism, and no error feedback.

This makes any unreliable model provider unrecoverable. An API error that fires in ~100ms permanently locks the parent session until the process is force-killed.

---

## Steps to Reproduce

1. Configure a sub-agent using a provider that may return `AI_APICallError` (e.g. `opencode/deepseek-v4-flash-free` free tier, or any provider with transient failures)
2. From a primary agent (delegator), dispatch a task to the sub-agent using the `task` tool with `subagent_type: "general"`
3. Observe: the sub-agent session is created, the LLM call fails instantly, but the session is never cleaned up
4. The parent session becomes permanently blocked — no further tool calls work, the UI becomes unresponsive

---

## Expected Behavior

When a sub-agent's LLM call fails with a non-recoverable error (`AI_APICallError`):

- The sub-agent session should be **terminated immediately**
- The error should be **propagated back to the parent session** via the `task` tool return value
- The parent session should **receive control back** so it can handle the failure gracefully

**OR** the `task` tool should have:
- A **configurable timeout parameter** to prevent indefinite blocking
- A **cancel mechanism** so the parent can abort a hung sub-agent

---

## Actual Behavior

The LLM error occurs within ~100ms, but:

1. The sub-agent session stays alive in a zombie state — **no automatic cleanup**
2. The `task` tool **never returns control** to the parent session
3. The parent session is **permanently blocked** — cannot make tool calls, cannot respond to the user
4. The only recovery is to **force-kill the opencode process**

---

## Server Log Evidence

From `~/.local/share/opencode/log/2026-05-29T215503.log` (opencode v1.15.10, Windows 11):

```
# Session created at T+0s
INFO  23:52:35  session id=ses_189d892a... parentID=ses_18b755b34ffe...
       title="Test free model timeout (@general subagent)" created

# Session prompt loop starts
INFO  23:52:35  session.prompt session.id=ses_189d892a... step=0 loop

# Session processor starts
INFO  23:52:36  session.processor session.id=ses_189d892a... process

# LLM stream starts
INFO  23:52:36  llm providerID=opencode modelID=deepseek-v4-flash-free
       session.id=ses_189d892a... agent=general mode=subagent stream

# AI_APICallError fires at T+110ms
ERROR 23:52:36 +110ms  llm providerID=opencode modelID=deepseek-v4-flash-free
       session.id=ses_189d892a... agent=general mode=subagent
       error={"error":{"name":"AI_APICallError",
              "url":"https://opencode.ai/zen/v1/chat/completions",
              "requestBodyValues":{
                "model":"deepseek-v4-flash-free","max_tokens":32000,"temperature":0.2
              }}}

# Error is logged but session is NOT terminated — NO cleanup follows
# Session goes silent — no retries, no abort, no error propagation

# ... 6 minutes 14 seconds of dead silence ...

# Parent session forced cancel at T+6m14s
INFO  23:58:50  session.prompt session.id=ses_18b755b34ffe... cancel
INFO  23:58:50  session.prompt session.id=ses_189d892a... cancel
ERROR 23:58:50  session.processor session.id=ses_189d892a... error=Aborted process
```

### Timeline Summary

| Time | Event | Delta |
|------|-------|-------|
| 23:52:35 | Sub-agent session created | T+0s |
| 23:52:36 | `AI_APICallError` fires | **+110ms** |
| 23:52:36 → 23:58:50 | ⚠️ **Dead zone** — zombie session, parent blocked | **+6m14s** |
| 23:58:50 | Parent session externally canceled → child released → `task` returns empty | |

---

## Key Observations

1. **Error detection is instant** — `AI_APICallError` fires in ~110ms. The tool knows it failed.
2. **No cleanup follows** — the error is logged but the sub-agent session is never terminated. No abort, no timeout, no retry logic kicks in.
3. **`task` tool has no timeout** — once dispatched, there is no way to specify or configure a maximum wait time.
4. **No cancel mechanism exists** — the parent session cannot abort the sub-agent. There is no API, tool, or signal to cancel a pending `task` call.
5. **No error propagation** — the `AI_APICallError` is logged server-side but never returned to the parent. The parent gets an empty result with no indication of what failed.
6. **Session cascade** — the child zombie session is only released when the *parent* session is externally canceled (via UI reload, timeout, or process kill).

---

## Impact

- **Critical.** Any provider returning `AI_APICallError` (even transiently) permanently locks the parent session.
- All sub-agents using the `opencode` (free) provider are affected, since the `zen` endpoint is returning errors.
- Other providers configured with transient API issues would cause the same unrecoverable block.
- Workflow impact: delegator agents cannot use the `task` tool with unreliable providers at all.

---

## Suggested Fixes

**Priority: HIGH** — this is a correctness/safety issue, not a feature gap.

### Option A: Propagate Errors to Parent (Recommended)
When a sub-agent's LLM call fails with a non-recoverable error (`AI_APICallError`), terminate the sub-agent session and return the error to the parent session's `task` tool call. The parent should receive `{ error: "AI_APICallError", details: ... }` instead of an empty result.

### Option B: Add `task` Tool Timeout Parameter
Add an optional `timeoutMs` parameter to the `task` tool. If the sub-agent doesn't complete within the timeout, the task is automatically aborted and the parent receives control back with a timeout error.

### Option C: Session-Level Garbage Collection
Implement a server-side timeout for sub-agent sessions. If a sub-agent session is in an error state for more than N seconds, garbage-collect it and release any blocked parent sessions.

---

## Related Issues

- **#29566** — `ERROR AI_APICallError to https://opencode.ai/zen/go/v1/messages`  
  (Same `AI_APICallError` on the provider side. Assigned to @kitlangton. Does not address the zombie session problem.)

- **#29616** — `Custom mode: "subagent" agents not invocable via @name or task tool`  
  (Custom subagent task tool invocation issues. Assigned to @nexxeln.)

---

## Environment

| Field | Value |
|-------|-------|
| OpenCode version | 1.15.10 |
| Platform | Windows 11 (also reported on WSL Ubuntu 26 in #29566) |
| Provider | `opencode` (free tier: `deepseek-v4-flash-free`) |
| Failing endpoint | `https://opencode.ai/zen/v1/chat/completions` |
| Error type | `AI_APICallError` (Vercel AI SDK) |
| Server log location | `~/.local/share/opencode/log/` |
