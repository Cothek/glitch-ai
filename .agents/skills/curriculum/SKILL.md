---
name: curriculum
description: "MUST load at compaction checkpoints for self-play curriculum.
              Generates challenges, dispatches attempts, scores results,
              and progresses through levels autonomously.
              Activates when: R3 step 8 fires (after forge + self-review),
              or user says 'curriculum', 'self-play', 'challenge me',
              'run curriculum', 'what can I learn'."
---

# Self-Play Curriculum — Autonomous Challenge System

## Activation
When this skill activates, output:
"🎯 Self-play curriculum — generating challenge at level [N]..."

## Overview

The self-play curriculum is the final phase of **Project Daedalus**. It gives Glitch the ability to generate its own improvement tasks, attempt them, and progress through difficulty levels autonomously.

**Inspired by**: Self-Challenging Agents (Zhou et al., NeurIPS 2025) — LLM plays two roles: challenger creates tasks (instruction + test code), executor solves them. Solved tasks become capability.

**Key insight**: Self-improvement only works reliably with verifiable reward signals. All curriculum challenges have clear pass/fail criteria (tests pass, tool works, memory found).

## Levels

| Level | Challenge Type | Pass Criteria | Promote At |
|-------|---------------|---------------|------------|
| 1 | **Tool creation** — build a single-function tool | `tdd-test.mjs` all pass | 3 tools created at this level |
| 2 | **Tool chains** — combine tools for multi-step tasks | End-to-end execution passes | 5 tools total in registry |
| 3 | **System improvement** — propose+apply config/skill fix | Report accepted + committed | 3 improvements applied |
| 4 | **Memory consolidation** — deduplicate/improve memory | Merge applied, no regressions | 2 consolidations done |
| 5 | **Meta-curriculum** — improve the curriculum itself | Self-referential patch works | Voluntary |

## Challenge Pool

### Level 1 — Tool Creation

Each challenge specifies a tool to build with test cases. The agent writes code, runs `tdd-test.mjs`, and saves on pass.

| # | Description | Test Cases | Tags |
|---|-------------|------------|------|
| 1 | Sort an array of numbers ascending | `[3,1,2]`→`[1,2,3]`, `[]`→`[]`, `[5,5,5]`→`[5,5,5]` | array, sort |
| 2 | Reverse a string | `"hello"`→`"olleh"`, `""`→`""`, `"a"`→`"a"` | string, reverse |
| 3 | Extract all numbers from a string | `"abc123def456"`→`[123,456]`, `"none"`→`[]`, `"42"`→`[42]` | string, extract |
| 4 | Validate an email address | `"a@b.com"`→`true`, `"not@valid"`→`false`, `""`→`false` | validate, email |
| 5 | Count word frequency | `"a b a"`→`{a:2,b:1}`, `"hi"`→`{hi:1}`, `""`→`{}` | string, count |
| 6 | Remove duplicates from an array | `[1,2,1,3]`→`[1,2,3]`, `[]`→`[]`, `[1,1,1]`→`[1]` | array, unique |
| 7 | Capitalize each word in a string | `"hello world"`→`"Hello World"`, `"a"`→`"A"`, `""`→`""` | string, format |
| 8 | Flatten a nested array | `[1,[2,[3]]]`→`[1,2,3]`, `[]`→`[]`, `[1]`→`[1]` | array, flatten |
| 9 | Convert CSV row to JSON object | `"name,age\nTroy,30"`→`[{name:"Troy",age:30}]`, etc. | csv, parse |
| 10 | Validate a URL format | `"https://x.com"`→`true`, `"not-a-url"`→`false`, `""`→`false` | validate, url |
| 11 | Check if a string is a palindrome | `"racecar"`→`true`, `"hello"`→`false`, `""`→`true`, `"a"`→`true` | string, palindrome |

### Level 2 — Tool Chains

Combine existing tools to solve multi-step problems.

| # | Description | Success Criteria |
|---|-------------|-----------------|
| 1 | Process a CSV: parse, validate emails, sort by field | Output matches expected |
| 2 | Extract numbers from log text, sum them, format result | Correct arithmetic |
| 3 | Given a sentence: word-count, reverse words, capitalize | Correct transformation pipeline |
| 4 | Validate a list of emails + URLs, return only valid ones | Correct filtering |

### Level 3 — System Improvement

Improve the Glitch system itself.

| # | Description | Success Criteria |
|---|-------------|-----------------|
| 1 | Find a skill with an inaccurate trigger description and fix it | PR description + change committed |
| 2 | Identify an agent in opencode.json on a suboptimal model and propose upgrade | Proposal documented |
| 3 | Find a gap in prompt-rules.md and write a new rule | Rule + rationale documented |
| 4 | Review forge-log.md for undocumented automation triggers | Missing triggers documented |

### Level 4 — Memory Consolidation

Keep memory lean and clean.

| # | Description | Success Criteria |
|---|-------------|-----------------|
| 1 | Search memory for duplicate entries on the same topic | Duplicates flagged |
| 2 | Find stale references (paths that don't exist) | Dead refs documented |
| 3 | Consolidate two related diary entries into a single summary | Summary written |

### Level 5 — Meta-Curriculum

Improve the curriculum itself.

| # | Description | Success Criteria |
|---|-------------|-----------------|
| 1 | Add a new Level 1 challenge to the pool | Challenge added to this SKILL.md |
| 2 | Find a challenge that's too easy or hard and adjust it | Difficulty adjusted |
| 3 | Propose a new level type | Level spec added |

## Curriculum State

Tracked in `plugins/curriculum/curriculum-state.json`:

```json
{
  "level": 1,
  "completedChallenges": ["C001", "C002"],
  "completedDetails": [
    { "id": "C001", "description": "Sort array ascending", "toolSaved": "sort-array.mjs", "timestamp": 1700000000 },
    { "id": "C002", "description": "Reverse a string", "toolSaved": "reverse-string.mjs", "timestamp": 1700000100 }
  ],
  "failedChallenges": [],
  "toolsCreated": 0,
  "startedAt": 1700000000,
  "lastAttemptAt": 1700000100,
  "toolsAtStart": 0,
  "skillsImproved": []
}
```

If the state file doesn't exist, create it with `{ "level": 1, "completedChallenges": [], "completedDetails": [], "failedChallenges": [], "toolsCreated": 0, "startedAt": <now>, "lastAttemptAt": null, "toolsAtStart": <current tool count>, "skillsImproved": [] }`.

## Trigger Workflow

At R3 step 8 (after forge check and self-review):

```
1. Load curriculum state
2. Check current level and completed challenges
3. Check if level promotion criteria are met:
   - Level 1: 3 tools created → promote to Level 2
   - Level 2: 5 total tools → promote to Level 3
   - Level 3: 3 improvements → promote to Level 4
   - Level 4: 2 consolidations → promote to Level 5
4. Pick next uncompleted challenge at current level
5. Attempt the challenge:
   - Level 1: Dispatch to @coder or @general
     "Build a tool that [description]. Use tdd-test.mjs with these test cases:
      [test cases]. Save on pass to plugins/tools/<name>.mjs"
   - Level 2+: Dispatch to @coder or @general with description
6. Score the result:
   - tdd-test.mjs all pass → challenge passed
   - tdd-test.mjs any fail → challenge failed (log result, retry next time)
7. Update curriculum state: record pass/fail, update tools count
8. If 3 consecutive failures at same level → log to forge-log.md as gap
9. Continue compaction
```

## Verifier Integration

All Level 1 challenges use `tdd-test.mjs` as the verifier:
```bash
node plugins/dev-loop/tdd-test.mjs \
  --code "function handler(input) { /* agent's implementation */ }" \
  --tests '[{"input": <input>, "expected": <expected>, "name": "test name"}]'
```

Pass → save to tools/, update curriculum state.
Fail → agent iterates, re-dispatch at next compaction.

Level 2+ verifiers are challenge-specific and documented in the success criteria.

## Level History
- **Lv.1** — Leveled challenges with deterministic test pools
- **Lv.2 future** — Agent-generated challenges (LLM creates test cases for novel tasks)
- **Lv.3 future** — Cross-domain transfer (challenges in writing, design, strategy with learned verification)
