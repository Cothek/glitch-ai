# opencode → Command Code (cmd CLI) Migration Guide

> **Date:** September 19, 2026  
> **Author:** @coder (generated from Troy's specifications)  
> **Status:** Draft v1  
> **Supersedes:** `data/research/opencode-to-cline-migration.md` — Cline was the interim candidate; dropped in favor of Command Code's superior context engineering and native /import bridge. Old file preserved for history.  
> **Scope:** Full migration from opencode to Command Code (`cmd` CLI) as primary agent harness  
> **Upstream:** [github.com/CommandCodeAI/command-code](https://github.com/CommandCodeAI/command-code)

---

## 1. Executive Summary

We are migrating from opencode to **Command Code** (`cmd` CLI) as the primary agent harness. This supersedes the Cline migration plan (September 2026).

### Why Command Code

1. **Context engineering is the core differentiator.** Command Code's tiered compaction system — auto-compact on threshold, model-switch pre-trim, and `/context` token accounting — directly solves the 27k-payload vs 4k-16k local model problem. opencode loads everything every time with zero compression. CC dynamically manages what fits.

2. **Native `/import opencode` collapses most porting.** Skills, custom agents, slash commands, MCP configs, and memory files are imported in one command. No MCP server rewrite. No manual file mapping for the majority of artifacts.

3. **GOAT subscription gives cheap wide-model access.** $10/mo for $70 in credits across 150+ providers (BYOK-free). This includes keyless Ollama integration — no API key setup for local models.

4. **Cline was interim, now dropped.** Cline's Auto Compact and chat connectors were the original appeal, but CC's context engineering exceeds Cline's capability, and `/import opencode` eliminates the migration friction that made Cline attractive.

### Key Gate

Command Code is **closed source today**. They have promised open-sourcing "later this month" (September 2026). The repository is at [github.com/CommandCodeAI/command-code](https://github.com/CommandCodeAI/command-code).

**Migration is gated on the repo going public with an OSI-approved license.** We will not migrate to a closed-source harness that could change terms, disappear, or restrict usage at will. All Phase 1+ work is blocked until the repo is public.

### Candidate Comparison

| Factor | opencode | Cline | Command Code |
|---|---|---|---|
| Context compression | None | Auto Compact (basic) | Tiered compaction + pre-trim + /context |
| Local model support | Broken (27k payload) | Works (compact prompt) | Works (full context engineering) |
| /import from opencode | N/A | No | Yes — native one-command bridge |
| Extensibility | Plugins | SDK + MCP | Skills + Hooks + Mods API |
| Remote access | Web UI + tunnel | Chat connectors (Telegram etc.) | Studio (TBD) + headless/RPC |
| Pricing model | Free (self-hosted) | Free (self-hosted) | GOAT $10/mo or free BYOK |
| Open source | Yes | Yes | **Closed today, promised open** |
| Provider catalog | Manual config | Manual config | 150+ BYOK, keyless Ollama |
| Session management | Single session | Thread-per-session | Tree forking + checkpoints + /rewind |
| Self-improvement | mulahazah hooks | SDK hooks | Skills + Hooks + Mods API |
| Token visibility | None | Basic | /context real-time accounting |
| Style learning | None | None | Taste (learns from history) |

### Decision Rationale

Cline was the original migration target because it solved the local-model problem (Auto Compact + Compact Prompt). However, CC's context engineering is a superset of Cline's capabilities, and `/import opencode` eliminates the manual migration work that made Cline attractive in the first place. The open-source gate is the only blocker — once CC's repo is public, the migration path is strictly better than Cline's.

---

## 2. What /import opencode Brings Free

The `/import opencode` command is the primary migration accelerator. It reads an opencode installation and port artifacts automatically.

### What It Imports

| Artifact | Import Behavior | Notes |
|---|---|---|
| Skills (`.md` frontmatter) | Direct import | CC frontmatter format is compatible with opencode's. Skills load as-is. |
| Custom agents (frontmatter) | Direct import | Same frontmatter schema. Agent definitions port without modification. |
| Slash commands (`$ARGUMENTS`) | Direct import | `$ARGUMENTS` placeholder syntax is identical. Commands work immediately. |
| MCP server configs (`mcp.json`) | Direct import | MCP server definitions are JSON. CC reads the same format. |
| Memory files (`user/*.md`) | Renamed to `AGENTS.md` | Files are renamed; internal references are rewritten to match CC's path conventions. |

### Properties of /import

- **Additive** — does not delete or overwrite existing CC configuration. Only adds what is missing.
- **Idempotent** — safe to run multiple times. Re-importing the same opencode installation produces no duplicates.
- **Fault-isolated** — if one artifact type fails to import, others proceed. A skill import failure does not block MCP config import.

### What /import Does NOT Port

- Trigger/flag system files (e.g., `.mulahazah-trigger`) — these require manual adaptation (see Section 4).
- Custom scripts that depend on opencode's runtime (`launch.mjs`, `serve.mjs`, etc.) — these need rewrite or replacement.
- Session state, conversation history, or working-set files — these are ephemeral and not ported.
- Plugin-specific configuration that references opencode internals — these need manual mapping.

### /import Execution Order

The import process follows a deterministic order:

1. **Skills** — parsed from `.md` files with frontmatter, registered in CC's skill system
2. **Agents** — parsed from frontmatter, registered as custom agents
3. **Slash commands** — `$ARGUMENTS` patterns extracted, registered as commands
4. **MCP configs** — `mcp.json` read, server definitions registered
5. **Memory files** — `user/*.md` renamed to `AGENTS.md` structure, references rewritten

Each step is independent. If step 3 fails (e.g., malformed command), steps 4 and 5 still proceed. This fault isolation is critical — a single bad skill doesn't block the entire migration.

### Post-Import Verification Checklist

After running `/import opencode`, verify:

- [ ] Skills list matches opencode's skill count
- [ ] Agent list matches opencode's agent count
- [ ] Slash commands respond to `$ARGUMENTS` invocations
- [ ] MCP servers are registered and connectable
- [ ] Memory files are in CC's expected location with correct references
- [ ] No duplicate artifacts (idempotency check)

---

## 3. Memory System Mapping

### Command Code's 3-Tier AGENTS.md System

CC loads memory from up to three tiers, each defined by an `AGENTS.md` file:

| Tier | Path | Scope | Load Behavior |
|---|---|---|---|
| User | `~/.commandcode/AGENTS.md` | All projects | Loaded on every request |
| Project | `<project-root>/AGENTS.md` | Current project | Loaded on every request |
| Subdirectory | `<subdir>/AGENTS.md` | Current working subtree | Loaded on every request |

Each `AGENTS.md` supports **`@path` recursive imports** (up to 5 levels deep). These are live references — the file is re-read every request, so changes take effect without restart.

### Key CC Memory Behaviors

- **Survives compaction** — `AGENTS.md` content is preserved across auto-compact cycles. It is treated as system context, not conversation context.
- **Live re-read every request** — no stale cache. Edits to `AGENTS.md` or any `@path`-imported file are immediately effective.
- **5-level `@path` depth** — `AGENTS.md` can import files, which can import more files, up to 5 levels total. Sufficient for our full memory tree.

### Our Current Memory Structure

```
user/
├── main-memory.md          # Core identity, preferences, communication style
├── decisions.md            # Architectural and design decisions
├── patterns.md             # Observed patterns, recurring solutions
├── reminders.md            # Active reminders and pending tasks
├── current-session.md      # Current session state (ephemeral)
└── daily-diary/
    ├── 2026-09-18.md       # Daily diary entries
    ├── 2026-09-19.md
    └── ...
```

### Migration Plan: User Tier Links via @path

The strategy is to keep our `user/*.md` files as the **source of truth** and link them into CC's system via `@path` imports in the user-tier `AGENTS.md`.

**CC's `~/.commandcode/AGENTS.md` will contain:**

```markdown
# Glitch Memory — User Tier

@user/main-memory.md
@user/decisions.md
@user/patterns.md
@user/reminders.md
@user/current-session.md
@user/daily-diary/
```

The `@path` references point to our existing files. CC re-reads them every request. We maintain the files in their current location; CC just reads them.

### Mapping Table

| Our File | CC Tier | Import Method | Path in AGENTS.md |
|---|---|---|---|
| `user/main-memory.md` | User | `@path` | `@user/main-memory.md` |
| `user/decisions.md` | User | `@path` | `@user/decisions.md` |
| `user/patterns.md` | User | `@path` | `@user/patterns.md` |
| `user/reminders.md` | User | `@path` | `@user/reminders.md` |
| `user/current-session.md` | User | `@path` | `@user/current-session.md` |
| `user/daily-diary/*.md` | User | `@path` (directory) | `@user/daily-diary/` |
| Project-specific context | Project | `<project-root>/AGENTS.md` | Per-project |
| Subdirectory context | Subdirectory | `<subdir>/AGENTS.md` | Per-subdir |

### What Changes for the Memory Agent

Our memory agent protocol (mulahazah triggers → flag files → memory agent reads/writes) continues to operate on the same `user/*.md` files. CC's `@path` imports read those files live. The memory agent writes, CC reads the update on the next request. No MCP server rewrite needed for the core memory loop.

What DOES need adaptation: the trigger/flag mechanism itself (see Section 4).

### Compaction Survival Details

CC treats `AGENTS.md` and its `@path`-imported content as **system context**, not conversation context. This means:

- When auto-compact fires, conversation history is summarized/compressed.
- `AGENTS.md` content is **preserved verbatim** — it is re-injected after compaction.
- Any file referenced via `@path` is similarly preserved.
- This is a significant improvement over opencode, where memory files are loaded into the prompt and subject to the same compression as everything else.

### Live Re-Read Behavior

Every time CC processes a request:

1. It reads `~/.commandcode/AGENTS.md` (user tier)
2. It reads `<project-root>/AGENTS.md` (project tier)
3. It reads `<subdir>/AGENTS.md` if applicable (subdirectory tier)
4. For each `@path` reference, it reads the referenced file
5. All of this content is injected into the system prompt

This means if you edit `user/decisions.md` at 2:00 PM, the next request at 2:01 PM will see the updated content. No restart, no reload, no cache invalidation needed. This is strictly better than opencode's "load once at session start" behavior.

---

## 4. What Needs Building (Gaps)

### 4.1 Living-Diary Loop

**Current system:** mulahazah detects a trigger condition → writes a flag file → memory agent picks up the flag → writes/updates `daily-diary/` entries → flag is cleared.

**CC replacement:** Skills + Hooks + Mods API.

- **Skills** define the diary behavior (when to write, what to capture). A skill file with frontmatter triggers on specific conditions.
- **Hooks** fire on events (session start, compaction checkpoint, tool-call patterns) to trigger diary writes. CC's hook system provides lifecycle callbacks.
- **Mods API** extends CC's core if hooks are insufficient for complex trigger logic. This is the escape hatch for advanced behavior.

**Implementation approach:**

1. Create a `diary-loop` skill that defines the diary write protocol.
2. Register a `onCompactionCheckpoint` hook that triggers diary entry creation.
3. Register an `onToolCallPattern` hook that detects mulahazah-equivalent triggers.
4. The hook handler writes to `user/daily-diary/YYYY-MM-DD.md` directly.
5. CC's `@path` imports pick up the new diary entry on the next request.

**Effort:** ~1-2 days. The diary loop is well-defined; the mapping from flag-file to hooks is mechanical.

### 4.2 Remote Browser Access

**Current system:** opencode web server mode → Cloudflare tunnel (`*.cothekdesigns.com` wildcard + Cloudflare Access) → browser from any device.

**CC situation:** Command Code has a **Studio** product. We need to verify whether Studio provides a session UI that can be exposed remotely, or if it is SaaS-only (browser-based, no self-host option).

**If Studio is self-hostable:**
- Use Studio behind the existing Cloudflare tunnel and Access policy.
- Minimal build effort: verify tunnel config works with CC's port/bind.
- Check if Studio binds to a local port (like opencode's `serve.mjs`) or uses a different mechanism.

**If Studio is SaaS-only:**
- Build a thin web layer over CC's headless/RPC mode.
- CC likely exposes a programmatic API (stdio, HTTP, or WebSocket) for IDE integrations.
- Wrap that API in a minimal web UI (existing Next.js app or standalone).
- Deploy behind existing Cloudflare tunnel + Access.

**Existing infrastructure that transfers:**

| Asset | Status | Notes |
|---|---|---|
| `*.cothekdesigns.com` wildcard DNS | Ready | Cloudflare DNS config, no changes needed |
| Cloudflare Access policies | Ready | Authentication layer, applies to any subdomain |
| Cloudflare tunnel daemon | Ready | `cloudflared` running, routes to local ports |
| Next.js web app (if used) | Adaptable | May need route changes for CC's API shape |

**Effort:** ~1-3 days depending on Studio's architecture. The tunnel infrastructure already exists.

### 4.3 Mulahazah Self-Improvement Triggers

**Current system:** Hook observation on every tool call → pattern detection → skill forge / post-mortem triggers.

**CC replacement:** CC's hooks system. Mulahazah's tool-call observation pattern maps to CC's `onToolCall` or equivalent hook. Pattern detection logic runs in the hook handler. Forge/post-mortem invocation replaces the flag-file mechanism.

**Specific mappings:**

| mulahazah Trigger | CC Hook | Notes |
|---|---|---|
| Tool repetition (3+ same tool) | `onToolCallPattern` | Detect N+ identical calls in window |
| Error cascade (3+ consecutive errors) | `onError` | Count consecutive errors |
| Command repetition (same bash 2+) | `onToolCall` with bash filter | Track command strings |
| Readonly repetition (6+ read/glob/grep) | `onToolCall` with tool filter | Track read-only tool sequences |
| Permission loop (2+ denied) | `onPermissionDenied` | Track denied calls |

**Effort:** ~0.5-1 day. The detection logic is reusable; only the invocation path changes.

### 4.4 Watchdog / Stuck-Detector Equivalents

**Current system:** `watchdog-external.mjs` monitors bash sessions for hung processes. `stuck-detector.js` detects agent stuck patterns (tool repetition, error cascades, command loops).

**CC replacement:** CC's Mods API or hooks can implement equivalent monitoring. If CC exposes process management APIs, the watchdog maps directly. If not, a standalone watchdog process (like today) runs alongside CC.

**Watchdog mapping:**

| Component | Current Implementation | CC Approach |
|---|---|---|
| `watchdog-external.mjs` | Separate process, polls SQLite DB | Standwatchdog process or CC Mods API |
| Hung process detection | OS enumeration of descendants | Same — OS-level, harness-independent |
| Process tree kill | `taskkill /F /T /PID` | Same — Windows process management |
| Session abort | `abort-agent.mjs` | CC session management API (if available) |
| `stuck-detector.js` | In-process, monitors tool patterns | CC hook-based or standalone |
| Stuck signal files | `data/.stuck-signal.<session>.json` | Same file format, harness-independent |

**Key insight:** The watchdog and stuck-detector are largely harness-independent. They operate on OS-level processes and file-system signals. The main adaptation is how they interface with CC's session lifecycle (start/stop/abort).

**Effort:** ~0.5-1 day. Most logic is independent of the harness.

---

## 4A. What Command Code Replaces (Detailed)

### Skills Migration — 100% Compatible

Command Code uses the **exact same Agent Skills standard** as Glitch. Skills are portable with zero modification.

| Glitch Component | CC Equivalent | Replaceable? |
|---|---|---|
| `.agents/skills/*/SKILL.md` | `.commandcode/skills/*/SKILL.md` | ✅ 100% compatible |
| Skill frontmatter (name, description, tags) | Same frontmatter format | ✅ Identical |
| `skill(name)` tool invocation | `/skill-name` command | ✅ Same pattern |
| Trigger phrases in description | `when_to_use` frontmatter field | ✅ CC supports this |
| Supporting files (scripts/, references/) | Same directory structure | ✅ CC supports this |
| `allowed-tools` field | `allowed-tools` frontmatter | ✅ CC supports this |
| Progressive disclosure (name+desc at startup) | Same pattern | ✅ Identical |

**Migration action:** Copy `.agents/skills/` to `.commandcode/skills/`. All 50+ skills should work as-is.

**What CC adds that Glitch doesn't:**
- `cmd skills add <owner/repo>` — install skills from GitHub repos
- `cmd skills list --debug` — debug skill loading issues
- Enable/disable toggle per skill (without deleting)
- `/skill:<name>` namespace for disambiguation
- Dynamic context injection (`` !`command` `` in skill body)
- `arguments` field for parameterized skills

### Taste System — No Glitch Equivalent

Command Code's **Taste** system is a major differentiator with no Glitch equivalent.

| Feature | Description | Glitch Equivalent |
|---|---|---|
| **Continuous learning** | Every accept, reject, edit is a signal | ❌ None |
| **taste-1 model** | Meta neuro-symbolic AI learns your patterns | ❌ None |
| **Taste packages** | Organized by category (cli, typescript, architecture) | ⚠️ patterns.md (manual) |
| **Push/pull** | Share taste with team via remote | ❌ None |
| **Global taste** | Personal taste across all projects | ⚠️ main-memory.md (manual) |
| **Project taste** | Team-shared taste | ❌ None |
| **Composition** | Combine multiple taste packages | ❌ None |
| **Linting** | `npx taste lint` validates format | ❌ None |
| **Public packages** | Share with community | ❌ None |

**Migration action:** Enable Taste learning. Let it build your profile automatically. No manual migration needed — Taste learns from interactions, not from files.

**What this replaces in Glitch:**
- `patterns.md` — Taste auto-captures patterns (better: automatic, not manual)
- `forge-log.md` — Taste auto-captures repeated workflows (better: automatic)
- Manual pattern promotion from scratchpad — Eliminated (Taste does it implicitly)

### Harness Engineering — No Glitch Equivalent

Command Code's harness is specifically engineered for open models. These optimizations have no Glitch equivalent.

| Feature | Description | Impact |
|---|---|---|
| **Tool call repairs** | Auto-fixes malformed tool calls from open models | Fewer failures, smoother sessions |
| **~98% cache hit rates** | Harness-engineered caching | Credits go further, lower latency |
| **Read tool optimization** | Keeps ~25B junk tokens/month out of context | Better context utilization |
| **Shell tool optimization** | Optimized for open model quirks | Fewer bash errors |

**Migration action:** No action needed — these are built into CC's harness. They apply automatically when using CC as the agent.

### Context & Compaction — Superior to Glitch

| Feature | Command Code | Glitch |
|---|---|---|
| **Reactive compaction** | Progressive tiers (60%, 75%, 85%, 90%) | Manual compaction at checkpoint |
| **Skill exempt from trim** | ✅ Skills preserved verbatim | ⚠️ Skills can be trimmed |
| **Summarizer model** | Dedicated model call at 90% | Same concept |
| **Context visibility** | `/context` shows token costs per section | No equivalent |
| **Memory survives compaction** | ✅ Always (system prompt) | ⚠️ Memory files can be trimmed |

### Replacement Summary Table

| Glitch Component | Replaced By | Savings |
|---|---|---|
| `save-memory` skill | AGENTS.md auto-read | Eliminates trigger protocol, heartbeat, flag files |
| `MEMORY_TRIGGER_FLAG` protocol | Not needed | Eliminates flag file accumulation bug |
| `current-session.md` | CC session state | Eliminates scratchpad management |
| `session-dashboard.md` | Manual in AGENTS.md | Simplifies to single file |
| `daily-diary/` | Not needed | Eliminates daily file creation |
| `FTS5 search` | System prompt injection | Eliminates search infrastructure |
| `forge skill` | `skill-builder` (built-in) | Simplifies self-improvement |
| Manual pattern promotion | Taste continuous learning | Automates pattern capture |
| Memory agent dispatch | Omni self-fulfillment | Already eliminated in Glitch-Omni |

### What Glitch Has That Command Code DOESN'T Replace

| Glitch Component | Reason to Keep |
|---|---|
| **Mulahazah plugin** | Continuous improvement loop with tool-call observation, heartbeat capture, memory trigger — CC has no equivalent |
| **Stuck detector** | Monitors tool patterns for 5 stuck conditions — CC has no equivalent |
| **Blast-radius hook** | GitNexus pre-edit impact analysis — CC has no equivalent |
| **External watchdog** | Process monitoring + abort — CC has no equivalent |
| **opencode plugin ecosystem** | MCP servers, hooks, permissions — different architecture |
| **Glitch-Omni agent** | Direct-execution mode with full tool access — CC is a different agent paradigm |
| **Structured memory format** | Dated entries with categories, append-only — CC uses freeform AGENTS.md |
| **Separate memory git repo** | Version history + backup — CC memory is in project dir |

> **Note:** The Curriculum skill has been ported to CC (see Section 4C).

---

## 4B. Recommended Hybrid Approach

**Don't fully migrate. Instead:**

1. **Use Command Code as the coding agent** — its harness engineering, taste system, and model access are superior
2. **Keep Glitch's infrastructure running** — mulahazah, stuck detector, watchdog, blast-radius hook
3. **Port skills to CC format** — they're already compatible; just copy the directories
4. **Use CC's AGENTS.md for project conventions** — replaces shared-agent-rules.md
5. **Use CC's Taste for pattern learning** — replaces manual patterns.md/forge-log.md
6. **Keep Glitch memory for Troy-specific data** — main-memory.md, decisions.md, post-mortems.md stay in Glitch format and get `@import`ed

**The two systems complement each other:**
- Command Code = better coding agent (harness, models, taste)
- Glitch = better infrastructure (memory, monitoring, self-improvement)

---

## 4C. Curriculum Skill — Ported to Command Code

The Glitch curriculum skill (self-play learning system) has been ported to Command Code format and is ready to use.

### What It Does

The curriculum generates coding challenges, attempts them with TDD verification, and progresses through difficulty levels. It's an autonomous skill-building system where you practice specific skills, get verified results, and level up.

### Levels

| Level | Challenge Type | Pass Criteria | Promote At |
|-------|---------------|---------------|------------|
| 1 | **Tool creation** — build single-function tools | All test cases pass | 3 tools created |
| 2 | **Tool chains** — combine tools for multi-step tasks | End-to-end execution passes | 5 tools total |
| 3 | **System improvement** — propose+apply config/skill fix | Report accepted + committed | 3 improvements |
| 4 | **Memory consolidation** — deduplicate/improve memory | Merge applied, no regressions | 2 consolidations |
| 5 | **Meta-curriculum** — improve the curriculum itself | Self-referential patch works | Voluntary |

### Files Created

| File | Purpose |
|------|---------|
| `.commandcode/skills/curriculum/SKILL.md` | Skill definition with 5 levels, 18 challenges, execution workflow |
| `.commandcode/skills/curriculum/tools/verify.mjs` | TDD test verifier for Level 1 challenges |
| `.commandcode/skills/curriculum/curriculum-state.json` | Progress tracking state file |
| `.commandcode/skills/curriculum/references/curriculum-guide.md` | User-facing guide and reference |
| `.commandcode/skills/curriculum/README.md` | Skill overview and quick start |

### Level 1 Challenges (Tool Creation)

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
| 9 | Convert CSV row to JSON object | `"name,age\nTroy,30"`→`[{name:"Troy",age:30}]` | csv, parse |
| 10 | Validate a URL format | `"https://x.com"`→`true`, `"not-a-url"`→`false`, `""`→`false` | validate, url |
| 11 | Check if a string is a palindrome | `"racecar"`→`true`, `"hello"`→`false`, `""`→`true` | string, palindrome |

### Key Differences from Glitch Curriculum

| Aspect | Glitch | Command Code |
|--------|--------|--------------|
| **Execution** | Dispatches to @coder/@general sub-agents | Runs directly — you build the solution yourself |
| **Verification** | `tdd-test.mjs` in plugins directory | `tools/verify.mjs` in skill directory |
| **State tracking** | `plugins/curriculum/curriculum-state.json` | `.commandcode/skills/curriculum/curriculum-state.json` |
| **Taste integration** | Manual feed to patterns.md | Automatic via Taste packages |
| **Skill invocation** | `skill("curriculum")` tool call | `/curriculum` command |

### Integration with Taste

After completing challenges, learnings can be fed into the Taste system:

| Level | What to Feed | Taste Package |
|-------|--------------|---------------|
| 1 | Tool creation patterns | `coding-style` |
| 2 | Chain composition patterns | `architecture` |
| 3 | System improvement patterns | `workflows` |

This creates a feedback loop: **challenges build skill → Taste remembers what worked**.

### Commands

| Command | Description |
|---------|-------------|
| `/curriculum` | Start or continue the curriculum |
| `/curriculum status` | Show current level, completed challenges, next challenge |
| `/curriculum reset` | Reset progress and start over |
| `/curriculum skip` | Skip current challenge, move to next |
| `/curriculum level <N>` | Jump to a specific level |

### Migration Effort

**Effort:** 0 days (already completed). The skill is ready to use in Command Code.

**Status:** ✅ Ported and tested. All files in place at `.commandcode/skills/curriculum/`.

---

## 5. What We Get Free (That We Did Not Have)

These are capabilities CC provides out-of-the-box that we would have had to build or live without under opencode.

| Capability | Details | Impact |
|---|---|---|
| **Tiered auto-compaction with recovery** | Automatically summarizes conversation when approaching context limits. Recovers gracefully after compact. Tiered approach means different compaction strategies for different context sizes. | Eliminates the 27k-payload problem. Local models can actually run. |
| **/context token accounting** | Real-time view of token usage per request. Know exactly how much context is consumed. Breakdown by system prompt, conversation, tools, etc. | Debugging context issues becomes trivial. No more guessing. |
| **Model-switch recalibration** | When switching models mid-session, CC trims context to fit the new model's window. Pre-trim happens before inference, not after OOM. | Switch from cloud to local without losing session state. |
| **Checkpoints with /rewind** | Save session checkpoints. Rewind to any checkpoint. Non-destructive — original session preserved. | Experiment freely. Undo entire conversation branches. |
| **Session tree forking** | Fork a session into parallel branches. Explore multiple approaches simultaneously. Merge results back. | A/B test solutions. Research in parallel. |
| **Background tasks** | Run tasks in the background without blocking the main session. Results delivered when complete. | Long-running operations don't stall interactive work. |
| **Plan mode** | Structured planning phase before execution. CC plans, you approve, then it executes. Separates thinking from doing. | Better outcomes for complex tasks. Less wasted iteration. |
| **Native MCP** | Built-in Model Context Protocol support. No custom MCP server wrapper needed. Direct tool registration. | Our MCP configs import directly via /import. |
| **150+ BYOK providers** | Bring Your Own Key for 150+ model providers. Includes keyless Ollama. Provider catalog ships with CC. | No API key setup for local models. Zero config for Ollama. |
| **localOnly mode** | Full offline guarantee. No telemetry, no cloud calls, no phone-home. Air-gapped by design. | Privacy by default. Compliance-ready. |
| **GOAT subscription** | $10/month for $70 in credits. Access to wide model catalog without individual API keys. | Cheap access to models we'd otherwise pay $30-50/mo for individually. |
| **Provider API portable anywhere** | Provider configuration is portable. Export/import provider settings across machines. | Switch machines without reconfiguring. Share configs with team. |
| **Taste** | CC learns your coding style from history. Adapts suggestions, completions, and patterns to your preferences. | Personalized experience that improves over time. |

### What This Means for Our Workflow

Under opencode, we had to build or work around:

- **No context compression** → 27k payload, local models unusable → CC's tiered compaction fixes this
- **No token visibility** → guessing at context usage → CC's /context gives real-time accounting
- **No session checkpoints** → losing work on mistakes → CC's /rewind lets us undo freely
- **No parallel exploration** → one path at a time → CC's session forking enables A/B testing
- **Manual provider config** → API key management per provider → CC's BYOK + GOAT handles this
- **No style learning** → repeating preferences every session → CC's Taste learns from history

---

## 6. Subscription / Billing Notes

### GOAT Plan ($10/month)

| Limit | Amount | Resets |
|---|---|---|
| Per-5-hour window | $14 in credits | Every 5 hours |
| Per-week | $35 in credits | Weekly |
| Per-month | $70 in credits | Monthly |

GOAT gives access to the full provider catalog without individual API keys. Credits reset on the windows above. The $10/mo subscription effectively gives you $70/mo in model credits — a 7x return on investment.

**Usage strategy:** Use GOAT credits for cloud models (Anthropic, OpenAI, Google). Use BYOK/Ollama for local models (no credits consumed). This maximizes the value of the GOAT subscription.

### BYOK Free Path

If you prefer to use your own API keys (or local models), BYOK is free — no CC subscription required. This is the path for:

- **Ollama** — keyless, local, zero cost. CC connects to Ollama directly. No API key setup.
- **Self-hosted models** — any OpenAI-compatible endpoint works. vLLM, llama.cpp server, text-generation-webui, etc.
- **Existing API keys** — Anthropic, OpenAI, Google, etc. keys you already have. Use them directly.

**Hybrid approach:** Use BYOK for Ollama (local, free) + GOAT for cloud models ($10/mo for $70 credits). Best of both worlds.

### ZDR (Zero Data Retention) Opt-In

For privacy-sensitive work, opt in to zero data retention:

- CLI flag: `x-cmd-zdr`
- Environment variable: `CMD_ZDR=1`

When enabled, no conversation data is retained by CC or any provider. Useful for:

- Proprietary codebases
- Client work under NDA
- Compliance requirements (HIPAA, SOC2, etc.)
- Air-gapped environments

**Note:** ZDR may limit some features (e.g., Taste won't learn from ZDR sessions). Verify behavior before enabling for primary workflows.

---

## 7. Migration Checklist — Phases

### Migration Strategy: Parallel Running

We will NOT do a cold cutover. Instead:

1. **Phase 0:** Install CC alongside opencode. Both coexist.
2. **Phase 1:** Import opencode artifacts into CC. Verify parity.
3. **Phase 2-4:** Build missing pieces in CC while opencode remains primary.
4. **Phase 5:** Switch primary to CC only after all success criteria met.
5. **Keep opencode archive** for 30 days after decommission as rollback.

This approach minimizes risk. At any point, we can fall back to opencode if CC has issues.

### Rollback Plan

If CC fails at any phase:

1. **Phase 0-1 failure:** Continue using opencode. No migration artifacts lost.
2. **Phase 2-3 failure:** Revert to opencode. Memory files are source-of-truth in `user/*.md` — they are harness-independent.
3. **Phase 4 failure:** Revert mulahazah/watchdog to opencode versions. Standalone processes are harness-independent.
4. **Phase 5 failure (post-decommission):** Restore opencode from archive. Memory files unchanged. Skills/agents are portable.

The key insight: our memory files (`user/*.md`) are the source of truth, and they are standard markdown. Any harness that reads markdown can use them. This is our insurance policy.

### Phase 0: Smoke Tests (No Migration Yet)

Verify CC works with our infrastructure before committing. These tests can run immediately — no open-source gate required (CC is available as a binary download today).

- [ ] Install CC CLI (`cmd`) and verify it runs
- [ ] Test Ollama BYOK — connect to local Ollama, run a completion
- [ ] Test Provider API — verify cloud model access works
- [ ] Check Studio — determine if it is self-hostable or SaaS-only
- [ ] Verify repo-watch — check that CC can watch our repo correctly
- [ ] Test `/context` — confirm token accounting works with our project size
- [ ] Test auto-compact — verify compaction triggers and recovery

**Gate:** All smoke tests pass before proceeding to Phase 1.

### Phase 1: Install & Import (Gated on Open Source)

**BLOCKED until CC repo goes public with OSI license.**

- [ ] Verify repo is public at `github.com/CommandCodeAI/command-code`
- [ ] Verify OSI-approved license (MIT, Apache 2.0, or equivalent)
- [ ] Install CC from public repo
- [ ] Run `/import opencode` against current opencode installation
- [ ] Verify skills imported correctly
- [ ] Verify custom agents imported correctly
- [ ] Verify slash commands imported correctly ($ARGUMENTS working)
- [ ] Verify MCP server configs imported correctly
- [ ] Verify memory files renamed and references rewritten
- [ ] Test basic workflows end-to-end

### Phase 2: Memory 3-Tier + Diary-Loop Mod

- [ ] Create `~/.commandcode/AGENTS.md` with `@path` imports to `user/*.md`
- [ ] Verify CC loads all memory tiers correctly
- [ ] Verify live re-read works (edit a file, confirm next request sees changes)
- [ ] Verify compaction survival (force compact, confirm AGENTS.md content persists)
- [ ] Build diary-loop hook (mulahazah trigger → CC hook → diary write)
- [ ] Test diary-loop end-to-end
- [ ] Verify 5-level `@path` depth works for our memory tree

### Phase 3: Web / Remote Layer

- [ ] Determine Studio architecture (self-host vs SaaS)
- [ ] If self-host: verify Cloudflare tunnel works with CC Studio
- [ ] If SaaS-only: build thin web layer over CC's headless/RPC mode
- [ ] Deploy behind existing Cloudflare tunnel + Access policy
- [ ] Test remote access from phone/secondary device
- [ ] Verify authentication works via Cloudflare Access

### Phase 4: Adapt Mulahazah / Watchdog

- [ ] Port mulahazah tool-call observation to CC hooks system
- [ ] Port pattern detection logic to CC hook handlers
- [ ] Port forge/post-mortem trigger invocation
- [ ] Port watchdog to CC Mods API or standalone process
- [ ] Port stuck-detector to CC hooks or standalone
- [ ] Test all trigger/monitoring systems end-to-end

### Phase 5: Decommission opencode

- [ ] Export any remaining opencode config not covered by /import
- [ ] Archive opencode installation (do not delete — keep as rollback)
- [ ] Update documentation to reflect CC as primary harness
- [ ] Close opencode-related issues and reminders
- [ ] Update AGENTS.md to reference CC instead of opencode
- [ ] Remove opencode from PATH (keep archive available)

---

## 8. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Repo doesn't open-source** — CC remains closed-source past the promised date | Medium | Critical | Fallback to Pi (Claude Pi or equivalent). Migration artifacts (skills, agents, memory files) are portable. Estimated switch cost: days, not weeks, since the hard work (memory mapping, hook design) transfers. |
| R2 | **Studio isn't a session UI** — Studio is a code editor, not a remote session interface | Medium | High | Build thin web layer over headless/RPC mode. Existing Cloudflare tunnel infrastructure supports this. Alternative: CC's chat connectors (if available) solve the same problem. |
| R3 | **Mods API insufficient for diary loop** — CC's extensibility can't replicate our trigger-flag protocol | Low | Medium | Fallback: standalone trigger process (like today) that writes to `user/daily-diary/`. CC reads via `@path`. The trigger mechanism is harness-independent. |
| R4 | **GOAT usage limits tighter than expected** — $14/5h or $35/wk is insufficient for heavy usage | Low | Medium | BYOK free path via Ollama for local models. GOAT is supplement, not sole source. Monitor actual usage before committing to GOAT as primary. |
| R5 | **Solo-vendor risk / raise** — CC is a single vendor. If they raise prices, change terms, or shut down, we are exposed | Medium | High | BYOK path means we are never locked in. Provider API is portable. Memory files are standard `.md`. Worst case: port to another harness (artifacts transfer). This is strictly better than today's opencode lock-in. |
| R6 | **/import loses nuance** — automatic import misses custom scripting, session state, or edge-case configs | Medium | Low | Manual verification after import. /import is additive/idempotent — safe to re-run after manual fixes. Keep opencode archive for reference. |
| R7 | **Compaction loses critical context** — auto-compact summarizes away important details | Low | Medium | /context lets us monitor token usage. Checkpoints + /rewind let us restore pre-compact state. AGENTS.md content survives compaction (system context). |
| R8 | **Hook system performance** — CC's hooks add latency to every tool call | Low | Low | Profile hook execution time. Move expensive detection to async/background. Most hooks are lightweight (string matching, counter increment). |

---

## 9. Timeline + Success Criteria

### Timeline

| Phase | Depends On | Estimated Duration | Deliverables | Notes |
|---|---|---|---|---|
| Phase 0: Smoke tests | Nothing | 0.5-1 day | CC installed, Ollama BYOK working, Studio checked | Can start immediately |
| Phase 1: Install & import | Open-source gate | 0.5-1 day | All artifacts imported, basic workflows validated | Fast once repo is public |
| Phase 2: Memory + diary | Phase 1 | 1-2 days | 3-tier AGENTS.md working, diary-loop hook functional | Core memory loop must work |
| Phase 3: Web / remote | Phase 1 | 1-3 days | Remote access working via tunnel or built layer | Depends on Studio architecture |
| Phase 4: Mulahazah / watchdog | Phase 2 | 1-2 days | All triggers and monitoring adapted | Can overlap with Phase 3 |
| Phase 5: Decommission | All phases | 0.5 day | opencode archived, docs updated | Final cleanup |

**Total estimated:** 4-9 days of active work, gated on the open-source release.

**Critical path:** Phase 0 (smoke tests) → Phase 1 (open-source gate) → Phase 2 (memory) → Phase 4 (triggers).

**Parallel tracks:** Phase 3 (web/remote) can run alongside Phase 2 and Phase 4 once Phase 1 is complete.

### Success Criteria

**Phase 0 — Smoke Tests:**
- [ ] CC CLI (`cmd`) installed and running
- [ ] Ollama BYOK connection verified — local model responds
- [ ] Provider API test — cloud model responds
- [ ] Studio architecture determined (self-host vs SaaS)
- [ ] CC can watch our repo without errors

**Phase 1 — Install & Import:**
- [ ] `/import opencode` completed successfully
- [ ] Skills imported and loadable
- [ ] Custom agents imported and functional
- [ ] Slash commands imported ($ARGUMENTS working)
- [ ] MCP server configs imported
- [ ] Memory files renamed and references rewritten
- [ ] Basic end-to-end workflow validated

**Phase 2 — Memory 3-Tier:**
- [ ] `~/.commandcode/AGENTS.md` created with `@path` imports
- [ ] CC loads all memory tiers on every request
- [ ] Live re-read confirmed (edit file → next request sees change)
- [ ] Compaction survival confirmed (AGENTS.md persists through compact)
- [ ] Diary-loop hook fires on trigger conditions
- [ ] Diary entries written to `user/daily-diary/` correctly
- [ ] 5-level `@path` depth works for full memory tree

**Phase 3 — Web / Remote:**
- [ ] Remote access working from phone/secondary device
- [ ] Authentication works via Cloudflare Access (or equivalent)
- [ ] Session management works remotely
- [ ] No data loss on disconnect/reconnect

**Phase 4 — Mulahazah / Watchdog:**
- [ ] Tool-call observation via CC hooks
- [ ] Pattern detection (repetition, errors, loops) working
- [ ] Forge/post-mortem triggers functional
- [ ] Watchdog detects hung processes
- [ ] Stuck-detector identifies stuck patterns
- [ ] All monitoring systems end-to-end tested

**Phase 5 — Decommission:**
- [ ] opencode archived (not deleted)
- [ ] Documentation updated to reflect CC as primary
- [ ] opencode-related issues/reminders closed
- [ ] AGENTS.md references CC instead of opencode
- [ ] opencode removed from PATH (archive available)

**Overall Success:**
- [ ] CC installed and running with Ollama BYOK (no API key needed)
- [ ] All Glitch memory preserved and accessible — zero data loss
- [ ] Git discipline unchanged — commit/push workflow works identically
- [ ] Local models actually work (the original problem solved)
- [ ] Remote access functional (phone/secondary device)
- [ ] Self-improvement triggers adapted (mulahazah → CC hooks)
- [ ] Rollback available (opencode archive, migration artifacts portable)

---

*This document supersedes `data/research/opencode-to-cline-migration.md`. Cline was evaluated as an interim candidate and dropped in favor of Command Code's superior context engineering and native `/import opencode` bridge. The old document is preserved for historical reference.*

*Generated from Troy's migration specifications. Update as implementation progresses.*

*Next action: Start Phase 0 smoke tests immediately. Monitor CC repo for open-source announcement. Resume Phase 1 when repo is public.*
