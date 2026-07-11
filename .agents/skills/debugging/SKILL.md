---
name: debugging
description: "MUST use when user says 'debug', 'something broke', 'it crashed',
              'bug', 'error at', 'not working', 'doesn't work', 'trace this',
              'find the issue', 'why is', or when a command/process fails unexpectedly,
              error output is shown, or investigation of runtime behavior is needed."
---

# Debugging — Root Cause Analysis Workflow

## Activation
When this skill activates, output:
"Running debug protocol..."

## Protocol

### Phase 1: Reproduce & Scope
1. If error output exists → capture full error message + traceback
2. If bug report → clarify: what happened vs what should have happened
3. If flaky/intermittent → identify reproduction steps and frequency
4. Scope the problem: compilation error? runtime crash? wrong output? perf?

### Phase 2: Gather Evidence
1. Check recent git log (`git log --oneline -10`) — did something change?
2. Check git diff to see what's uncommitted
3. **Run GitNexus `context` on the failing symbol** — returns callers, callees, process participation in one call. Replaces manual sequential grep+read for dependency tracing.
4. Read the file + surrounding context (imports, dependents from GitNexus result)
5. Check dependency versions if applicable

### Phase 3: Hypothesis-Driven Search
1. Form a hypothesis matching the symptom
2. Trace the data/call flow from entry to failure point
3. Check null/edge cases, type mismatches, off-by-one, race conditions
4. Add targeted debug output OR use language-appropriate debugging tools
5. Verify hypothesis with minimal reproduction

### Phase 4: Fix & Verify
1. Apply minimal fix (change only what's necessary)
2. Verify with existing tests
3. Create a regression test if none exists for this path
4. Run full test suite / build before marking done

### Phase 5: Close the Loop
1. Log root cause and fix in session context
2. If the pattern looks repeatable → suggest post-mortem
3. If you had to learn something new → save to library

## Escalation
```
Phase 2 stalls → Investigate (observation skill)
Phase 3 fails → Full audit (observation skill)
Repeat bug in same area → Create post-mortem
```

## Mandatory Rules
1. Always reproduce or confirm the error before fixing
2. Change one variable at a time — never shotgun fix
3. Never delete code you don't understand
4. Always run tests after fixing
5. If stuck >10 min, escalate or ask for fresh eyes

## Level History
- **Lv.1** — Base: Structured 5-phase root cause analysis protocol.
