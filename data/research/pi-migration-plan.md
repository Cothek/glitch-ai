# opencode → Pi Migration Plan

> **Date:** September 19, 2026
> **Author:** @coder (generated from Troy's specifications)
> **Status:** Draft v1
> **Scope:** Full migration from opencode to Pi as primary agent harness
> **Upstream:** [Pi Documentation/Repository]

---

## 1. Executive Summary

We are migrating from opencode to **Pi** as the primary agent harness. This plan is based on the Command Code migration plan structure, adapted for Pi's specific capabilities and architecture.

### Why Pi

1. **[Placeholder: Pi's key differentiators]**
   - [Reason 1]
   - [Reason 2]
   - [Reason 3]

2. **[Placeholder: Migration benefits]**
   - [Benefit 1]
   - [Benefit 2]

### Key Gate

Pi is **[open/closed] source**. [Details about licensing and availability].

**Migration is gated on [specific conditions].**

### Candidate Comparison

| Factor | opencode | Command Code | Pi |
|---|---|---|---|
| Context compression | None | Tiered compaction | [Pi's approach] |
| Local model support | Broken (27k payload) | Works (full context engineering) | [Pi's approach] |
| /import from opencode | N/A | Yes — native one-command bridge | [Pi's approach] |
| Extensibility | Plugins | Skills + Hooks + Mods API | [Pi's approach] |
| Remote access | Web UI + tunnel | Studio (TBD) + headless/RPC | [Pi's approach] |
| Pricing model | Free (self-hosted) | GOAT $10/mo or free BYOK | [Pi's pricing] |
| Open source | Yes | **Closed today, promised open** | [Pi's license] |
| Provider catalog | Manual config | 150+ BYOK, keyless Ollama | [Pi's providers] |
| Session management | Single session | Tree forking + checkpoints + /rewind | [Pi's approach] |
| Self-improvement | mulahazah hooks | Skills + Hooks + Mods API | [Pi's approach] |
| Token visibility | None | /context real-time accounting | [Pi's approach] |
| Style learning | None | Taste (learns from history) | [Pi's approach] |

### Decision Rationale

[Placeholder: Why Pi over Command Code and other alternatives]

---

## 2. Pi Architecture Overview

### Core Components

[Placeholder: Document Pi's architecture]

- **Memory System**: [How Pi handles memory]
- **Extensibility**: [How to extend Pi]
- **Session Management**: [How Pi manages sessions]
- **Model Integration**: [How Pi connects to models]

### Key Differences from opencode

| Aspect | opencode | Pi |
|--------|----------|-----|
| Memory loading | Load once at session start | [Pi's approach] |
| Context management | None | [Pi's approach] |
| Tool execution | Direct | [Pi's approach] |
| Agent dispatch | Sub-agents | [Pi's approach] |

---

## 3. Memory System Mapping

### Pi's Memory Architecture

[Placeholder: Document Pi's memory system]

### Migration Plan: User Memory

**Strategy**: [How to migrate user memory to Pi]

**Mapping Table**:

| Our File | Pi Equivalent | Import Method |
|---|---|---|
| `user/main-memory.md` | [Pi's location] | [Import method] |
| `user/decisions.md` | [Pi's location] | [Import method] |
| `user/patterns.md` | [Pi's location] | [Import method] |
| `user/reminders.md` | [Pi's location] | [Import method] |
| `user/current-session.md` | [Pi's location] | [Import method] |
| `user/daily-diary/*.md` | [Pi's location] | [Import method] |

---

## 4. What Needs Building (Gaps)

### 4.1 Living-Diary Loop

**Current system**: mulahazah detects trigger → flag file → memory agent → diary write

**Pi replacement**: [How Pi handles this]

**Implementation approach**:
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Effort**: [Estimated time]

### 4.2 Remote Browser Access

**Current system**: opencode web server → Cloudflare tunnel → browser

**Pi situation**: [Pi's remote access capabilities]

**If Pi supports self-hosting**:
- [Steps]

**If Pi is SaaS-only**:
- [Steps]

**Existing infrastructure that transfers**:

| Asset | Status | Notes |
|---|---|---|
| `*.cothekdesigns.com` wildcard DNS | Ready | Cloudflare DNS config |
| Cloudflare Access policies | Ready | Authentication layer |
| Cloudflare tunnel daemon | Ready | Routes to local ports |
| Next.js web app | Adaptable | May need route changes |

**Effort**: [Estimated time]

### 4.3 Mulahazah Self-Improvement Triggers

**Current system**: Hook observation → pattern detection → forge/post-mortem triggers

**Pi replacement**: [Pi's hook/trigger system]

**Specific mappings**:

| mulahazah Trigger | Pi Equivalent | Notes |
|---|---|---|
| Tool repetition (3+ same tool) | [Pi's approach] | [Notes] |
| Error cascade (3+ consecutive errors) | [Pi's approach] | [Notes] |
| Command repetition (same bash 2+) | [Pi's approach] | [Notes] |
| Readonly repetition (6+ read/glob/grep) | [Pi's approach] | [Notes] |
| Permission loop (2+ denied) | [Pi's approach] | [Notes] |

**Effort**: [Estimated time]

### 4.4 Watchdog / Stuck-Detector Equivalents

**Current system**: `watchdog-external.mjs` monitors bash sessions, `stuck-detector.js` detects stuck patterns

**Pi replacement**: [Pi's monitoring capabilities]

**Watchdog mapping**:

| Component | Current Implementation | Pi Approach |
|---|---|---|
| `watchdog-external.mjs` | Separate process, polls SQLite DB | [Pi's approach] |
| Hung process detection | OS enumeration of descendants | [Pi's approach] |
| Process tree kill | `taskkill /F /T /PID` | [Pi's approach] |
| Session abort | `abort-agent.mjs` | [Pi's approach] |
| `stuck-detector.js` | In-process, monitors tool patterns | [Pi's approach] |
| Stuck signal files | `data/.stuck-signal.<session>.json` | [Pi's approach] |

**Effort**: [Estimated time]

---

## 5. Skills Migration

### Pi Skills Format

[Placeholder: Document Pi's skill format]

### Compatibility with Glitch Skills

| Glitch Component | Pi Equivalent | Replaceable? |
|---|---|---|
| `.agents/skills/*/SKILL.md` | [Pi's location] | [Yes/No] |
| Skill frontmatter | [Pi's format] | [Yes/No] |
| `skill(name)` tool invocation | [Pi's invocation] | [Yes/No] |
| Trigger phrases | [Pi's trigger system] | [Yes/No] |
| Supporting files | [Pi's structure] | [Yes/No] |

### Migration Action

[Placeholder: Steps to migrate skills]

**Effort**: [Estimated time]

---

## 6. What We Get Free

### Capabilities Pi Provides Out-of-the-Box

| Capability | Details | Impact |
|---|---|---|
| [Capability 1] | [Details] | [Impact] |
| [Capability 2] | [Details] | [Impact] |
| [Capability 3] | [Details] | [Impact] |

### What This Means for Our Workflow

[Placeholder: How Pi improves our current workflow]

---

## 7. Migration Checklist — Phases

### Migration Strategy

[Placeholder: Parallel running, cold cutover, or hybrid approach]

### Phase 0: Smoke Tests

- [ ] Install Pi and verify it runs
- [ ] Test model integration
- [ ] Check extensibility capabilities
- [ ] Verify memory system works
- [ ] Test basic workflows

### Phase 1: Import & Setup

- [ ] Import opencode artifacts into Pi
- [ ] Verify skills imported correctly
- [ ] Verify memory files migrated
- [ ] Test end-to-end workflows

### Phase 2: Memory System

- [ ] Set up Pi's memory architecture
- [ ] Migrate user memory files
- [ ] Verify memory persistence
- [ ] Test memory search (if available)

### Phase 3: Remote Access

- [ ] Set up remote access
- [ ] Configure authentication
- [ ] Test from secondary devices
- [ ] Verify session management

### Phase 4: Self-Improvement Triggers

- [ ] Port mulahazah triggers to Pi
- [ ] Port stuck-detector
- [ ] Port watchdog
- [ ] Test all monitoring systems

### Phase 5: Decommission opencode

- [ ] Archive opencode installation
- [ ] Update documentation
- [ ] Close opencode-related issues
- [ ] Remove opencode from PATH

---

## 8. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | [Risk 1] | [Likelihood] | [Impact] | [Mitigation] |
| R2 | [Risk 2] | [Likelihood] | [Impact] | [Mitigation] |
| R3 | [Risk 3] | [Likelihood] | [Impact] | [Mitigation] |
| R4 | [Risk 4] | [Likelihood] | [Impact] | [Mitigation] |
| R5 | [Risk 5] | [Likelihood] | [Impact] | [Mitigation] |

---

## 9. Quality Assessment & Test Plan

### Online Quality Reports

[Placeholder: Research Pi's quality reputation from online sources]

### Test Plan Before Migration

#### Phase 0: Quality Validation

**Objective**: Verify Pi quality meets minimum threshold.

**Test 1: Simple Task Quality**
- Task: [Simple task]
- Metrics: [Metrics]
- Pass criteria: [Criteria]
- Time limit: [Time]

**Test 2: Complex Task Quality**
- Task: [Complex task]
- Metrics: [Metrics]
- Pass criteria: [Criteria]
- Time limit: [Time]

**Test 3: Context Retention**
- Task: [Multi-step task]
- Metrics: [Metrics]
- Pass criteria: [Criteria]
- Time limit: [Time]

**Test 4: Hallucination Check**
- Task: [Hallucination test]
- Metrics: [Metrics]
- Pass criteria: [Criteria]
- Time limit: [Time]

**Test 5: Code Review Quality**
- Task: [Code review test]
- Metrics: [Metrics]
- Pass criteria: [Criteria]
- Time limit: [Time]

#### Test Execution Protocol

1. [Step 1]
2. [Step 2]
3. [Step 3]
4. [Step 4]

#### Pass/Fail Criteria

| Criterion | Minimum Threshold | Ideal |
|-----------|-------------------|-------|
| Simple task quality | [Score] | [Score] |
| Complex task quality | [Score] | [Score] |
| Context retention | [Criteria] | [Criteria] |
| Hallucination rate | [Rate] | [Rate] |
| Code review depth | [Depth] | [Depth] |

#### If Tests Fail

**Option A**: [Option A]
**Option B**: [Option B]
**Option C**: [Option C]

---

## 10. Timeline + Success Criteria

### Timeline

| Phase | Depends On | Estimated Duration | Deliverables | Notes |
|---|---|---|---|---|
| Phase 0: Smoke tests | Nothing | [Duration] | [Deliverables] | [Notes] |
| Phase 1: Import & setup | Phase 0 | [Duration] | [Deliverables] | [Notes] |
| Phase 2: Memory system | Phase 1 | [Duration] | [Deliverables] | [Notes] |
| Phase 3: Remote access | Phase 1 | [Duration] | [Deliverables] | [Notes] |
| Phase 4: Self-improvement | Phase 2 | [Duration] | [Deliverables] | [Notes] |
| Phase 5: Decommission | All phases | [Duration] | [Deliverables] | [Notes] |

**Total estimated**: [Total time]

**Critical path**: [Critical path]

**Parallel tracks**: [Parallel work]

### Success Criteria

**Phase 0 — Smoke Tests:**
- [ ] Pi installed and running
- [ ] Model integration verified
- [ ] Extensibility confirmed
- [ ] Memory system works
- [ ] Basic workflows validated

**Phase 1 — Import & Setup:**
- [ ] All artifacts imported
- [ ] Skills loaded correctly
- [ ] Memory files migrated
- [ ] End-to-end workflows working

**Phase 2 — Memory System:**
- [ ] Memory architecture set up
- [ ] User memory migrated
- [ ] Memory persistence verified
- [ ] Memory search working

**Phase 3 — Remote Access:**
- [ ] Remote access working
- [ ] Authentication configured
- [ ] Secondary device access verified
- [ ] Session management working

**Phase 4 — Self-Improvement:**
- [ ] Triggers ported
- [ ] Stuck-detector working
- [ ] Watchdog functional
- [ ] All monitoring tested

**Phase 5 — Decommission:**
- [ ] opencode archived
- [ ] Documentation updated
- [ ] Issues closed
- [ ] opencode removed from PATH

**Overall Success:**
- [ ] Pi installed and running with [model access]
- [ ] All Glitch memory preserved — zero data loss
- [ ] Git discipline unchanged
- [ ] Local models work (if applicable)
- [ ] Remote access functional
- [ ] Self-improvement triggers adapted
- [ ] Rollback available

---

*This document is based on the Command Code migration plan structure, adapted for Pi.*

*Generated from Troy's migration specifications. Update as implementation progresses.*

*Next action: Research Pi's capabilities and complete this migration plan.*
