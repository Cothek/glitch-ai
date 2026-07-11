---
name: self-review
description: "MUST load at compaction checkpoints to perform system self-review.
              Meta-agent protocol: reads Glitch's own configuration and identifies
              improvement opportunities.
              Activates when: R3 step 7 fires (compaction checkpoint),
              or user says 'self review', 'system health', 'audit config',
              'check agents', 'meta review'."
---

# Meta-Agent: System Self-Review

## Activation
When this skill activates, output:
"🔄 System self-review — reading configuration, agents, skills, and prompts..."

## Overview

The meta-agent is a **passive review protocol** that runs at compaction checkpoints. It reads Glitch's own system files and identifies improvement opportunities. It does NOT apply changes autonomously — it produces a structured report for Glitch to evaluate.

**Inspired by**: HyperAgents (metacognitive self-modification), SICA (self-patching via test validation), Karpathy Auto-Research (meta-agent modifies task agent harness).

## Review Checklist

### 1. Agent Configs (`opencode.json`)

Read the file and check each agent object:

| Check | What to look for |
|-------|-----------------|
| **Model adequacy** | Is each agent on the right model for its task type? (e.g., @coder on a weak model = bad) |
| **Missing agents** | Is there a recurring task type that has no dedicated agent? |
| **Orphaned agents** | Are there agents defined in opencode.json that don't appear in prompt-rules.md Selection Guide? |
| **Missing agents** | Are there agents referenced in prompt-rules.md that don't exist in opencode.json? |
| **Stale prompts** | Do any agent prompts reference old file paths or outdated workflows? |
| **Config errors** | Missing fields, broken permission rules, invalid instructions paths |

### 2. Skills Registry (`skills-registry.md`)

Check every registered skill:

| Check | What to look for |
|-------|-----------------|
| **Path validity** | Does the SKILL.md file exist at the registered path for each skill? |
| **Trigger accuracy** | Does the trigger description match what the skill actually does? |
| **Stale skills** | Skills not triggered in 30+ days (check forge-log for usage) |
| **Overlap** | Two skills with overlapping triggers (redundant) |
| **Missing skills** | Common workflows with no skill coverage |
| **Auto-created orphans** | Auto-created skills that were never registered in the registry |

### 3. Prompt Rules (`prompt-rules.md`)

Check the behavioral rules:

| Check | What to look for |
|-------|-----------------|
| **Dead references** | File paths or agent names that no longer exist |
| **Contradictions** | Two rules that conflict or override each other implicitly |
| **Gaps** | Common scenarios with no rule coverage |
| **Stale rules** | Rules written for workflows that have since changed |
| **Agent Selection Guide** | Does it match the actual agents in opencode.json? |

### 4. Performance & Patterns

From `current-session.md` scratchpad and `forge-log.md`:

| Check | What to look for |
|-------|-----------------|
| **Recurring errors** | Same PM-NNN post-mortem appearing 2+ times (root cause not fixed) |
| **Slow tasks** | Tasks that consistently take multiple iterations (skill gap?) |
| **Workaround patterns** | Same workaround used repeatedly (should be a built-in fix) |
| **Token waste** | Over-powered agent used for simple tasks (e.g., @coder for a one-line edit) |
| **Unused capabilities** | Tools, skills, or agents built but never used |

## Report Format

The meta-agent produces a structured report:

```markdown
## System Health Report — YYYY-MM-DD

### ⛔ BLOCKERS (must fix immediately)
- [ ] Description with file path and line reference

### ⚠️ ISSUES (should fix soon)
- [ ] Description with file path and recommendation

### 💡 SUGGESTIONS (nice to have)
- [ ] Description and estimated effort

### ✅ HEALTHY
- Agent configs: N agents, all valid
- Skills: N registered, all paths valid
- Rules: N rules, no contradictions found
- Tools: N installed (execute-tool, tdd-test)
```

### Severity Definitions

| Severity | Meaning | Action |
|----------|---------|--------|
| **BLOCKER** | Would prevent launch or cause data loss | Fix immediately, do not proceed |
| **ISSUE** | Degrades quality, efficiency, or maintainability | Fix within current session |
| **SUGGESTION** | Nice-to-have improvement | Log and consider for next session |

## Action Rules

1. **BLOCKERs**: Report to the user immediately — do not wait for compaction summary
2. **ISSUEs**: Include in compaction summary with fix recommendations
3. **SUGGESTIONs**: Log in reminders.md for next session
4. **NEVER modify opencode.json, agent prompts, or prompt-rules.md autonomously** — always ask for the user's approval first
5. **The only exception**: Skills-registry.md updates (new skills, updated descriptions) — auto-commit per R12 fast-lane rules
6. **Self-modification constraint**: If the meta-agent identifies an improvement to ITS OWN SKILL.md (self-review), it can propose changes but MUST NOT apply them without approval

## Trigger Workflow

```
Compaction checkpoint (R3 step 7 fires)
  → Load self-review skill
  → Read: opencode.json, skills-registry.md, all SKILL.md frontmatter,
           prompt-rules.md, current-session.md scratchpad, forge-log.md
  → Run all 4 checklist sections
  → Produce structured report
  → Apply action rules (blocker → immediate, issue → summary, suggestion → reminders)
  → Continue compaction
```

## Level History
- **Lv.1** — Passive: Reads system files, produces report, no autonomous changes
- **Lv.2 future** — Active: Can propose patches to config and prompts, user approves in bulk
- **Lv.3 future** — Autonomous: Applies non-destructive improvements (skill re-registration, path fixes) without approval
