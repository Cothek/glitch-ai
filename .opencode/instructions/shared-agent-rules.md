---
type: SharedRules
title: Shared Agent Rules
description: Ground rules that apply to all agents — primary and sub-agents.
tags: [glitch, shared, rules]
---

# Shared Agent Rules

The rules in this file apply to ALL agents — including sub-agents (@coder, @ui-designer, @reviewer, @testing, @general, @pentester, @memory, @vision). Every agent must follow these.

## Ground Rules

**R5: Intellectual Honesty Protocol**
9-point protocol. Core: (1) verify before claiming done, (2) acknowledge uncertainty, (3) surface trade-offs, (4) no false validation, (5) honest status reporting, (6) resist manufactured urgency, (7) surface hidden assumptions, (8) "Let me check" before ANY unverified claim about code/infrastructure/existence, (9) use `verify_claim` tool for high-stakes claims. Violations logged to scratchpad. Pattern of 3+ triggers skill creation.

**R8: Todo List**
Every task: (1) create todowrite with granular subtasks, (2) work through updating status in real time, (3) mark completed when done.

**R9: GitNexus Code Graph**
Use GitNexus MCP tools before code changes in indexed repos: `impact` for blast radius, `context` for callers/callees, `detect_changes` for diff analysis, `rename` for symbol renames, `query` for topic search.

**R16: Branch Discipline**
Never modify Glitch core files on main. All core work on develop or feature branches.

**R20: UI Design System Compliance**
Before ANY UI change: scan for `components/ui/` design system. If exists, ALL elements must use it. Never use raw `<button>`/`<input>` when Button/Input components exist. Never use nonexistent variants.

**R21: Stuck Detection**
`stuck-detector.js` monitors tool patterns. Writes `data/.stuck-signal.json` on: same tool 3+ times, 3+ consecutive errors, same bash command 2+ times. When signal exists: read it, load `skill("breakthrough")`, delete signal, reframe problem.

## Available Tools (Bash-Accessible)

These CLI tools are available to you. Use them to gather context, search memory, or check system state during your tasks.

**FTS5 Memory Search** — Full-text search over memory files using SQLite FTS5 with BM25 ranking.
```
node glitch-memorycore/plugins/embed-search/search-memory.mjs -q "<your query>" --json
```

**Image Storage Stats** — Check how much space pasted images are using in the opencode database.
```
node scripts/cleanup-opencode-images.mjs --stats
```

**GitNexus Code Graph (If Available)** — If the project is an indexed repo (ai-gm, ECD-website), use GitNexus MCP tools directly: `query` for intent search, `context` for symbol view, `impact` for blast radius, `detect_changes` for diff analysis, `rename` for coordinated rename.
```
