# opencode → Pi Migration Plan

> **Date:** September 19, 2026
> **Author:** @coder (generated from Troy's specifications)
> **Status:** Draft v1
> **Scope:** Full migration from opencode to Pi as primary agent harness
> **Upstream:** [github.com/earendil-works/pi](https://github.com/earendil-works/pi)
> **Website:** [pi.dev](https://pi.dev)

---

## 1. Executive Summary

We are migrating from opencode to **Pi** as the primary agent harness. Pi is a minimal, open-source terminal coding harness that follows a "primitives, not features" philosophy — building capabilities as extensions rather than baking them into the core.

### Why Pi

1. **Open source with MIT license** — no vendor lock-in, full control over the codebase
2. **Minimal core, extensible via primitives** — extensions, skills, prompt templates, themes
3. **Tree-structured sessions** — branch anywhere, explore multiple approaches, share history
4. **15+ providers, hundreds of models** — Anthropic, OpenAI, Google, Ollama, and more
5. **Context engineering** — AGENTS.md, SYSTEM.md, compaction, dynamic context injection
6. **Four modes** — interactive, print/JSON, RPC, SDK (embeddable)
7. **Self-modifying** — ask Pi to build extensions for itself, hit `/reload`

### Key Advantage Over Command Code

Pi is **open source today** (MIT License), while Command Code is still closed source. This eliminates the primary migration gate for Command Code.

### Candidate Comparison

| Factor | opencode | Command Code | Pi |
|---|---|---|---|
| **License** | Open source | **Closed source** | **Open source (MIT)** |
| **Philosophy** | Feature-rich | Feature-rich | **Minimal, extensible** |
| **Memory System** | Separate user repo | AGENTS.md tiers | AGENTS.md + SYSTEM.md |
| **Session Management** | Single session | Tree forking | **Tree-structured sessions** |
| **Compaction** | Manual | Tiered auto | **Auto, customizable via extensions** |
| **Providers** | Manual config | 150+ BYOK | **15+ providers, hundreds of models** |
| **Sub-agents** | Built-in | Built-in | **Not built-in (extension available)** |
| **Plan mode** | Custom plugin | Built-in | **Not built-in (extension available)** |
| **MCP** | Via plugins | Native | **Not built-in (skills instead)** |
| **Extensibility** | Plugins | Skills + Hooks | **Extensions, Skills, Packages** |
| **Remote access** | Web UI + tunnel | Headless/RPC | **RPC + SDK** |
| **Self-improvement** | mulahazah hooks | Taste system | **Manual (extensions)** |

### Decision Rationale

Pi's open-source status and minimal philosophy align with our needs:
- **No vendor lock-in** — we control the codebase
- **Extensible primitives** — we can build exactly what we need
- **Tree sessions** — better than opencode's single session
- **AGENTS.md** — similar to Command Code's memory system
- **Self-modifying** — Pi can build extensions for itself

The trade-off: Pi requires more manual setup than Command Code for features like sub-agents and plan mode, but these can be added via extensions.

---

## 2. Pi Architecture Overview

### Core Philosophy: Primitives, Not Features

Pi is aggressively minimal. Features that other tools bake in can be built with extensions, skills, or installed from third-party Pi packages. This keeps the core minimal while letting you shape Pi to fit how you work.

### Core Components

#### 1. System Prompt (Minimal)
Pi's system prompt is intentionally minimal. You control what goes into the context window via:
- **AGENTS.md** — Project instructions loaded at startup from `~/.pi/agent/`, parent directories, and current directory
- **SYSTEM.md** — Replace or append to the default system prompt per-project
- **Skills** — Capability packages with instructions and tools, loaded on-demand
- **Dynamic context** — Extensions can inject messages before each turn

#### 2. Tools (Built-in)
Pi ships with built-in tools:
- `read` — Read files
- `write` — Write files
- `edit` — Edit files
- `bash` — Execute shell commands
- `grep` — Search file contents
- `find` — Find files

#### 3. Session Management (Tree-structured)
Sessions are stored as trees. Use `/tree` to navigate to any previous point and continue from there. All branches live in a single file.

#### 4. Compaction (Auto-summarize)
Auto-summarizes older messages when approaching the context limit. Fully customizable via extensions:
- Topic-based compaction
- Code-aware summaries
- Different summarization models

#### 5. Providers (15+)
Anthropic, OpenAI, Google, Azure, Bedrock, Mistral, Groq, Cerebras, xAI, Hugging Face, Kimi For Coding, MiniMax, NVIDIA, OpenRouter, Ollama, and more.

### Key Differences from opencode

| Aspect | opencode | Pi |
|--------|----------|-----|
| **Architecture** | Feature-rich monolith | Minimal core + extensions |
| **Memory loading** | Load once at session start | AGENTS.md + dynamic context |
| **Context management** | None | Auto-compaction + extensions |
| **Tool execution** | Direct | Direct (built-in tools) |
| **Agent dispatch** | Sub-agents | Extension available |
| **Extensibility** | Plugins | Extensions, Skills, Packages |
| **Session structure** | Single session | Tree-structured sessions |

---

## 3. Memory System Mapping

### Pi's Memory Architecture

Pi uses **AGENTS.md** files for project instructions and **SYSTEM.md** for system prompts:

#### AGENTS.md Loading Order
1. `~/.pi/agent/AGENTS.md` — Global user instructions
2. Parent directory `AGENTS.md` files — Up the directory tree
3. Current directory `AGENTS.md` — Project-specific instructions

#### SYSTEM.md (Optional)
- Replace or append to the default system prompt
- Per-project customization
- Loaded before AGENTS.md

#### Dynamic Context via Extensions
Extensions can inject messages before each turn, implement RAG, or build long-term memory.

### Migration Plan: User Memory

**Strategy**: Use Pi's `~/.pi/agent/AGENTS.md` as the entry point, with `@path` imports to our existing `user/*.md` files.

**Pi's `~/.pi/agent/AGENTS.md` will contain:**

```markdown
# Glitch Memory — User Tier

@user/main-memory.md
@user/decisions.md
@user/patterns.md
@user/reminders.md
@user/current-session.md
@user/daily-diary/
```

**Mapping Table**:

| Our File | Pi Equivalent | Import Method |
|---|---|---|
| `user/main-memory.md` | `~/.pi/agent/AGENTS.md` → `@path` | `@user/main-memory.md` |
| `user/decisions.md` | `~/.pi/agent/AGENTS.md` → `@path` | `@user/decisions.md` |
| `user/patterns.md` | `~/.pi/agent/AGENTS.md` → `@path` | `@user/patterns.md` |
| `user/reminders.md` | `~/.pi/agent/AGENTS.md` → `@path` | `@user/reminders.md` |
| `user/current-session.md` | `~/.pi/agent/AGENTS.md` → `@path` | `@user/current-session.md` |
| `user/daily-diary/*.md` | `~/.pi/agent/AGENTS.md` → `@path` | `@user/daily-diary/` |

### What Changes for the Memory Agent

Our memory agent protocol (mulahazah triggers → flag files → memory agent reads/writes) continues to operate on the same `user/*.md` files. Pi's `@path` imports read those files live. The memory agent writes, Pi reads the update on the next request.

What DOES need adaptation: the trigger/flag mechanism itself (see Section 4).

### Compaction Survival Details

Pi's compaction behavior:
- **AGENTS.md content** — Preserved across compaction (system context)
- **SYSTEM.md content** — Preserved across compaction
- **Skills** — Loaded on-demand, not subject to compaction
- **Dynamic context** — Re-injected each turn by extensions

This is similar to Command Code's behavior — system context survives compaction.

### Live Re-Read Behavior

Every time Pi processes a request:
1. It reads `~/.pi/agent/AGENTS.md` (user tier)
2. It reads parent directory `AGENTS.md` files
3. It reads current directory `AGENTS.md` (project tier)
4. For each `@path` reference, it reads the referenced file
5. All of this content is injected into the system prompt

This means if you edit `user/decisions.md` at 2:00 PM, the next request at 2:01 PM will see the updated content. No restart, no reload, no cache invalidation needed.

---

## 4. What Needs Building (Gaps)

### 4.1 Living-Diary Loop

**Current system**: mulahazah detects a trigger condition → writes a flag file → memory agent picks up the flag → writes/updates `daily-diary/` entries → flag is cleared.

**Pi replacement**: Extensions + Skills.

- **Extensions** define the diary behavior (when to write, what to capture). An extension can hook into tool calls and detect trigger conditions.
- **Skills** define the diary write protocol (format, location, heartbeat).
- **No built-in hook system** — we need to build it as an extension.

**Implementation approach:**

1. Create a `diary-loop` extension that monitors tool calls
2. Implement trigger detection logic (heartbeat, token burst)
3. Write flag files to `data/MEMORY_TRIGGER_FLAG.*`
4. Create a `diary-writer` skill that picks up flags and writes diary entries
5. Pi's `@path` imports pick up the new diary entry on the next request

**Effort:** ~2-3 days. Pi's extension system is powerful but requires TypeScript development.

### 4.2 Remote Browser Access

**Current system**: opencode web server mode → Cloudflare tunnel (`*.cothekdesigns.com` wildcard + Cloudflare Access) → browser from any device.

**Pi situation**: Pi has **RPC mode** (JSON protocol over stdin/stdout) and **SDK mode** (TypeScript embedding). No built-in web UI.

**Option A: Use Pi's RPC mode**
- Build a thin web layer over Pi's RPC mode
- RPC mode provides JSON protocol for controlling Pi programmatically
- Wrap RPC in a minimal web UI (existing Next.js app or standalone)
- Deploy behind existing Cloudflare tunnel + Access

**Option B: Use Pi's SDK mode**
- Embed Pi in a TypeScript/Node.js application
- Full programmatic control
- Build custom web UI around SDK
- Deploy behind existing Cloudflare tunnel + Access

**Existing infrastructure that transfers:**

| Asset | Status | Notes |
|---|---|---|
| `*.cothekdesigns.com` wildcard DNS | Ready | Cloudflare DNS config, no changes needed |
| Cloudflare Access policies | Ready | Authentication layer, applies to any subdomain |
| Cloudflare tunnel daemon | Ready | `cloudflared` running, routes to local ports |
| Next.js web app | Adaptable | May need route changes for Pi's RPC/SDK |

**Effort:** ~2-3 days. The tunnel infrastructure already exists; the web layer needs to be built.

### 4.3 Mulahazah Self-Improvement Triggers

**Current system**: Hook observation on every tool call → pattern detection → skill forge / post-mortem triggers.

**Pi replacement**: Custom extension. Pi has no built-in hook system like Command Code, but extensions can:
- Observe tool calls
- Detect patterns
- Trigger actions

**Specific mappings:**

| mulahazah Trigger | Pi Approach | Notes |
|---|---|---|
| Tool repetition (3+ same tool) | Extension monitors tool calls | Track tool call patterns |
| Error cascade (3+ consecutive errors) | Extension monitors tool results | Count consecutive errors |
| Command repetition (same bash 2+) | Extension tracks bash commands | Track command strings |
| Readonly repetition (6+ read/glob/grep) | Extension tracks read-only tools | Track read-only sequences |
| Permission loop (2+ denied) | Extension tracks denials | Track denied calls |

**Effort:** ~2-3 days. The detection logic is reusable; the extension framework is TypeScript.

### 4.4 Watchdog / Stuck-Detector Equivalents

**Current system**: `watchdog-external.mjs` monitors bash sessions for hung processes. `stuck-detector.js` detects agent stuck patterns (tool repetition, error cascades, command loops).

**Pi replacement**: Standalone processes (like today) or custom extensions.

**Watchdog mapping:**

| Component | Current Implementation | Pi Approach |
|---|---|---|
| `watchdog-external.mjs` | Separate process, polls SQLite DB | Standalone process (same) |
| Hung process detection | OS enumeration of descendants | Same — OS-level, harness-independent |
| Process tree kill | `taskkill /F /T /PID` | Same — Windows process management |
| Session abort | `abort-agent.mjs` | Pi's session management (if available) |
| `stuck-detector.js` | In-process, monitors tool patterns | Standalone process or extension |
| Stuck signal files | `data/.stuck-signal.<session>.json` | Same file format, harness-independent |

**Key insight:** The watchdog and stuck-detector are largely harness-independent. They operate on OS-level processes and file-system signals. The main adaptation is how they interface with Pi's session lifecycle.

**Effort:** ~0.5-1 day. Most logic is independent of the harness.

### 4.5 Sub-agents (Not Built-in)

**Current system**: opencode has built-in sub-agent dispatch (@coder, @reviewer, etc.)

**Pi replacement**: Not built-in, but available as an extension.

**Options:**
1. **Use the sub-agent extension** — Available in Pi's examples
2. **Build custom sub-agent system** — Pi can spawn instances via tmux
3. **Use Pi's SDK** — Embed Pi in a custom orchestration layer

**Recommendation:** Start with the sub-agent extension, customize as needed.

**Effort:** ~1-2 days to set up and configure.

**Detailed implementation plan:** See `data/research/pi-missing-features-plan.md` Section 2 for complete architecture, components, and timeline.

### 4.6 Plan Mode (Not Built-in)

**Current system**: opencode has custom plan-reflex.js for complexity detection and planning.

**Pi replacement**: Not built-in, but available as an extension.

**Options:**
1. **Use the plan-mode extension** — Available in Pi's examples
2. **Write plans to files** — Manual approach, no extension needed
3. **Build custom plan system** — Extensions can implement any planning logic

**Recommendation:** Use the plan-mode extension or manual file-based planning.

**Effort:** ~0.5-1 day to set up.

**Detailed implementation plan:** See `data/research/pi-missing-features-plan.md` Section 3 for complete architecture, components, and timeline.

### 4.7 Taste Learning (Not Built-in)

**Current system**: Command Code has built-in Taste learning that learns from every accept/reject/edit.

**Pi replacement**: Not built-in, but can be implemented as an extension.

**Architecture:**
1. **Interaction tracker** — monitors tool calls and user responses
2. **Pattern analyzer** — extracts coding preferences and style
3. **Taste storage** — persists taste profile to disk
4. **Context injection** — injects learned patterns into context

**Implementation approach:**
1. Build interaction tracker that monitors tool calls
2. Implement pattern analyzer that extracts preferences
3. Store taste profiles in `~/.pi/taste/` directory
4. Inject relevant taste into context before each turn

**Effort:** ~3-4 weeks part-time (see detailed plan).

**Detailed implementation plan:** See `data/research/pi-missing-features-plan.md` Section 1 for complete architecture, components, and timeline.

**Implementation order:** Plan Mode → Sub-agents → Taste Learning (aligned with migration phases).

---

## 5. Skills Migration

### Pi Skills Format

Pi skills are capability packages with instructions and tools, loaded on-demand. They use progressive disclosure without busting the prompt cache.

**Skill structure:**
```
skills/
├── skill-name/
│   ├── SKILL.md          # Skill definition with frontmatter
│   ├── tools/            # Optional: helper scripts
│   └── references/       # Optional: reference documentation
```

**Skill frontmatter:**
```yaml
---
name: skill-name
description: What this skill does
when_to_use: Trigger phrases
allowed-tools:
  - bash
  - read
  - write
---
```

### Compatibility with Glitch Skills

| Glitch Component | Pi Equivalent | Replaceable? |
|---|---|---|
| `.agents/skills/*/SKILL.md` | `.pi/skills/*/SKILL.md` | ✅ 100% compatible |
| Skill frontmatter | Same frontmatter format | ✅ Identical |
| `skill(name)` tool invocation | `/skill-name` command | ✅ Same pattern |
| Trigger phrases | `when_to_use` frontmatter field | ✅ Pi supports this |
| Supporting files (scripts/, references/) | Same directory structure | ✅ Pi supports this |
| `allowed-tools` field | `allowed-tools` frontmatter | ✅ Pi supports this |
| Progressive disclosure | Same pattern | ✅ Identical |

### Migration Action

Copy `.agents/skills/` to `.pi/skills/`. All 50+ skills should work as-is.

**What Pi adds that Glitch doesn't:**
- `pi install npm:<package>` — install skills from npm
- `pi install git:<repo>` — install skills from git repos
- `pi list` — list installed packages
- `pi update` — update all packages
- Prompt templates — reusable prompts as Markdown files
- Themes — customize the TUI appearance

**Effort:** 0 days — just copy directories.

---

## 6. What We Get Free

### Capabilities Pi Provides Out-of-the-Box

| Capability | Details | Impact |
|---|---|---|
| **Tree-structured sessions** | Branch anywhere, explore multiple approaches, share history via `/share` | Better than opencode's single session |
| **Auto-compaction** | Auto-summarizes older messages when approaching context limit | Eliminates the 27k-payload problem |
| **15+ providers** | Anthropic, OpenAI, Google, Ollama, and more | No manual provider config |
| **Model switching** | `/model` or `Ctrl+L` to switch mid-session | Flexibility to use different models |
| **Session export** | `/export` to HTML, `/share` to GitHub gist | Share sessions with team |
| **Four modes** | Interactive, Print/JSON, RPC, SDK | Scriptable, embeddable |
| **Self-modifying** | Ask Pi to build extensions for itself | Customizable on the fly |
| **Minimal system prompt** | Control what goes into context | Better context engineering |

### What This Means for Our Workflow

Under opencode, we had to build or work around:

- **No context compression** → 27k payload, local models unusable → Pi's auto-compaction fixes this
- **No session branching** → one path at a time → Pi's tree sessions enable A/B testing
- **Single session** → losing work on mistakes → Pi's `/tree` lets us navigate to any point
- **Manual provider config** → API key management per provider → Pi's 15+ providers handle this
- **No self-modification** → static harness → Pi can build extensions for itself

---

## 7. Migration Checklist — Phases

### Migration Strategy: Parallel Running

We will NOT do a cold cutover. Instead:

1. **Phase 0:** Install Pi alongside opencode. Both coexist.
2. **Phase 1:** Import opencode artifacts into Pi. Verify parity.
3. **Phase 2-3:** Build missing pieces in Pi while opencode remains primary.
4. **Phase 4:** Switch primary to Pi only after all success criteria met.
5. **Keep opencode archive** for 30 days after decommission as rollback.

This approach minimizes risk. At any point, we can fall back to opencode if Pi has issues.

### Rollback Plan

If Pi fails at any phase:

1. **Phase 0-1 failure:** Continue using opencode. No migration artifacts lost.
2. **Phase 2-3 failure:** Revert to opencode. Memory files are source-of-truth in `user/*.md` — they are harness-independent.
3. **Phase 4 failure (post-decommission):** Restore opencode from archive. Memory files unchanged. Skills/agents are portable.

The key insight: our memory files (`user/*.md`) are the source of truth, and they are standard markdown. Any harness that reads markdown can use them. This is our insurance policy.

### Phase 0: Smoke Tests (No Migration Yet)

Verify Pi works with our infrastructure before committing. These tests can run immediately — Pi is open source and available today.

- [ ] Install Pi CLI (`pi`) and verify it runs
- [ ] Test Ollama connection — connect to local Ollama, run a completion
- [ ] Test Provider API — verify cloud model access works
- [ ] Test `/context` — confirm token accounting works with our project size
- [ ] Test auto-compact — verify compaction triggers and recovery
- [ ] Test tree sessions — verify branching and navigation works
- [ ] Test skills — verify skill loading and execution

**Gate:** All smoke tests pass before proceeding to Phase 1.

### Phase 1: Install & Import

**No open-source gate required** — Pi is open source today (MIT License).

- [ ] Verify Pi is installed from public repo
- [ ] Copy `.agents/skills/` to `.pi/skills/`
- [ ] Verify skills imported correctly
- [ ] Test basic workflows end-to-end
- [ ] Verify tree sessions work as expected
- [ ] Test compaction with our project size

### Phase 2: Memory 3-Tier + Diary-Loop Extension

- [ ] Create `~/.pi/agent/AGENTS.md` with `@path` imports to `user/*.md`
- [ ] Verify Pi loads all memory tiers correctly
- [ ] Verify live re-read works (edit a file, confirm next request sees changes)
- [ ] Verify compaction survival (AGENTS.md content persists through compact)
- [ ] Build diary-loop extension (mulahazah trigger → Pi extension → diary write)
- [ ] Test diary-loop end-to-end

### Phase 3: Web / Remote Layer

- [ ] Set up Pi's RPC mode for programmatic access
- [ ] Build thin web layer over Pi's RPC mode
- [ ] Deploy behind existing Cloudflare tunnel + Access policy
- [ ] Test remote access from phone/secondary device
- [ ] Verify authentication works via Cloudflare Access

### Phase 4: Mulahazah / Watchdog Adaptation

- [ ] Port mulahazah tool-call observation to Pi extension
- [ ] Port pattern detection logic to Pi extension handlers
- [ ] Port forge/post-mortem trigger invocation
- [ ] Port watchdog to standalone process (harness-independent)
- [ ] Port stuck-detector to standalone process or extension
- [ ] Test all trigger/monitoring systems end-to-end

### Phase 5: Decommission opencode

- [ ] Export any remaining opencode config not covered by manual migration
- [ ] Archive opencode installation (do not delete — keep as rollback)
- [ ] Update documentation to reflect Pi as primary harness
- [ ] Close opencode-related issues and reminders
- [ ] Update AGENTS.md to reference Pi instead of opencode
- [ ] Remove opencode from PATH (keep archive available)

---

## 8. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Extension complexity** — Pi's extension system requires TypeScript development, which may be more complex than expected | Medium | Medium | Start with simple extensions, iterate. Use Pi's example extensions as templates. |
| R2 | **Sub-agent limitation** — Pi doesn't have built-in sub-agents; the extension may not match opencode's capability | Medium | High | Use Pi's sub-agent extension, customize as needed. Fallback: use tmux to spawn Pi instances. |
| R3 | **Plan mode limitation** — Pi doesn't have built-in plan mode; the extension may be basic | Low | Medium | Use file-based planning as fallback. Extensions can implement any planning logic. |
| R4 | **RPC mode limitations** — Pi's RPC mode may not provide full control for web UI | Low | Medium | Use Pi's SDK mode for full programmatic control. Embed Pi in TypeScript application. |
| R5 | **Memory system differences** — Pi's AGENTS.md may not map perfectly to our memory structure | Low | Low | Use `@path` imports to point to existing files. Memory files are standard markdown. |
| R6 | **No built-in taste system** — Pi doesn't have Command Code's Taste learning | Low | Low | Manual pattern capture via extensions. Our patterns.md serves similar purpose. |
| R7 | **Community size** — Pi's community is smaller than Command Code or Claude Code | Low | Low | Pi is open source; we can contribute and customize. Quality is high (Mario Zechner). |
| R8 | **Feature parity gaps** — Some features we want (sub-agents, plan mode) require extensions | Medium | Medium | Build or install extensions. Pi's philosophy is "primitives, not features." |

---

## 9. Quality Assessment & Test Plan

### Online Quality Reports (September 2026)

#### Pi's Reputation

Based on research, Pi has a strong reputation in the developer community:

**Positive:**
- **Open source (MIT)** — transparent, auditable, no vendor lock-in
- **Minimal philosophy** — clean architecture, no bloat
- **Extensible** — powerful extension system, self-modifying
- **Tree sessions** — unique feature for session management
- **15+ providers** — broad model support
- **Active development** — regular releases (0.59.0, 0.80.2, 0.84.2)
- **High-quality codebase** — Mario Zechner (creator of libGDX)

**Concerns:**
- **Smaller community** — fewer packages and extensions than larger tools
- **Extension development** — requires TypeScript knowledge
- **No built-in sub-agents** — must be added via extension
- **No built-in plan mode** — must be added via extension

### Test Plan Before Migration

#### Phase 0: Quality Validation (Before Any Migration)

**Objective**: Verify Pi quality meets minimum threshold before committing to migration.

**Test 1: Simple Task Quality**
- Task: "Create a REST API endpoint for user authentication with JWT"
- Metrics: Code quality, error handling, security practices
- Pass criteria: Production-ready code without manual fixes
- Time limit: 30 minutes

**Test 2: Complex Task Quality**
- Task: "Refactor the payment module to support multiple providers"
- Metrics: Architecture decisions, code organization, test coverage
- Pass criteria: Clean abstraction, proper error handling, tests included
- Time limit: 2 hours

**Test 3: Context Retention**
- Task: Multi-step task with context dependencies
- Metrics: Does Pi remember earlier decisions? Context drift?
- Pass criteria: No contradictory suggestions, maintains project context
- Time limit: 1 hour

**Test 4: Hallucination Check**
- Task: Ask Pi to implement a feature using a specific library
- Metrics: Does it invent APIs? Does it fabricate documentation?
- Pass criteria: All API references are real and verifiable
- Time limit: 30 minutes

**Test 5: Code Review Quality**
- Task: Submit existing code for review
- Metrics: Depth of feedback, accuracy of suggestions
- Pass criteria: Identifies real issues, not just style nits
- Time limit: 15 minutes

**Test 6: Tree Session Test**
- Task: Create a session, branch at a decision point, explore two approaches
- Metrics: Does branching work correctly? Can you navigate back?
- Pass criteria: Tree structure works as expected, no data loss
- Time limit: 15 minutes

**Test 7: Extension Test**
- Task: Install a third-party extension (e.g., sub-agent extension)
- Metrics: Does it install correctly? Does it work as expected?
- Pass criteria: Extension loads and functions without errors
- Time limit: 15 minutes

#### Test Execution Protocol

1. **Run identical tasks on Claude Code and Pi**
2. **Blind comparison** — evaluate output without knowing which tool produced it
3. **Score on 5 dimensions**: Correctness, Readability, Security, Performance, Completeness
4. **Document specific failures** — not just "worse" but "failed to handle X case"

#### Pass/Fail Criteria

| Criterion | Minimum Threshold | Ideal |
|-----------|-------------------|-------|
| Simple task quality | 7/10 | 9/10 |
| Complex task quality | 6/10 | 8/10 |
| Context retention | No contradictions | Full context awareness |
| Hallucination rate | <10% of API references | 0% |
| Code review depth | Catches major issues | Catches subtle issues |
| Tree sessions | Basic branching works | Full tree navigation |
| Extensions | Install and load | Rich ecosystem |

#### If Tests Fail

**Option A: Wait for Pi improvements**
- Monitor Pi updates for quality improvements
- Re-test monthly until threshold met

**Option B: Hybrid approach**
- Use Claude Code for high-stakes work
- Use Pi only for low-risk exploration
- Accept reduced quality for open-source benefits

**Option C: Abort migration**
- Stay with opencode + Claude Code
- Revisit Pi in 6 months

---

## 10. Timeline + Success Criteria

### Timeline

| Phase | Depends On | Estimated Duration | Deliverables | Notes |
|---|---|---|---|---|
| Phase 0: Smoke tests | Nothing | 0.5-1 day | Pi installed, Ollama working, basic tests passed | Can start immediately |
| Phase 1: Install & import | Nothing | 0.5-1 day | Skills imported, basic workflows validated | No gate required |
| Phase 2: Memory + diary | Phase 1 | 1-2 days | 3-tier AGENTS.md working, diary-loop extension functional | Core memory loop must work |
| Phase 3: Web / remote | Phase 1 | 1-2 days | Remote access working via RPC + web layer | Depends on RPC mode capabilities |
| Phase 4: Mulahazah / watchdog | Phase 2 | 1-2 days | All triggers and monitoring adapted | Can overlap with Phase 3 |
| Phase 5: Decommission | All phases | 0.5 day | opencode archived, docs updated | Final cleanup |

**Total estimated:** 4-9 days of active work. **No open-source gate required** — Pi is open source today.

**Critical path:** Phase 0 (smoke tests) → Phase 1 (install) → Phase 2 (memory) → Phase 4 (triggers).

**Parallel tracks:** Phase 3 (web/remote) can run alongside Phase 2 and Phase 4 once Phase 1 is complete.

### Success Criteria

**Phase 0 — Smoke Tests:**
- [ ] Pi CLI (`pi`) installed and running
- [ ] Ollama connection verified — local model responds
- [ ] Provider API test — cloud model responds
- [ ] Tree sessions work as expected
- [ ] Auto-compaction triggers and recovers
- [ ] Skills load and execute correctly

**Phase 1 — Install & Import:**
- [ ] Skills copied to `.pi/skills/`
- [ ] Skills loadable and functional
- [ ] Basic end-to-end workflow validated
- [ ] Tree sessions work as expected

**Phase 2 — Memory 3-Tier:**
- [ ] `~/.pi/agent/AGENTS.md` created with `@path` imports
- [ ] Pi loads all memory tiers on every request
- [ ] Live re-read confirmed (edit file → next request sees change)
- [ ] Compaction survival confirmed (AGENTS.md persists through compact)
- [ ] Diary-loop extension fires on trigger conditions
- [ ] Diary entries written to `user/daily-diary/` correctly

**Phase 3 — Web / Remote:**
- [ ] Pi's RPC mode working
- [ ] Web layer built over RPC mode
- [ ] Remote access working from phone/secondary device
- [ ] Authentication works via Cloudflare Access

**Phase 4 — Mulahazah / Watchdog:**
- [ ] Tool-call observation via Pi extension
- [ ] Pattern detection (repetition, errors, loops) working
- [ ] Forge/post-mortem triggers functional
- [ ] Watchdog detects hung processes
- [ ] Stuck-detector identifies stuck patterns
- [ ] All monitoring systems end-to-end tested

**Phase 5 — Decommission:**
- [ ] opencode archived (not deleted)
- [ ] Documentation updated to reflect Pi as primary
- [ ] opencode-related issues/reminders closed
- [ ] AGENTS.md references Pi instead of opencode
- [ ] opencode removed from PATH (archive available)

**Overall Success:**
- [ ] Pi installed and running with [model access]
- [ ] All Glitch memory preserved and accessible — zero data loss
- [ ] Git discipline unchanged — commit/push workflow works identically
- [ ] Local models actually work (the original problem solved)
- [ ] Remote access functional (phone/secondary device)
- [ ] Self-improvement triggers adapted (mulahazah → Pi extensions)
- [ ] Rollback available (opencode archive, migration artifacts portable)

---

*This document is based on the Command Code migration plan structure, adapted for Pi's architecture and philosophy.*

*Generated from Troy's migration specifications. Update as implementation progresses.*

*Next action: Start Phase 0 smoke tests immediately. Pi is open source — no gate required.*
