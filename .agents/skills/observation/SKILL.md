---
name: observation
description: "MUST use when user says 'survey project', 'scan project', 'check health',
             'investigate', 'deep dive', 'what's going on in', 'look into',
             'refine code', 'clean up code', 'review changes', 'sharpen',
             'audit system', 'full audit', 'show me everything',
             or when the AI needs to assess project health before planning,
             review code quality after implementation, or investigate a bug."
---

# Observation System — Tiered Code Awareness

## Four Commands

| Command | Depth | Time |
|---------|-------|------|
| **Survey** | Lv.1 | ~30 sec |
| **Investigate** | Lv.2 | ~5 min |
| **Refine** | Lv.2 (corrective) | ~5 min |
| **Audit** | Lv.3 | ~15 min |

## Survey Protocol
1. Dependency scan (read package manifests, project files)
2. **GitNexus: read `gitnexus://repo/{name}/processes` for execution flows, `gitnexus://repo/{name}/clusters` for module groupings**
3. Structure scan (file counts, architecture pattern)
4. Tech stack detection
5. Health check (build status, git status, last commit)
6. Recent activity (last 5 commits)
7. Output compact one-screen summary

## Investigate Protocol
1. Dependency scan
2. **GitNexus: if file path mode → run `context` on key symbols. If topic mode → run `query` across the codebase for hybrid search**
3. Mode dispatch:
   - File path → read file, map dependencies/dependents
   - Topic → grep across project, trace data flow
   - Bug → trace symptom to root cause
   - Review → code review checklist
4. Report findings with file:line references

## Refine Protocol
1. Dependency scan
2. Identify scope (git diff for no-arg, specific file, or area)
3. Read each file — understand intent before judging
4. Analyze: dead code, duplication, naming, complexity, efficiency, project rules
5. Report findings — **always ask permission before fixing**
6. Fix on approval, verify build after

## Audit Protocol
1. Full dependency scan (frontend + backend)
2. Load full context (session history, library entries, post-mortems)
3. Draw architecture map
4. Map all dependencies (explicit + implicit)
5. Trace all data flows
6. Risk assessment (HIGH/MEDIUM/LOW)
7. Prioritized recommendations
8. Knowledge connections to library

## Escalation Paths
```
Survey spots problem → Investigate that area
Investigate finds depth → Audit full system
Any tier finds code → Refine specific files
Refine finds systemic → Audit full system
```

## Mandatory Rules
1. Always dependency scan first
2. Never assume standard library behavior
3. Understand intent before judging
4. Refine always asks permission before fixing
5. Compact output for Survey; deeper tiers can be verbose

## Level History
- **Lv.1** — Base: Four-tier observation system with escalation paths.
- **Lv.2** — Cross-feature: Library, Post-Mortem, Work-Plan, Auto-Commit integration.
