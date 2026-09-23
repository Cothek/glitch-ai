# Pi Migration Plan 2: Clean-Slate Glitch-on-Pi Architecture

> **Date:** September 22, 2026
> **Author:** glitch-omni (direct execution)
> **Status:** Draft v1
> **Scope:** Architectural revision of the Glitch-on-Pi migration — layer mapping, build order, what not to port
> **Upstream:** [github.com/earendil-works/pi](https://github.com/earendil-works/pi)
> **Website:** [pi.dev](https://pi.dev)
> **Depends on:** [pi-migration-plan.md](./pi-migration-plan.md) (Plan 1), [pi-missing-features-plan.md](./pi-missing-features-plan.md), [pi-remote-access-plan.md](./pi-remote-access-plan.md)
> **Relationship to Plan 1:** Plan 1 remains the reference for memory mapping detail, skills compatibility tables, and the phased checklist. Plan 2 revises the *core approach and priority order*: three-layer mapping instead of feature-by-feature porting, awareness-loop extensions before taste learning, and explicit non-port list. Where they conflict on sequencing, Plan 2 wins.

---

## 1. Why a Plan 2

Plan 1 (Sep 19) was written before three things were known:

1. **Remote access is already built and verified.** pi-web-ui + auth-proxy + tunnel is live (`pi.cothekdesigns.com` → :4103 → :8787, 401 unauthenticated verified). That entire workstream is done — Plan 1 still lists it as a phase.
2. **The Pi package identity was wrong.** A prior session claimed "Pi v3 installed globally via `npm i -g pi`" — that installed *pi-number* 2.0.5 (IonicaBizau's math package), not the coding agent. Real package: `@earendil-works/pi-coding-agent`. Fixed Sep 22: uninstalled pi-number, installed `0.87.1`. Any Plan 1 checklist line saying `npm install -g pi` is wrong.
3. **The 12-week plan overweights the wrong thing.** `pi-missing-features-plan.md` sequences Plan Mode → Sub-agents → Taste Learning. Taste learning is a nice-to-have; without mulahazah/stuck-detector/blast-radius equivalents, memory goes stale and the agent loses self-awareness on day one. Plan 2 inverts this: awareness loop first, taste last (possibly never).

Plan 2 is the architecture document. Plan 1 stays as the operational detail document.

---

## 2. Core Insight — Three-Layer Mapping

Glitch is already three layers (README). Pi maps onto them almost exactly:

| Glitch layer | Contents | Pi destination | Migration effort |
|---|---|---|---|
| **Engine** | `glitch-memorycore/`: identity, prompt-rules, 62 skills, engine plugins | `SYSTEM.md` + `AGENTS.md` (rules tier) + `.pi/skills/` | **Copy.** Skills format is 100% compatible — same `SKILL.md` frontmatter, same trigger phrases, same `allowed-tools`, same `scripts/` + `references/` structure (Plan 1 §5) |
| **User data** | `user/*.md` — main-memory, current-session, decisions, patterns, reminders, post-mortems, daily-diary, session-dashboard, projects | **Untouched.** `@path` imports in `~/.pi/agent/AGENTS.md` | **Zero migration.** Memory files are harness-agnostic markdown. See §3.1 for the freshness caveat |
| **Launcher / harness glue** | opencode binary, 13 `.opencode/plugins/` hooks, 10 agent definitions, 5 launch modes, launch.mjs | Pi CLI + TypeScript **extensions** + SDK sub-agents + existing `start-pi-stack.ps1` | **This is the only real rebuild** |

Everything else — tunnel config, `auth-proxy.mjs`, GitNexus CLI, `start-detached.ps1`, image scripts, browser-use *server* — is harness-agnostic and transfers unchanged.

### What this means

- Day-one Glitch-on-Pi (identity + memory + 62 skills) is a **copy job, not a port**.
- The engineering budget is the **plugin → extension rewrite** (13 files, glue only — detection logic copies).
- Sub-agents are the one architectural bet; everything else is scheduling.

---

## 3. Phase 0 — Foundation (half a day, no code)

### 3.1 Memory wiring

Create `~/.pi/agent/AGENTS.md`:

```markdown
# Glitch Memory — User Tier

@user/main-memory.md
@user/decisions.md
@user/patterns.md
@user/reminders.md
@user/current-session.md
@user/post-mortems.md
@user/session-dashboard.md
@user/daily-diary/current/
```

(Exact set tunable — see Plan 1 §3 mapping table for per-file rationale. Session-dashboard and diary may be dropped if prompt budget gets tight; main-memory + current-session + decisions + reminders are the floor.)

**⚠️ Freshness verification required (conflict between sources):** Plan 1 §3 claims `@path` imports are live-re-read every request (edit at 2:00 PM, visible at 2:01 PM). Official pi.dev quickstart says *"Restart pi, or run `/reload`, after changing context files."* **Smoke test must resolve this:**

- Edit a memory file mid-session → next turn: does the change appear without `/reload`?
- If cached: memory writes need a `/reload` hook (extension can call it after flag fulfillment), or memory content moves to a per-turn dynamic-context injection (Pi extensions can inject messages before each turn — Plan 1 §4.1 already assumes this capability for the diary loop).

### 3.2 Identity + rules wiring

- `SYSTEM.md` (or project `AGENTS.md`) assembled from `glitch-memorycore/core/identity.md` + the rules tier of `glitch-memorycore/prompt-rules.md` + `shared-agent-rules.md`.
- Preserve the hard constraints from identity.md: truthfulness protocol (R5), no-AI-telltales voice, **vision reflex** (Glitch does not process images inline — on Pi this maps to dispatching a vision sub-agent in Phase 2, or until then a tool/skill path using `read` on image files).
- Pi loads `AGENTS.md` or `CLAUDE.md` from parent dirs + current dir; `AGENTS.override.md` replaces for that directory; `SYSTEM.md` replaces/appends the default system prompt (per Plan 1 §3). Use whichever tiering keeps the payload small — small-context local models are a standing requirement (harness-requirements R1).

### 3.3 Skills copy

```powershell
Copy-Item .agents\skills .pi\skills -Recurse   # project-local
# or: copy to ~/.pi/agent/skills/ for global availability
```

All 62 skills work as-is (Plan 1 §5 compatibility table). Verify one progressive-disclosure skill loads on demand (`skill` invocation → Pi's equivalent trigger).

### 3.4 Smoke test checklist

- [ ] `pi --version` → `0.87.1` (or newer `@earendil-works/pi-coding-agent`)
- [ ] `~/.pi/agent/AGENTS.md` imports resolve (no missing-file errors)
- [ ] Ask "who are you" → Glitch identity, not vanilla Pi
- [ ] Ask "what did we decide recently" → answers drawn from `user/decisions.md`
- [ ] Load one skill → correct SKILL.md content, progressive disclosure (description only until loaded)
- [ ] Resolve `@path` freshness question (§3.1)
- [ ] Small-context check: total injected payload fits the target local-model window (re-run whatever produced the ~27k estimate; target ≤16k, ideally ≤8k)
- [ ] `pi` runs with Ollama/local provider as well as cloud (R1 non-negotiable)

**Phase 0 done = recognizable Glitch (personality + memory + skills) running on Pi.**

---

## 4. Phase 1 — The Awareness Loop (3 extensions)

The three extensions that make Glitch *Glitch*. Without them: stale memory, no stuck detection, no pre-edit blast radius. Built as Pi TypeScript extensions; hook APIs differ from opencode but **detection logic ports nearly line-for-line**.

### 4.1 mulahazah → memory-trigger extension

| Aspect | Detail |
|---|---|
| **Today** | Hook observation on every tool call → heartbeat/pattern conditions → writes `data/MEMORY_TRIGGER_FLAG.<sessionID>*` → memory agent fulfills → flag deleted |
| **Pi** | Extension observing tool calls: 30-min heartbeat counter, token/tool-call burst, same condition thresholds |
| **Contract preserved** | Flag file path, format, and fulfillment protocol **unchanged** — only the writer moves. `save-memory` skill, self-fulfillment in omni mode, and diary protocol all keep working |
| **Effort** | ~2–3 days (Plan 1 §4.3 already specced the per-trigger table) |

### 4.2 stuck-detector → stuck-signal extension

| Aspect | Detail |
|---|---|
| **Today** | 5 rules: tool_repetition (3+ similar args), error_cascade (3+ consecutive), command_repetition, readonly_repetition (6+ identical read/glob/grep), permission_loop → writes `data/.stuck-signal.<sessionID>.json` + global mirror → breakthrough skill loads |
| **Pi** | Same 5 rules, same file format, same TTL (15 min) — portable because the contract is files on disk, not in-process state |
| **Effort** | ~1–2 days (rules copy; hook plumbing shared with 4.1) |

### 4.3 blast-radius → pre-edit impact extension

| Aspect | Detail |
|---|---|
| **Today** | `.opencode/plugins/blast-radius.js` — `tool.execute.before` on edit → `gitnexus impact {file} --summary-only` → injects risk/staleness signal |
| **Pi** | Extension `tool.execute.before` (or Pi's edit-tool hook) → same CLI call, same path relativization, same staleness surfacing |
| **Effort** | ~1 day. GitNexus side needs zero changes (CLI already harness-agnostic; `gitnexus-sync.mjs` startup hook ports to the Pi launcher) |

**Phase 1 exit criteria:** run a real multi-session day on Pi — memory flags fire and get fulfilled, stuck signals appear when intentionally jammed, blast-radius warns before an edit in an indexed repo.

---

## 5. Phase 2 — Dispatch

### 5.1 dispatch-reflex / plan-reflex → routing extension

- `before:turn` complexity analysis → route simple tasks direct, complex tasks through plan-first behavior (logic ports from `dispatch-reflex.js` + `plan-reflex.js`).
- Plan mode itself: use a third-party plan-mode extension or the Plan Mode build in `pi-missing-features-plan.md` §3 — but only the *plan artifact* part; the reflex (when to plan) is ours.

### 5.2 Sub-agents

Pi deliberately ships without sub-agents. Build one dispatcher extension; the 10 agent definitions (`.opencode/agents/*.md`: coder, reviewer, testing, ui-designer, vision, vision-alt, memory, memory-paid, pentester, glitch-omni) become **Pi packages** — prompt template + skill bundle + model config each.

Spawning options (from `pi-missing-features-plan.md` §2):

1. **Pi SDK** (`createAgentSession` from `@earendil-works/pi-coding-agent`) — cleanest, preferred
2. **Spawn `pi --mode json`** subprocesses — boring fallback, JSON event stream parse
3. tmux interactive panes — only if 1/2 fail for interactive sub-agents

**Vision reflex dependency:** identity.md's hard rule (never process images inline) needs @vision-equivalent dispatch to be enforceable — until the dispatcher exists, inline images stay blocked and vision work is deferred (acceptable interim).

### 5.3 recall → tool extension

- Wrap existing FTS5 `search-memory.mjs` as a Pi tool. Pi has no MCP — same script, new binding.
- `verify-claim` similarly: tool extension + skill instructions (R5 protocol text already written).

**Phase 2 exit criteria:** "build this feature" routes through plan → dispatch → review the way Glitch does today; vision sub-agent answers image questions; memory FTS search works from chat.

---

## 6. Phase 3 — Remaining glue (lower priority)

| Piece | Pi approach | Notes |
|---|---|---|
| compaction.js | Hook Pi's native auto-compaction | Add "diary write at compact" behavior; Pi already compacts (Plan 1: eliminates the 27k-payload failure mode) |
| save-images.js | Skill calling existing script | Image persistence is a script, not a hook |
| glitch-image-gen.mjs | Existing `image-generation` / `prompt-upsampling` skills | Already NVIDIA-endpoint based; portable |
| graphify.js | Skill wrapping `graphify` CLI | knowledge-graph questions stay file-based |
| antigravity-mcp.mjs | Skill wrapping `agy` headless CLI | MCP wrapper unnecessary — Pi executes skills via bash |
| agent-watchdog.mjs | **Do not port** | See §7 |
| Taste learning | Extension per `pi-missing-features-plan.md` §1 | **Last.** 3–4 weeks, zero day-one value. Only start after Phases 0–2 have survived real use |

---

## 7. What we explicitly do NOT port

| Item | Why not |
|---|---|
| `watchdog-external.mjs` | Polls **opencode's** SQLite for wedged bash sessions. No Pi session DB. Either drop (Pi session lifecycle may cover it) or rewrite against Pi's session store later — not a migration blocker |
| browser-use opencode UI bindings | The browser-use *server* (port 4105, settings UI, NVIDIA adapter) transfers as-is; only its registration inside opencode config changes. Rebind when/if needed |
| opencode session-DB plumbing | 3.18 GB opencode.db, image parts, query-opencode-db tools — historical artifact. Pi stores sessions under `~/.pi/agent/sessions/`. Keep the old DB read-only for archaeology |
| 5 launch modes as-is | Free/normal/local/safe/server matrix exists because opencode needed it. Pi needs: default CLI + `start-pi-stack.ps1` (already built, commit `1fdaf2e`) + tunnel config (already has pi ingress). Collapse to one launcher path |
| pi-number package | Uninstalled Sep 22. Never `npm i -g pi` — always `@earendil-works/pi-coding-agent` |

**Harness-agnostic assets that transfer unchanged:** `plugins/auth-proxy.mjs` (second instance already serving Pi on :4103), `config/cloudflared-config.yml(.template)` (pi ingress present), `scripts/start-detached.ps1`, `scripts/start-pi-stack.ps1`, `scripts/gitnexus-sync.mjs`, `scripts/cleanup-opencode-images.mjs` (still useful for the old DB), GitNexus index + `impact` CLI, `glitch-memorycore/` engine repo, `user/` profile repo, all 62 skills.

---

## 8. Phase 4 — Launcher cutover (parallel run)

1. `launch.mjs` gains a Pi mode (or replaces the opencode spawn): start watchdog (if kept) → `gitnexus-sync.mjs` detached → `start-pi-stack.ps1` → tunnel config verify → hand off to `pi`.
2. **Parallel run, not cold cutover** (Plan 1 §7 strategy retained): Pi = daily driver for chat/companion/coding; opencode stays installed and launchable as fallback until Phases 0–2 pass a multi-day real-use bar.
3. Success bar to retire opencode: memory protocol stable (flags fulfilled, diary current), stuck/blast-radius extensions firing, sub-agent dispatch used on a real feature task, no identity/memory regressions vs. today.
4. Remote access needs **zero additional work** — already in production (Plan 1 §4.2 superseded by `pi-remote-access-plan.md` completion).

---

## 9. Risks (honest)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | 13 plugin → extension rewrites are glue-only but easy to under-estimate | Medium | Phase 1 scoped to 3 extensions (~4–5 days total); logic copies, only hook APIs are new |
| 2 | Sub-agent SDK path (`createAgentSession`) is the least battle-tested option | Medium | Keep `--mode json` spawn as documented fallback (same dispatcher interface) |
| 3 | `@path` import freshness may require `/reload` (§3.1 conflict) | High for memory UX | Smoke test first; if cached, extension-based per-turn injection already specced in Plan 1 §4.1 |
| 4 | Version skew: global Pi `0.87.1` vs pi-web-ui pin `<0.87.0` (nested copy) | Low today | Fine while nested; when pi-web-ui updates its pin, re-verify stack via `-Status` + 401/200 e2e |
| 5 | Prompt payload creep defeats small-context models (R1) | Medium | Phase 0 includes payload budget check; memory import set is tunable; Pi auto-compaction helps at runtime |
| 6 | Identity drift — SYSTEM.md assembly might miss a rules tier | Medium | Build SYSTEM.md from files by reference where possible; diff smoke-test answers against opencode Glitch before cutover |
| 7 | Vision reflex unenforceable until dispatcher exists | Low (accepted) | Interim: no inline image processing (already the rule); vision tasks deferred to Phase 2 |

---

## 10. Timeline — Plan 2 vs Plan 1

| | Plan 1 / missing-features plan | **Plan 2** |
|---|---|---|
| Phase 0 foundation | "Install + memory" inside a multi-week phase | **Half a day** — copy job |
| Awareness loop (mulahazah / stuck / blast-radius) | Folded into generic "triggers" work | **Phase 1, ~4–5 days — first build priority** |
| Sub-agents + plan reflex | Weeks 2–4 of a 12-week plan | **Phase 2, ~1–2 weeks** |
| Remote access | Listed as future work | **Already complete (Sep 22)** |
| Taste learning | Weeks ~8–12, positioned as key differentiator | **Phase 3, last — optional** |
| Total to "daily-drivable Glitch on Pi" | ~12 weeks part-time | **~2–3 weeks** to Phases 0–2 exit criteria; taste/tuning afterward |

**Critical path:** Phase 0 (incl. freshness smoke test) → Phase 1 (mulahazah + stuck-detector, then blast-radius) → Phase 2 dispatcher → Phase 4 parallel run → retire opencode.

---

## 11. Checklist

### Phase 0 — Foundation
- [ ] `~/.pi/agent/AGENTS.md` with `@path` imports to `user/*.md`
- [ ] `SYSTEM.md` / project `AGENTS.md` from identity.md + prompt-rules.md + shared-agent-rules.md
- [ ] Copy `.agents/skills/` → `.pi/skills/` (62 skills)
- [ ] Smoke test: identity, memory, one skill, payload budget, local model
- [ ] Resolve `@path` freshness (live vs `/reload`) and pick injection strategy accordingly
- [ ] Confirm `pi --version` = `@earendil-works/pi-coding-agent` (never pi-number)

### Phase 1 — Awareness loop
- [ ] mulahazah extension → `MEMORY_TRIGGER_FLAG.*` (format unchanged)
- [ ] stuck-detector extension → `.stuck-signal.*` (5 rules, 15-min TTL)
- [ ] blast-radius extension → `gitnexus impact` pre-edit signal
- [ ] `gitnexus-sync.mjs` wired into Pi launcher path
- [ ] Multi-day real-use verification

### Phase 2 — Dispatch
- [ ] dispatch-reflex + plan-reflex → `before:turn` routing extension
- [ ] Sub-agent dispatcher (SDK primary, `--mode json` fallback)
- [ ] 10 agent definitions packaged as Pi packages
- [ ] Vision sub-agent restores vision reflex
- [ ] recall + verify-claim as tool extensions

### Phase 3 — Remaining (ordered)
- [ ] compaction diary hook
- [ ] save-images / image-gen / graphify / antigravity as skills
- [ ] Taste learning (only after Phase 4 success bar met)

### Phase 4 — Cutover
- [ ] `launch.mjs` Pi path: gitnexus-sync → start-pi-stack → tunnel verify → `pi`
- [ ] Parallel run (Pi daily driver, opencode fallback)
- [ ] Success bar met across multi-day real use → archive opencode launch path (keep install for rollback)

### Explicit non-goals
- [ ] ~~Port watchdog-external to Pi session DB~~ (drop or defer)
- [ ] ~~Migrate opencode.db history~~ (read-only archive)
- [ ] ~~Rebuild 5-mode launch matrix~~ (collapse to one path)

---

## 12. Repo Strategy & Succession (added Sep 23, 2026)

**Decision (Troy):** eventual end state is `glitch-pi` **replacing** `glitch-ai` — inherit everything worth keeping, strip the OpenCode organs, archive the old repo at cutover. Not two launcher repos forever.

### Succession model

```
Now:     glitch-ai = agnostic infra + skills + research + OpenCode layer
         glitch-pi = (doesn't exist yet)

During:  glitch-ai = OpenCode daily driver (untouched, keeps working)
         glitch-pi = fork of glitch-ai + Pi layer; ALL new work happens here

End:     glitch-ai = archived (read-only history, README stub → glitch-pi)
         glitch-pi = THE repo — three-layer architecture, layer 3 is Pi
```

### Mechanism: fork, don't re-copy

**Fork `glitch-ai` → `Cothek/glitch-pi`** (GitHub fork or `git push --mirror` of develop), clone as sibling directory. Full history comes free, including force-added `data/research/` corpus, hooks, gitignore, scripts. Then over time: strip `opencode/` binary, `.opencode/`, `config/opencode-*.json`, 5-mode launch matrix; add Pi extension package + launcher. Hand-copying a fresh repo risks missing force-added/gitignored-but-tracked files (already proven: `data/` is gitignored yet holds the research corpus).

What glitch-pi does **NOT** inherit: `opencode/` binary, `.opencode/` (13 plugins, 10 agents, instructions), `config/opencode-*.json`, 5-mode launch matrix. Those stay behind and die with the archive.

### Gotchas (all must be handled)

| # | Gotcha | Rule |
|---|--------|------|
| 1 | **`user/` memory single-writer** | During parallel run: ONE checkout only. Pi reads it via **absolute `@path` imports** in `~/.pi/agent/AGENTS.md`. Never clone `glitch-user-troy` twice (divergent diaries). `sync-user.ps1` writers must target the same checkout. At full cutover: move checkout once, update imports once. |
| 2 | **Hardcoded absolute paths** | `pi-web-ui-launcher.cmd` hardcodes `cd /d "E:\Glitch AI\glitch-ai"`. Tunnel inner script, `data/logs/*.pid`, auth-proxy invocations — audit all when active workspace flips to `glitch-pi`. Failure mode: tunnel 404 (lived once already). |
| 3 | **Host infra stays shared** | Tunnel, auth-proxy, cloudflared config serve BOTH hostnames right now. One repo owns host infra for the whole parallel period (glitch-ai, since it's already running). Move only when opencode is actually retired — avoids recurrence of the ingress-rules-dropped bug. |
| 4 | **Skills must consolidate FIRST** | Canonical 62 skills live in glitch-ai's `.agents/skills/`. If the fork happens before consolidation, glitch-pi inherits a copy → two drifting trees (would be 4th fork counting engine legacy + `.commandcode/`). **Move canonical tree into `glitch-engine` before forking** — both repos consume via submodule. This is step one (§12.3). |
| 5 | **Timing** | Since end state is replacement: build Phase 0–1 **directly in glitch-pi**, not a `pi/` subfolder of glitch-ai. No extract step later. glitch-ai stays frozen as working OpenCode driver. Fork can happen immediately after skills consolidation (skills can also move post-fork — path change in both — but pre-fork is cleaner). |

### 12.3 Skills consolidation — step one (execution order)

**Why first:** every week delayed is a week of drift across what becomes two repos.

**Audit (Sep 23):**

| Tree | Count | Role |
|------|-------|------|
| `.agents/skills/` | 62 | Canonical runtime (OpenCode auto-discovers) |
| `glitch-memorycore/plugins/glitch-skills/skills/` | 27 | Legacy (24 overlap canonical, **3 exclusive**: `handoff`, `resolving-merge-conflicts`, `wayfinder`) |
| `.commandcode/skills/` | fork | Separate harness export — out of scope |

Overlaps diverge (verified: `code-review` differs, canonical larger/newer). **Canonical wins** per registry note (2026-08-02).

**Target architecture:**

```
glitch-memorycore/plugins/glitch-skills/skills/   ← SOURCE OF TRUTH (62 + 3 = 65)
        │
        ├── scripts/sync-skills.mjs ──→ .agents/skills/      (OpenCode runtime, generated)
        │                          └──→ .pi/skills/          (Pi runtime, generated — future)
        └── skills-registry.md stays in engine (already home)
```

**Phases:**

- **Phase A (now):** merge canonical into engine (overwrite 24 overlaps with canonical, add 38 non-overlaps, keep 3 exclusives → 65). Write `sync-skills.mjs`. Run engine → `.agents/skills` (propagates 3 exclusives into runtime). Update registry note: canonical = engine tree; `.agents/skills` = sync target. Keep `.agents/skills` git-tracked for now.
- **Phase B (after sync verified across a restart):** gitignore + untrack `.agents/skills`; wire `sync-skills.mjs` into `launch.mjs`/`setup.ps1`. **Do not untrack mid-session** — skill loads break the moment files vanish.
- **Phase C (Pi fork):** sync target `.pi/skills` activates; fork inherits engine submodule, zero skill migration.

**Note:** ~20 AUTO-GENERATED skill headers reference `node scripts/sync-harnesses.mjs` — that script does **not exist on disk** (missing/deleted). Generation of ui-craft-derived skills (adapt, animate, clarify, …) is currently manual/orphaned. `sync-skills.mjs` covers tree sync only; ui-craft regeneration is a separate restore-if-needed item.

**Done means:** 65 skills in engine, 65 in `.agents/skills` (sync-identical), registry points at engine as source, both repos consume the same submodule path when glitch-pi forks.

---

## Appendix A — Verified facts (Sep 22, 2026)

- Real Pi package: `@earendil-works/pi-coding-agent`, installed global `0.87.1` at `data\node\pi.ps1` (scope moved from `@mariozechner/*` May 2026, upstream `earendil-works/pi`).
- `pi-web-ui@0.94.1` installed; nests its own Pi copy pinned `>=0.85.1 <0.87.0`; launcher `C:\Users\cothe\pi-web-ui-launcher.cmd` → `:8787`.
- Remote stack verified: tunnel ingress `pi.cothekdesigns.com` → `:4103` (auth-proxy) → `:8787`; 401 without creds on both Glitch and Pi hostnames; no Cloudflare Zero Trust (local Basic auth via `.server-password`).
- Skills on disk: 62 under `.agents/skills/`. Agents: 10 under `.opencode/agents/`. Plugins under `.opencode/plugins/`: 13 (agent-watchdog, antigravity-mcp, blast-radius, compaction, dispatch-reflex, glitch-image-gen, graphify, mulahazah, plan-reflex, recall, save-images, stuck-detector, verify-claim).
- Engine plugins (glitch-memorycore/plugins): curriculum, dev-loop, embed-search, glitch-skills — skill-adjacent; `embed-search` powers recall's FTS5.
- Memory root: `user/` (gitignored private repo `Cothek/glitch-user-troy`). `glitch-memorycore/users/` holds stale untracked template copies — do not write session memory there.
- Image GC (stats only, `--apply` pending Troy): 130 parts / 11.50 MB reclaimable ≥90 days; images are not the 3.18 GB DB problem.
- Prior research commits: `4236d68` (remote-access plan), `3e107e5` (Plan 1 §4.2 update), `1fdaf2e` (start-pi-stack + tunnel template), `9701bca`/`78b742c`/`38242a7` (Plan 1 + missing-features).
