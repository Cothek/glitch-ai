---
name: code-review
description: "MUST use when user says 'review this', 'code review', 'review my code',
              'PR review', 'check this PR', 'look at this diff', 'review changes',
              'what do you think of this code', 'review merge request',
              'quality gate', 'gate check',
              or when examining a pull request, diff, or set of changes
              for quality assessment.
              Also fires automatically as a quality gate for significant code changes."
---

# Code Review — Quality Gate + Systematic Change Assessment

## Activation
When this skill activates, output:
"Running code review [quality gate]..."

## Bypass Criteria (Trivial Changes)
Skip quality gate if ALL of:
- Only 1-2 files changed
- No logic changes (comments, formatting, renames, dependency bumps)
- No public API changes
- No security-sensitive code touched

## Protocol

### Phase 0: Quality Gate — Auto-Trigger Check
1. Assess change significance
2. If trivial → skip gate, report "Gate bypassed (trivial change)"
3. If significant → run full review protocol below

### Phase 0.5: Startup-Safety Gate

**Purpose**: Prevent changes to Glitch's core files from silently breaking any launch mode (normal, safe, free, server).

**Core Files (Glitch Launch) — NO BYPASS**: If ANY of these files are in the change set, this gate is mandatory. Trivial-change bypass does NOT apply.

| # | File | Launches Affected | What Breaks |
|---|------|-------------------|-------------|
| 1 | `opencode.json` | all | Invalid JSON, missing brackets, bad agents — opencode can't start |
| 2 | `launch.mjs` | normal | Node.js import error → no TUI mode |
| 3 | `launch-safe.mjs` | safe | Node.js import error → no safe mode (worst: can't recover) |
| 4 | `launch-free.mjs` | free | Node.js import error → no free mode |
| 5 | `serve.mjs` | server/web | Node.js import error → no web/server mode |
| 6 | `launch-glitch.bat` | normal | Batch parse error → no normal mode |
| 7 | `launch-glitch-safe.bat` | safe | Batch parse error → no safe mode |
| 8 | `launch-glitch-free.bat` | free | Batch parse error → no free mode |
| 9 | `serve-glitch.bat` | server/web | Batch parse error → no web mode |
| 10 | `bootstrap.ps1` | first-time setup | Fresh clone can't initialize |
| 11 | `validate-config.ps1` | all (pre-flight) | Validation gate itself broken |
| 12 | `glitch-memorycore/prompt-rules.md` | all | Delegator loses instructions — behavioral drift |
| 13 | `glitch-memorycore/glitch.md` | all | Delegator loses protocol — behavioral drift |
| 14 | `glitch-memorycore/main/*.md` | all | Memory context lost — session breaks |
| 15 | `glitch-memorycore/plugins/glitch-skills/skills/*/SKILL.md` | all | Skills break or go missing |

**When to run this phase**: ALWAYS when any file from the Core Files table is in the change set. The auto-trigger bypass (1-2 files, comments only) does NOT apply to core files — any change to a core file triggers a full gate.

#### Checklist for Each Core File

**For `opencode.json` (all modes):**
- **Step 0 — JSON syntax**: Run `validate-config.ps1` (or manual `ConvertFrom-Json`). **BLOCKER** if invalid — even a missing `}` blocks everything.
- **Step 1 — Structural completeness**: Every agent has a `model` field. Every opening `{` has a closing `}`. Count them if unsure.
- **Step 2 — Instructions files**: Every path in `instructions` must exist. Files in `glitch-memorycore/` need submodule init.
- **Step 3 — Agent configs**: New agents need valid models. Prompts can't reference missing files.
- **Step 4 — MCP servers**: Must have degraded mode (no crash when deps missing). **BLOCKER** if they crash on init.

**For `.ps1` files (validate-config.ps1):**
- **Step 0 — ASCII purity**: Check EVERY byte is 0x7F or below. **BLOCKER** if any byte > 0x7F exists.
- **Why**: PowerShell 5.1 on Windows reads BOM-less UTF-8 as Windows-1252. The em dash `—` (U+2014, UTF-8 bytes `E2 80 94`) has byte `0x94` which maps to `"` (RIGHT DOUBLE QUOTATION MARK) in Windows-1252. This silently opens an unintended string, cascading into random parse errors across the entire file.
- **Step 1 — Syntax parse**: Run `powershell -NoProfile -Command "& { . 'path\to\file.ps1' }"` or use AST parser. **BLOCKER** if it fails to parse.
- **Step 2 — Failure modes**: Can the script survive a missing binary? Port conflict? Missing submodule? Each hard failure should have a clear error message and suggest a recovery path (e.g., "run bootstrap" or "run safe mode").
- **Step 3 — Backup/restore integrity** (launch-safe.mjs only): Verify the backup-create, restore, and hash-check logic is intact. If the backup chain breaks, fixes made during safe mode are lost.
- **Step 4 — Leftover detection** (launch.mjs, serve.mjs only): Verify the `.bak` detection logic is intact. If a crash orphaned a .bak file, normal mode must still handle it gracefully (auto-restore or auto-delete).

**For `.bat` files (launch-glitch.bat, launch-glitch-safe.bat, launch-glitch-free.bat, serve-glitch.bat):**
- **Step 0 — Syntax**: Run the batch file or parse with cmd.exe. Check for unclosed `if` blocks, missing `)`, bad labels.
- **Step 1 — Error handling**: Does `if %errorlevel% neq 0 pause` exist? Without it, a script failure closes the terminal before the user can read the error.

**For `bootstrap.ps1`:**
- **Step 0 — Dependency completeness**: Every binary or npm package used by core files must have a corresponding install step. Missing = fresh clone can't launch.
- **Step 1 — Submodule init**: Must initialize `glitch-memorycore`. Without it, no instructions files load.

**For memory files (`glitch-memorycore/main/*.md`, `prompt-rules.md`, `glitch.md`):**
- **Step 0 — Structural integrity**: Does the file still parse as valid Markdown? Are all required sections present?
- **Step 1 — Cross-references**: Do links between memory files still resolve? Are there dead references to deleted files or renamed paths?
- **Step 2 — Token budget**: Memory files should not grow unbounded. If a file exceeds ~300 lines, flag for compaction.

**For skill files (`plugins/glitch-skills/skills/*/SKILL.md`):**
- **Step 0 — Registration**: Is the skill listed in `skills-registry.md`? If not, Glitch can't discover it.
- **Step 1 — References**: Does the skill reference scripts/files that exist? Dead references cause confusion but not crashes.

#### Verdict Rules for This Phase

- **BLOCKER** if: any change would prevent ANY launch mode from starting (normal, safe, free, server)
- **BLOCKER** if: any .ps1 file contains non-ASCII bytes
- **BLOCKER** if: opencode.json doesn't parse or has structural issues
- **BLOCKER** if: safe mode backup/restore logic is broken
- **BLOCKER** if: a new MCP server lacks degraded mode (crashes when deps missing)
- **MAJOR** if: bootstrap doesn't cover new dependencies
- **MAJOR** if: memory files exceed 300 lines without compaction
- **MINOR** if: degraded mode exists but has unclear error messaging

Add this to the gate verdict summary at the end:
```
Startup-Safety: ✅ PASS / ❌ FAIL (N issues)
```

### Phase 1: Context Gathering
1. Identify scope (single file? PR? full branch?)
2. Read commit messages / PR description for intent
3. Check diff stats (files changed, insertions/deletions)
4. **Run GitNexus `impact` on changed symbols/files** — identifies blast radius, transitive callers, and affected processes at depth. Faster and more complete than manual dependency tracing.
5. **Optional: Run `detect_changes` with the diff** — maps changed lines to processes, clusters, and entry points for deeper scope insight

### Phase 2: Five-Axis Review
Every change is evaluated across five axes. Use the checklist below.

**Axis 1: Correctness**
- Does the code match the spec/task requirements?
- Logic errors, off-by-one, wrong comparator, inverted conditions
- Missing edge cases: empty arrays, null inputs, boundary values, error states
- Race conditions, async/await issues, promise handling
- Error handling: missing try/catch, swallowed errors, unhandled rejections
- Type errors: incorrect TypeScript types, `any` usage, unsafe casts

**Axis 2: Security — Treat auth/identity code as HIGH RISK by default**
- **Auth/Authorization**: Protected routes actually guarded? Token validation correct? Session handling secure? Authorization checks MUST be on the server, not in UI logic. Never trust client-supplied identifiers or flags.
- **Input validation**: Is user input sanitized at every system boundary? Injection vectors (SQL, XSS, command injection, prototype pollution)? OWASP Top 10 coverage.
- **Secrets**: Hardcoded API keys, passwords, tokens, or credentials. Check env vars, git history, and config files.
- **Data exposure**: Sensitive data logged, sent to client, or exposed in error messages.
- **Dependency safety**: Outdated libraries with known CVEs? `npm audit` / equivalent check.
- **"Demand evidence, not explanations"** — code that "looks right" is not proof it works. For high-risk areas, require tests demonstrating boundary enforcement, reproduction steps for edge cases, or logs showing behavior under misuse.

**Axis 3: Readability & Simplicity**
- Naming clarity — do names explain the *why*, not just the *what*?
- Control flow straightforward? No nested ternaries, deep callbacks, or "clever" tricks.
- Are abstractions earning their complexity? Don't generalize until the third use case.
- **Over-engineering**: Layers of abstraction, unnecessary classes, patterns that add complexity without clear value. Default: simple is better.
- **Verbosity**: Can the same logic be expressed more concisely? Multi-step operations that could use a utility or language built-in?
- **Premature abstraction**: Interfaces, factories, or generic wrappers for a single use case (YAGNI violation)
- **Nested complexity**: Deeply nested conditionals/ternaries/chains that flatten with guard clauses or early returns
- **Duplication masked by abstraction**: Two concrete functions may be simpler to read than one generic function with configuration flags

**Axis 4: Architecture & Maintainability**
- Does the change follow existing patterns or introduce new ones? If new, is it justified?
- Clean module boundaries? No circular dependencies? Appropriate abstraction level?
- Dead code: unreachable functions, commented-out code, no-op variables, backwards-compat shims
- Magic numbers, string literals that should be constants
- Function/component too long (over 50 lines?), too many parameters (more than 3?), too many responsibilities
- Duplication: copy-pasted code that should be extracted
- Change sizing: ~100 lines good, ~300 acceptable for single change, >1000 lines too large — split it

**Axis 5: Performance & Compatibility**
- **Performance**: N+1 query patterns? Unbounded loops? Synchronous operations that should be async? Unnecessary re-renders? Missing pagination? Large objects in hot paths?
- **Compatibility**: Breaking API changes without migration path? Missing type hints / TypeScript strictness issues? Deprecated API usage? Inconsistent return shapes from API routes?

### Phase 3: Categorize Findings
Label every finding with its severity so the author knows what's required vs optional:

| Severity | Meaning | Author Action |
|----------|---------|---------------|
| **BLOCKER/CRITICAL** | Security vuln, crash, data loss, or logic bug WILL produce wrong output | MUST fix before merge. Stop, report immediately. |
| **MAJOR** | Should fix — performance, over-engineering, maintainability, missing error handling, no tests | Must be addressed before final sign-off |
| **MINOR** | Nice to fix — naming, minor duplication, style | Fix if time allows |
| **NIT** | Nitpick — personal preference, trivial | Optional, note for awareness |

For each finding use format: `file:line` + severity + what's wrong + why it matters + fix direction.

### Phase 4: Review Tests & Demand Evidence
1. **Review tests first** — test names reveal intent and coverage
2. Do tests exist? If not → MAJOR finding, flag test debt
3. Do tests test behavior (not implementation details)? 
4. Are edge cases covered? Would they catch a regression?
5. **Demand evidence for high-risk code** — "this should be safe" is not proof. Require tests that demonstrate boundary enforcement, reproduction steps for edge cases, or logs/metrics showing behavior under misuse. This applies especially to auth, payments, data validation, and state transitions.
6. Review the verification story: what tests were run, did build pass, was manual verification done?

### Phase 5: Gate Verdict Rules
1. If ANY **BLOCKER** is found → verdict is **FAIL** — review stops, report immediately
2. If NO blockers but MAJORs exist → verdict is **PASS with changes required** — list what must change
3. If only MINORs/NITs → verdict is **PASS** — advisory only
4. Include Startup-Safety result with any flagged issues
5. Summary: "Gate verdict: ✅ PASSED | ❌ FAILED (N blocker(s))"

## Mandatory Rules
1. Read the code, not just the diff — understand intent
2. Be specific with file:line references
3. Explain *why* something is a problem, not just *what*
4. Acknowledge what was done well — not just criticism
5. BLOCKER issues stop the gate — everything else is advisory
6. READ-ONLY — never modify code during review
7. If tests are missing, hand off to the testing skill

## Honesty in Review
When reviewing code — whether written by an agent or a human:

- **Don't rubber-stamp.** "LGTM" without evidence of review helps no one.
- **Don't soften real issues.** "This might be a minor concern" when it's a bug that will hit production is dishonest.
- **Quantify problems when possible.** "This N+1 query will add ~50ms per item" is better than "this could be slow."
- **Push back on approaches with clear problems.** If the implementation has issues, say so directly and propose alternatives.
- **Accept override gracefully.** If the author has full context and disagrees, defer to their judgment. Comment on code, not people.

## Dead Code Hygiene
After any refactoring or implementation change, check for orphaned code:

1. Identify code that is now unreachable or unused
2. List it explicitly with file paths
3. **Ask before deleting**: "Should I remove these now-unused elements?"

Don't leave dead code lying around — it confuses future readers and agents. Don't silently delete things you're not sure about either.

```
DEAD CODE IDENTIFIED:
- formatLegacyDate() in src/utils/date.ts — replaced by formatDate()
- OLD_API_URL constant in src/config.ts — no remaining references
→ Safe to remove these?
```

## Dependency Discipline
Part of every review is dependency review:

**Before adding any dependency:**
1. Does the existing stack solve this? Often it does.
2. How large is the dependency? Check bundle impact.
3. Is it actively maintained? Check last commit, open issues.
4. Does it have known vulnerabilities? Run `npm audit`.
5. What's the license? Must be compatible with the project.

**Rule:** Prefer standard library and existing utilities over new dependencies. Every dependency is a liability. Dependency sprawl (too many imports for what the code does) is a MAJOR finding.

## Common Rationalizations — DO NOT Accept

| Rationalization | Reality |
|----------------|---------|
| "It works, that's good enough" | Working code that's unreadable, insecure, or architecturally wrong creates debt that compounds. |
| "I wrote it, so I know it's correct" | Authors are blind to their own assumptions. Every change benefits from another set of eyes. |
| "We'll clean it up later" | Later never comes. The review is the quality gate — use it. |
| "AI-generated code is probably fine" | AI code needs MORE scrutiny, not less. It's confident and plausible, even when wrong. |
| "The tests pass, so it's good" | Tests are necessary but not sufficient. They don't catch architecture problems, security issues, or readability concerns. |
| "I'll fix it later" | Never happens. Require cleanup before merge unless it's a genuine emergency. |

## Red Flags
Watch for these patterns that indicate a review process failure:

- PRs merged without any review
- Review that only checks if tests pass (ignoring other axes)
- "LGTM" without evidence of actual review
- Security-sensitive changes without security-focused review
- Large PRs that are "too big to review properly" (split them)
- No regression tests with bug fix PRs
- Accepting "I'll fix it later" — it never happens
- Authorization checks tied to UI logic instead of server logic
- Trust in client-supplied identifiers or flags
- "Temporary" bypasses left in place

## Verification Checklist
After review is complete:

- [ ] All BLOCKER issues are resolved
- [ ] All MAJOR issues are resolved or explicitly deferred with justification
- [ ] Tests pass
- [ ] Build succeeds
- [ ] Verification story documented (what changed, how verified)
- [ ] No dead code left behind
- [ ] Dependencies are justified, not bloated

## Level History
- **Lv.1** — Base: 4-phase systematic code review with severity ratings.
- **Lv.2** — Quality Gate: auto-trigger check, bypass criteria, gate verdict, testing handoff.
- **Lv.3** — Startup-Safety Gate: Phase 0.5 checks boot sequence changes for degraded-mode compliance, fresh-clone resilience, and startup crash prevention.
- **Lv.4** — Enhanced Review: 5-axis framework (correctness/security/readability/architecture/performance), honesty directives, dead code hunting, dependency discipline, common rationalizations, red flags, "demand evidence" rule, verification checklist.
- **Lv.5** — Verifier Integration: Continuous quality scoring with repeated evaluation (K=3), criteria decomposition and ensemble (5 axes), multi-candidate comparison with ring pass and PPT, VOC progress tracking.

---

### Phase 6: Continuous Quality Scoring (Verifier Pattern)

After the Phase 5 gate verdict, when a finer-grained quality assessment is needed (or when comparing multiple candidate implementations), apply continuous scoring using the verifier methodology.

**Replace discrete severity counts with continuous scores:**

For each of the 5 axes, produce a continuous quality score in [0.0, 1.0]:

```
Axis Score = (1/K) · Σ_k Score_k
```

Where K = 3 (repeated evaluations) and each Score_k is a continuous rating of the axis quality.

#### Scoring Protocol

For each axis, evaluate independently:

| Axis | Sub-questions to Score | Weight |
|------|----------------------|--------|
| Correctness | Does it meet requirements? Edge cases handled? Error paths covered? | 0.30 |
| Security | Auth enforced? Inputs validated? Secrets exposed? | 0.25 |
| Readability | Clear names? Straightforward flow? No over-engineering? | 0.15 |
| Architecture | Clean boundaries? Right abstraction level? No dead code? | 0.15 |
| Performance | N+1 queries? Unbounded loops? Sync vs async? | 0.15 |

For each sub-question, rate 0.0-1.0:
- 0.0 = completely fails
- 0.25 = major issues
- 0.5 = adequate
- 0.75 = good
- 1.0 = excellent

Average sub-questions within each axis, then ensemble:

```
Quality Score = Σ(weight_i · score_i)
```

#### Repeated Evaluation (K=3)

For high-stakes reviews, run each scoring pass 3 times:
- Rephrase the evaluation prompt slightly each time (e.g., "focus on edge cases", "focus on correctness", "focus on maintainability")
- Average the 3 scores for each axis
- Report the mean and the min-max range (shows uncertainty)

### Phase 7: Multi-Candidate Comparison

When reviewing N candidate implementations of the same feature:

1. **Score each independently** using Phase 6, producing continuous scores R_i
2. **Run ring pass** — compare pairs with A/B ordering swapped to cancel positional bias
3. **Compute pairwise preferences**:

   ```
   P(i ≻ j) = 1 / (1 + exp(-(R_i - R_j)))
   ```

4. **Rank by cumulative preference** — aggregate wins across all pairings
5. **Select best candidate** — highest normalized win count

For N ≥ 5 candidates, use the Probabilistic Pivot Tournament (PPT) from the verifier skill:
- Ring pass scores all N adjacent pairs (N comparisons)
- Top-k pivots selected by mean preference
- Non-pivots compared only against pivots (O(Nk²) total)

### Phase 8: Progress Tracking (VOC)

When reviewing code across multiple iterations of the dev-loop:

1. Track the continuous quality score at each iteration
2. Compute Value-Order Correlation (VOC) — Spearman rank correlation between iteration index and quality score
3. Interpretation:
   - VOC > 0.8: quality improving steadily — good trajectory
   - VOC 0.5-0.8: quality improving slowly — may need attention
   - VOC < 0.5: quality not improving — escalate
   - Negative VOC: quality decreasing — stop and reassess

### Output Format for Continuous Review

When the verifier methodology is active, produce an extended verdict:

```
## Verifier Gate Results

### Continuous Quality Scores
| Axis | Score (0-1) | Weight | Weighted |
|------|-------------|--------|----------|
| Correctness | 0.85 | 0.30 | 0.255 |
| Security | 0.92 | 0.25 | 0.230 |
| Readability | 0.70 | 0.15 | 0.105 |
| Architecture | 0.75 | 0.15 | 0.113 |
| Performance | 0.80 | 0.15 | 0.120 |

**Ensemble Quality Score: 0.823** (K=3 evaluations, range: 0.78-0.86)
**VOC: 0.82** (across 4 iterations — quality improving steadily)

### Pairwise Rankings (N=3 candidates)
| Rank | Candidate | Score | Preference Mass |
|------|-----------|-------|-----------------|
| 1 | Candidate B | 0.823 | 0.67 |
| 2 | Candidate A | 0.745 | 0.21 |
| 3 | Candidate C | 0.612 | 0.12 |

### Gate Verdict
✅ PASS — Quality score 0.823 above threshold (0.70)
```

## Thresholds

| Quality Score | Verdict |
|---------------|---------|
| ≥ 0.85 | ✅ Excellent — pass with praise |
| 0.70 - 0.84 | ✅ Pass — minor issues noted |
| 0.50 - 0.69 | ⚠️ Conditional — must fix below-threshold axes |
| < 0.50 | ❌ Fail — fundamental issues |