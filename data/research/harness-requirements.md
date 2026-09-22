---
title: Glitch Agent Harness — Requirements Document
date: 2026-09-18
status: Draft v1
purpose: >
  Define evaluation criteria for AI agent harnesses (Cline, Aider, OpenCode, Zed,
  and any others discovered) against Troy's actual operational needs. Used to
  score and compare harnesses for migration or multi-harness workflows.
---

# Glitch Agent Harness — Requirements Document

## Background / Why These Requirements

Troy's current agent harness, OpenCode, has a fundamental architectural problem: its system prompt payload totals ~27,000 tokens. Small local models running via Ollama on consumer hardware (RTX 3070, 8 GB VRAM) typically have 4 k–16 k context windows. The prompt alone — before any user message, tool results, or conversation history — already exceeds what fits. OpenCode has no built-in context compression, no auto-compact, no conversation summarization, and no way to dynamically select which memory files to load based on relevance. This makes small models literally unusable under OpenCode's architecture.

The migration guide at `data/research/opencode-to-cline-migration.md` documents the initial analysis and planned move to Cline. This requirements document generalizes that analysis into a reusable scoring framework so every harness — including Cline — is evaluated against the same criteria, and new candidates can be slotted in without rewriting the evaluation.

---

## P0 — Non-Negotiables

Each P0 requirement is pass/fail. A single P0 failure disqualifies a harness outright.

### R1 — Efficient Small-Context Local Model Support

Must work well on 4 k–16 k context local models (RTX 3070, 8 GB VRAM).

**What this means in practice:**

- The harness must not inject a fixed prompt payload exceeding ~3 k tokens before user content.
- Must have a context management strategy: repo map, auto-compact, conversation summarization, subagent delegation, or equivalent mechanism that keeps the effective prompt within the model's context window.
- Must demonstrate actual successful inference with a local model (e.g. Llama 3, Qwen 2.5, Gemma 2) — not just "configurable" but functionally tested.
- **Root cause of leaving OpenCode:** its ~27 k-token prompt payload makes small models unusable. This is THE driving requirement for the entire evaluation.

### R2 — One-Line Install

Single-command installation. Preferred: compiled binary or single package manager command.

**Acceptable examples:**

- `irm <url> | iex` (PowerShell one-liner)
- `npm i -g <package>`
- Compiled binary download with no post-install build steps

**Rejected:** multi-step setup, manual dependency installation, Docker-only installs, anything requiring >2 commands to reach a working state.

### R3 — Browser-Only Remote Access

Must be reachable from any computer via a browser + URL only. No software install on the client machine.

**Current pattern (must be compatible with):**

- OpenCode web server running on a GPU desktop
- Exposed via Cloudflare tunnel with wildcard `*.cothekdesigns.com`
- Cloudflare Access for authentication

**Acceptable approaches:**

- Built-in web server that serves a chat UI on a configurable port
- Easy to add a thin web layer via SDK or open architecture (e.g. embed in a custom web app) behind the existing tunnel + Cloudflare Access

**Rejected:** desktop-only GUIs with no web interface, IDE-only access, mobile apps that require native install.

### R4 — Multi-Machine Support

Multiple computers (e.g. GPU desktop + laptop) each running the harness, each reachable via its own URL.

**Requirements:**

- Subdomain-per-machine routing (e.g. `gpu.cothekdesigns.com`, `laptop.cothekdesigns.com`)
- Sessions should be machine-bound — the agent operates on the local filesystem of the machine it runs on
- Ability to identify which machine you're talking to (machine name in UI or status)

### R5 — Persistent Memory Integration

The Glitch memory system must be readable/writable by the agent.

**Memory structure (must not require rewriting):**

- `user/*.md` markdown files: `main-memory.md`, `decisions.md`, `patterns.md`, `reminders.md`, `current-session.md`, `daily-diary/`
- Files are plain markdown with YAML frontmatter

**Integration requirements:**

- Read/write via extensibility mechanism: MCP server, plugin system, custom tool, or file-system access
- Sessions must load relevant memory at start
- Agent must be able to record decisions, patterns, and session notes
- Must NOT require rewriting the memory files into a different format

### R6 — Open Source

OSI-approved license permitting fork and modification.

**Acceptable licenses:** Apache 2.0, MIT, GPL (any version), BSD, MPL 2.0

**Rejected:** proprietary source-available, "free for personal use" with commercial restrictions, any license that prohibits forking.

### R7 — Wide Model Range

Must support models across the full spectrum, from top-tier cloud to local inference.

**Minimum provider coverage:**

- **Local:** Ollama and/or LM Studio
- **Cloud:** At least two of: Anthropic, OpenAI, Google, or OpenRouter
- **BYOK:** Ability to bring your own API key for any OpenAI-compatible endpoint

---

## P1 — Strong Preferences

P1 requirements are scored 0–5. They strongly influence the verdict but do not disqualify.

### R8 — Model Switching Without Web App

Quick model/provider switching via dropdown, slash command, or config profiles.

**Must NOT require:** building a custom Model Switcher web application (the current OpenCode pain point).

**Ideal:** one-line config change, keyboard shortcut, or inline command.

### R9 — Multi-Model Orchestration

Config profiles or equivalent to hot-swap between a local-model profile and a cloud-model profile.

**Ideal:** scripted multi-phase pipelines where a cheap/fast model does initial triage and hands off to an expensive/capable model for complex work. Example: local model reads code → summarizes → cloud model writes the fix.

### R10 — OpenCode Go Subscription Reuse

The Go API key ($10/mo) is OpenAI-compatible at `https://opencode.ai/zen/go/v1`. The harness should accept it via an OpenAI-compatible provider with custom base URL + headers.

**Known complication:** x-opencode-session session-header convention. Some harnesses may not handle custom headers — smoke test needed.

### R11 — Active Maintenance + Community

Active repository with recent releases (within 3 months), healthy community (issues answered, PRs merged).

**Bonus factors (not required, add confidence):**

- SDK for building custom agents or web layers
- Plugin / MCP server support
- Chat connectors (Telegram, Slack, WhatsApp)
- CLI + TUI (terminal UI) interface
- Headless / CI mode for automation
- Subagent / multi-agent support

---

## P2 — Nice to Have

P2 requirements are scored 0–2. They differentiate good from great but are not decision drivers.

### P2-1 — Desktop App

Native desktop application (Electron, Tauri, or similar) for users who prefer a windowed experience over browser access.

### P2-2 — Cron / Scheduled Agents

Ability to schedule agent runs on a timer or trigger (e.g. nightly code review, automated testing on commit).

### P2-3 — Multi-Agent Teams

Multiple agents collaborating on a task with shared context, delegation, and result aggregation.

### P2-4 — Checkpoint / Rollback UI

Visual interface for reviewing agent changes, creating checkpoints, and rolling back to previous states.

---

## Explicitly Out of Scope

These are not evaluation criteria — they are automatic disqualifiers:

- **Freemium-but-closed harnesses** — Cursor, Windsurf/Devin. Proprietary core with no open-source path.
- **Recurring high-cost subscriptions** — Anything requiring >$20/mo for core functionality beyond what a BYOK model already covers.
- **IDE-locked harnesses** — Anything that only works inside one specific IDE with no CLI path. Must be usable from terminal or headless.

---

## Candidates for Evaluation

| Candidate | Type | Notes |
|---|---|---|
| **Cline** | CLI + TUI + IDE extension | Primary migration target per `opencode-to-cline-migration.md`. Auto-compact, subagents, MCP plugin system. |
| **Aider** | CLI | Repo map with graph ranking excels at small-context local models. Used alongside Cline for quick terminal edits. |
| **OpenCode** | CLI + Web UI | Current harness. Being evaluated for completeness — may remain as fallback for cloud-model workflows. |
| **Zed** | Editor + AI assistant | Built-in AI with agent features. Evaluate for multi-machine + local model support. |
| *(TBD)* | — | Additional candidates discovered during research will be added here. |

---

## Scoring Rubric

### P0 — Non-Negotiable (Pass/Fail + Points)

Each P0 requirement is evaluated as **PASS** or **FAIL**.

- Any **FAIL** = harness is **disqualified**. No further scoring.
- Each **PASS** = **10 points**.
- Maximum P0 score: **70 points** (7 requirements × 10).

### P1 — Strong Preferences (0–5 Scale)

Each P1 requirement is scored 0 to 5:

| Score | Meaning |
|---|---|
| 0 | Not supported / not possible |
| 1 | Supported with major friction or workarounds needed |
| 2 | Supported but clunky / partially implemented |
| 3 | Works well, minor gaps |
| 4 | Works well, no significant gaps |
| 5 | Excellent, exceeds expectations |

Maximum P1 score: **20 points** (4 requirements × 5).

### P2 — Nice to Have (0–2 Scale)

| Score | Meaning |
|---|---|
| 0 | Not available |
| 1 | Available but basic / experimental |
| 2 | Available and functional |

Maximum P2 score: **6 points** (3 items — P2-3 and P2-4 counted, P2-1 and P2-2 as tiebreakers).

### Maximum Total Score: **96 points**

### Verdict Bands

| Range | Verdict | Meaning |
|---|---|---|
| **80–96** | **Strong Fit** | Adopt as primary harness. Minimal caveats. |
| **60–79** | **Conditional** | Adoptable with known limitations. Document workarounds. |
| **40–59** | **Weak** | Usable only for narrow use cases. Keep as secondary tool. |
| **<40** | **Reject** | Does not meet core needs. Do not adopt. |

---

## Evaluation Scorecard

Copy this table per-harness. Fill in after hands-on testing.

### Harness: `[NAME]`

| Req | Pass / Score | Evidence / Notes | Confidence |
|---|---|---|---|
| **R1** — Small-context local models | ☐ PASS / ☐ FAIL | | Low / Med / High |
| **R2** — One-line install | ☐ PASS / ☐ FAIL | | Low / Med / High |
| **R3** — Browser-only remote access | ☐ PASS / ☐ FAIL | | Low / Med / High |
| **R4** — Multi-machine support | ☐ PASS / ☐ FAIL | | Low / Med / High |
| **R5** — Persistent memory integration | ☐ PASS / ☐ FAIL | | Low / Med / High |
| **R6** — Open source | ☐ PASS / ☐ FAIL | | Low / Med / High |
| **R7** — Wide model range | ☐ PASS / ☐ FAIL | | Low / Med / High |
| **R8** — Model switching (no web app) | ☐ /5 | | Low / Med / High |
| **R9** — Multi-model orchestration | ☐ /5 | | Low / Med / High |
| **R10** — OpenCode Go subscription reuse | ☐ /5 | | Low / Med / High |
| **R11** — Active maintenance + community | ☐ /5 | | Low / Med / High |
| **P2-1** — Desktop app | ☐ /2 | | Low / Med / High |
| **P2-2** — Cron / scheduled agents | ☐ /2 | | Low / Med / High |
| **P2-3** — Multi-agent teams | ☐ /2 | | Low / Med / High |
| **P2-4** — Checkpoint / rollback UI | ☐ /2 | | Low / Med / High |
| **TOTAL** | **/96** | | |
| **VERDICT** | ☐ Strong / ☐ Conditional / ☐ Weak / ☐ Reject | | |

---

## Appendix: Quick-Reference Checklist

For rapid evaluation without reading the full document:

- [ ] R1: Works with 4k–16k context local models (not just configurable — tested)
- [ ] R2: Single command to install
- [ ] R3: Browser URL access, no client software needed
- [ ] R4: Multiple machines, each with own URL, machine-bound sessions
- [ ] R5: Reads/writes `user/*.md` memory files via MCP/plugin/extensibility
- [ ] R6: OSI-approved open-source license
- [ ] R7: Supports Ollama/LM Studio + at least 2 cloud providers + BYOK
- [ ] R8: Model switcher built in, no custom web app needed
- [ ] R9: Config profiles for local/cloud hot-swap, pipeline scripting
- [ ] R10: Accepts OpenAI-compatible endpoint with custom base URL
- [ ] R11: Active repo, recent releases, healthy community
- [ ] P2: Desktop app, cron, multi-agent, checkpoint/rollback (bonus)

---

*Document created 2026-09-18. Review and update as harness candidates are evaluated.*
