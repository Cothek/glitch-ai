---
name: post-mortem
description: "Auto-triggers when failure signals are detected (deployment failure,
             broken tests, wasted time, architecture reversal, security incident,
             data loss). Also triggers on 'post-mortem' command."
---

# Post-Mortem System

## Activation
When a failure signal is detected, ask:
"That didn't go as planned. Worth a post-mortem?"

## Protocol

### Step 1: Gather Details
If user says yes:
1. What happened? (factual description)
2. Why? (root cause analysis)
3. Impact? (time, data, momentum lost)
4. Severity? (Minor / Moderate / Major)

### Step 2: Record Entry
Append to `main/post-mortems.md`:
```
## YYYY-MM-DD — [Short title]
**Severity**: Minor | Moderate | Major
**What happened**: [Description]
**Why**: [Root cause]
**Impact**: [What was lost]
**Lesson**: [Reusable insight]
**Prevention**: [Specific action]
```

### Step 3: Reference
When starting work in a domain, check `main/post-mortems.md` for relevant past lessons.

## Rules
- No blame — learning tool only
- Append-only — never rewrite or delete
- Honest — if it was a mistake, say so
- Actionable — every entry must have a Prevention action

## Level History
- **Lv.1** — Base: Auto-detected failure logging with narrative recall.
