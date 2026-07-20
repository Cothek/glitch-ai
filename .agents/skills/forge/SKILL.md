---
name: forge
description: "MUST use when user says 'create skill', 'new skill', 'forge this',
             'level up', 'upgrade skill', 'self improve',
             or when Glitch detects a repeated pattern (3+ occurrences),
             or after complex task completion (5+ steps), error recovery,
             or user corrections of approach,
             or when accumulated user feedback for a skill reaches 2+ entries."
---

# Forge Self-Improvement

## Activation
When this skill activates, output:
"Forging improvement from patterns..."

## Autonomous Creation Triggers (Lv.2)
Create a new skill autonomously (no approval needed) when ANY of these fire:

1. **Complex task completed** — 5+ tool calls with a non-trivial workflow
2. **Error recovery** — Hit errors/dead ends then found the working path
3. **User correction** — The user corrected your approach (especially if repeat)
4. **Non-trivial workflow crystallized** — A clear repeatable pattern emerged
5. **3+ occurrences** — Same ad-hoc task handled three times or more
6. **Tool creation via CodeAct-lite** — A tool was written, tested, and saved via `execute-tool.mjs --save-to`. If the tool addresses a pattern that could be a reusable skill, promote it.

### Auto-Creation Checklist
Before creating, verify:
- [ ] No existing skill covers this (check `skills-registry.md`)
- [ ] The workflow is concrete and repeatable (not one-off)
- [ ] You can write clear trigger descriptions
- [ ] You can document the steps precisely
- [ ] If creating a tool (not a skill): confirm `plugins/tools/` directory exists and tool is saved as `.mjs`

### Creation Steps

#### For Tools (via TDD workflow + lifecycle)
1. Write test cases as `{ input, expected }` pairs covering happy path + edge cases
2. Run with a stub to confirm tests fail: `tdd-test.mjs --code "function handler(i) { return null; }" --tests '[...]'`
3. Implement the handler function
4. Run `tdd-test.mjs` with `--save-on-pass plugins/tools/<name>.mjs`
5. Tool is automatically registered — trust level: `tested`
6. For subsequent use, invoke via `run-tool.mjs <name> --input '{}'` — tracks success/failure
7. Trust auto-promotes: 3+ runs → `validated`, 10+ runs → `live`
8. On 3 consecutive failures → flagged as `degraded` for review

#### For Skills
1. Create `.agents/skills/<name>/SKILL.md` using skill-format.md template
2. Register in `glitch-memorycore/plugins/glitch-skills/skills-registry.md` under "Auto-Created Skills"
3. Output: "Created new skill: [name] — triggers on [patterns]"
4. No approval needed — skill is live immediately

## Level-Up Existing Skill

Triggered when `user/pending-skill-improvements.md` has 2+ entries for the same skill, or 1 entry with `major`/`critical` significance.

### Level-Up Flow
1. **Load the feedback** — Read `user/pending-skill-improvements.md` to get the accumulated feedback for the target skill
2. **Load the target skill** — Read the skill's SKILL.md to understand current content
3. **Group feedback** — Group entries by topic (e.g., "anti-slop rules", "trigger descriptions", "edge case handling")
4. **Generate candidate diffs** — For each group of feedback, propose a specific change to the skill:
   - "Add to anti-slop rules: [new rule]"
   - "Update trigger description: [change]"
   - "Add verification step: [new step]"
5. **Present for approval** — Show the user: "Skill [name] has [N] accumulated feedback entries. Proposed changes: [diffs]. Apply? (Y/n)"
6. **Apply with approval** — If approved, dispatch the appropriate agent to edit the SKILL.md and update the entry status in `pending-skill-improvements.md`
7. **Log** — Record the level-up in `user/forge-log.md` with the skill name, what changed, and which feedback entries triggered it

### Significance Thresholds
| Pending Entries | Significance Level | Action |
|----------------|-------------------|--------|
| 1, minor | One-off nitpick | Hold for another occurrence |
| 1, notable | Clear preference | Present for approval at next compaction |
| 1, major | Explicit directive or repeat pattern | Present for approval at next compaction |
| 1, critical | Structural problem causing repeated failure | Present for approval immediately |
| 2+ (any significance) | Repeat feedback | Present for approval at next compaction |
| 3+ same topic | Crystallized pattern | Auto-promote to level-up (no approval needed for mechanical changes) |

### Example Level-Up
```
User feedback accumulated for 'ui-craft':
  1. "This dialog is too busy" — overlay had 5+ sections visible
  2. "Why are all the cards the same size?" — no visual hierarchy
  → Proposed: Add 2 new anti-slop rules (progressive disclosure, visual hierarchy)
  → Forge applies after user approval
  → Entry status → "applied"
```

### Contrast with Creation
- **Creation**: New skill from scratch, triggered by 3x+ workflow patterns or complex task completion
- **Level-Up**: Existing skill improvement, triggered by user feedback accumulation or directives

## Manual Trigger
User says "create skill" / "forge this" / "self improve":
1. Analyze recent patterns
2. Gather evidence (2+ concrete examples)
3. Propose skill creation or level-up with full details
4. Always ask for approval before creating files

## The Forge Flow
```
Pattern detected or user triggers Forge
  → Gather evidence
  → Accumulated feedback for existing skill? → Level-Up flow (user approval required)
  → Autonomous triggers? Create directly + register in index
  → Manual trigger? Propose → User approves → Create or Level-Up
  → Skill is live and auto-triggers in future
```

## Skill Loading Protocol
- Skills registry (`skills-registry.md`) is loaded at every session start
- Full skill content loaded on demand via progressive disclosure
- Auto-created skills appear under "Auto-Created Skills" in the registry

## Principles
1. Autonomous by default for clear patterns — no approval bottleneck
2. Human-in-the-loop for manual triggers and destructive changes
3. Evidence-based — 2+ concrete examples before proposing
4. Minimal viable skill — start at Lv.1, evolve organically
5. Always register new skills in the registry index

## Level History
- **Lv.1** — Base: Pattern detection, skill creation with human approval
- **Lv.2** — Autonomous: Auto-creates skills on complex tasks, error recovery, user corrections
- **Lv.3 target (Project Daedalus Phase 1-2)** — Tool creation via CodeAct-lite: agents write code, test via `execute-tool.mjs`, save as permanent tools. TDD-first methodology with sandbox testing before registration.
