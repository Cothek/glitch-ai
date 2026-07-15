---
name: dev-loop
description: "MUST load when running autonomous development — building features end-to-end without user interaction.
              Activates when: user says 'build this feature', 'implement X', 'run the dev loop', 'autonomous mode',
              or when running autonomously — continuously iterating on code with write → select → review → security scan → build → interact → verify → iterate cycles.
              NOT for single-file edits, simple changes, or one-off tasks."
---

# Autonomous Dev Loop — Write → Select → Review → Security Scan → Build → Interact → Verify → Iterate

## Activation
When this skill activates, output:
"🔄 Running autonomous dev loop [write → select → review → security scan → build → interact → verify → iterate]..."

## Architecture

The dev loop orchestrates sub-agents in a strict sequence for each feature:

```
┌──────────────────────────────────────────────────────────────┐
│                     DELEGATOR (me)                            │
│    Orchestrates phases, evaluates results, loops back        │
└───┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──┘
    │      │      │      │      │      │      │      │      │
    ▼      ▼      ▼      ▼      ▼      ▼      ▼      ▼      ▼
 Write  Select  Review  Secure  Build  Interact Verify Iterate Complete
  │       │       │     Scan    │       │       │       │      │
  ▼       ▼       ▼      ▼     ▼       ▼       ▼       ▼      ▼
@coder  Glitch  @reviewer @pent- @general @coder  @vision  Glitch
@general runs   (uses    ester  starts   runs    checks   evaluates
(×N)    verifier verifier +      server  browser- screens  pass/fail
        skill   scoring)  snyk   wait    interact hots    loops back
                          truffle -for-  +        or finishes
                          nuclei  server nuclei
```

### Sub-agent Roles in the Loop

| Phase | Agent | Action | Output |
|-------|-------|--------|--------|
| **Write** | @coder or @general | Writes N candidate implementations for the feature | N code change sets |
| **Select** | Glitch | Uses verifier skill + PPT to select best from N candidates | Single selected implementation + ranking |
| **Review** | @reviewer | Quality + security audit using verifier continuous scoring | Structured report with continuous quality score |
| **Security Scan** | @pentester or @pentester-paid | Static scans: snyk, trufflehog, code pattern grep | Security findings report |
| **Build** | @general | Start dev server, wait for readiness | Server running on port |
| **Interact** | @coder (plan) + @general (execute) | Write JSON plan, run browser-interact.mjs + nuclei scan | Screenshots + results.json |
| **Verify** | @vision | Analyze screenshots against expectations | Visual pass/fail report |
| **Iterate** | Glitch | Evaluate VOC + phase results, decide loop or finish | Next phase instructions |

## Tool Creation (CodeAct-lite)

**When the dev loop hits a missing capability** — a sub-agent says "I wish I had a tool that..." or a repetitive task appears 2+ times — **create a tool on the spot**.

Tool creation can happen at ANY phase. It's not a separate phase — it's a capability the agent carries through the whole loop.

### Process (TDD Methodology)

**Phase 1 — Write tests first** (test-first, test-driven development):
1. **Identify the pattern or missing capability** — what should the tool do?
2. **Write test cases** as `{ input, expected }` pairs covering:
   - Happy path (normal input)
   - Edge cases (empty input, boundary values)
   - Error handling (invalid input, null, missing fields)
3. **Run the tests with a stub** to confirm they fail (red phase):
   ```
   node plugins/dev-loop/tdd-test.mjs --code "function handler(input) { return null; }" --tests '[{"input":{"x":41},"expected":42}]'
   ```

**Phase 2 — Implement the tool**:
4. **Write the handler** function to make tests pass
5. **Run tests** — all should pass (green phase):
   ```
   node plugins/dev-loop/tdd-test.mjs --code "function handler(input) { return input.x + 1; }" --tests '[{"input":{"x":41},"expected":42,"name":"41+1"},{"input":{"x":0},"expected":1,"name":"0+1"}]'
   ```
6. **Iterate** — if any test fails, read the error, fix the code, retest
7. **Save on all pass**:
   ```
   node plugins/dev-loop/tdd-test.mjs --code "function handler(input) { return input.x + 1; }" --tests '[{"input":{"x":41},"expected":42}]' --save-on-pass plugins/tools/adder.mjs
   ```

The tool is now live — committed, pushed, available on every machine.

### When to create a tool (triggers)

- **Repetitive data transformation** — same format conversion, parsing, or validation appearing 2+ times
- **API interaction** — calling an external API that could be encapsulated
- **Complex calculation** — any algorithm or logic that could be reused
- **Code generation** — boilerplate or templating that follows a repeatable pattern
- **Cross-cutting concern** — logging, timing, formatting needed across multiple tasks
- **Any time you think "I could automate this"** — if it takes longer to describe than to write, write it.

### Tool format

Tools are simple JavaScript modules with a `handler` function:

```js
// plugins/tools/my-tool.mjs
export function handler(input) {
  // input is whatever the agent passes
  // return whatever the agent needs
  return processedResult;
}
```

Or just a plain function:

```js
function handler(input) {
  return input * 2;
}
```

### Testing workflow

```bash
# Quick smoke test (single input, no test cases):
node plugins/dev-loop/execute-tool.mjs \
  --code "function handler(input) { return input.map(x => x * 2); }" \
  --input '[1, 2, 3]'

# TDD workflow (write tests first, then implement):
node plugins/dev-loop/tdd-test.mjs \
  --code "function handler(input) { return input.map(x => x * 2); }" \
  --tests '[{"input":[1,2,3],"expected":[2,4,6],"name":"doubles array"},{"input":[],"expected":[],"name":"empty array"}]'

# Save on all tests pass:
node plugins/dev-loop/tdd-test.mjs \
  --code "function handler(input) { return input.map(x => x * 2); }" \
  --tests '[{"input":[1,2,3],"expected":[2,4,6]}]' \
  --save-on-pass plugins/tools/double-array.mjs
```

### Tool lifecycle (run & promote)

After saving a tool, invoke it via the lifecycle wrapper to track trust:

```bash
node plugins/dev-loop/run-tool.mjs double-array --input '[1, 2, 3]'
```

This automatically tracks success/failure and promotes trust levels:
- `tested` → first successful run after TDD save
- `validated` → 3+ successful runs, no failures
- `live` → 10+ successful runs, proven reliable

### Integration with Forge

When the same tool gets created in 3+ different dev loops, that's a Forge trigger — promote it from a standalone tool to a permanent skill (with SKILL.md documentation) or a dedicated sub-agent.

---

## Protocol

### Phase 1: Write — Multi-Candidate Generation

**Goal**: Generate N candidate implementations to maximize coverage of the solution space.

1. **Decompose the feature** into the key decision dimensions (e.g., approach, data flow, state management, error handling)
2. **Dispatch N parallel generation tasks** to @coder or @general:
   - For complex features: dispatch N independent @coder tasks, each with a slightly different prompt focus (e.g., "optimize for simplicity", "optimize for completeness", "optimize for performance")
   - For simple features: N=2 candidates is sufficient
   - For complex/architectural decisions: N=5 candidates to explore solution space
3. **Collect all N candidates** — verify each exists and compiles
4. Pass all N candidates to Phase 2: Select

**N defaults by complexity:**
- Simple (1-2 files, standard pattern): N=1 (skip multi-candidate, go directly to Select)
- Medium (3-5 files, some new logic): N=2
- Complex (5+ files, architecture decisions): N=3-5
- Architectural decision (framework, data layer, auth): N=5

### Phase 2: Select — Best Candidate via Probabilistic Pivot Tournament

**Goal**: Efficiently select the best candidate from N implementations using the verifier methodology.

**Delegation**: This phase runs directly (not delegated) — it requires reasoning about the code, not editing it.

1. **Load the verifier skill** — `skill("verifier")` for continuous scoring methodology
2. **Score each candidate** on 3 quick criteria (not a full 5-axis review, just a lightweight pass):
   - Does it compile/satisfy requirements?
   - Is the approach clean and maintainable?
   - Are edge cases handled?
3. **For N <= 3**: Run full round-robin pairwise comparison using ring pass (swap A/B ordering)
4. **For N >= 4**: Run Probabilistic Pivot Tournament:
   - Ring pass: Compare each adjacent pair (N comparisons, A/B swapped for bias cancellation)
   - Pick top k=3 pivots by mean preference score
   - Compare all non-pivots against all pivots
   - Select candidate with highest normalized win count
5. **If candidates are close (score difference < 0.05)**: Run K=3 repeated evaluation to reduce noise, then re-rank.
6. **Submit the selected candidate** to Phase 3: Review

**Output**: Single selected implementation + the full ranking for reference.

### Phase 3: Review

**Goal**: Catch bugs, security issues, and quality problems before running.

1. Delegate to @reviewer with the list of changed files
2. Wait for full structured report
3. Check gate verdict:
   - **FAIL** (BLOCKER found) → Immediately loop back to **Phase 1: Write** with the BLOCKER details. Do NOT proceed.
   - **PASS with changes required** (MAJOR findings) → Loop back to **Phase 1: Write** with MAJOR findings to fix.
   - **PASS** (only MINORs/NITs) → Proceed to Phase 4: Security Scan.

### Phase 4: Security Scan

**Goal**: Catch security vulnerabilities, secrets, and dependency risks before the app runs.

**Tool locations**:
- **snyk**: global npm install (`snyk test`)
- **nuclei**: `tools/security/nuclei.exe` (dynamic scanning — used in Interact phase below)
- **trufflehog**: `tools/security/trufflehog.exe`

1. **Dependency vulnerability scan** — Delegate to @pentester or run directly:
   ```bash
   # npm audit for quick check
   cd <project-dir> && npm audit

   # snyk for deeper analysis
   snyk test --all-projects
   ```
   Check results for CRITICAL or HIGH severity CVEs.

2. **Secret scan** — Check git history and current files for hardcoded credentials:
   ```bash
   tools/security/trufflehog.exe filesystem --directory=<project-dir> --results=verified
   ```
   If verified secrets found → BLOCKER.

3. **Code pattern scan** — Grep for high-risk patterns in changed files:
   - `innerHTML|dangerouslySetInnerHTML` → XSS risk
   - `exec\(|spawn\(` in user-facing code → command injection risk
   - `\.env` or hardcoded keys in committed files
   - Auth checks that live only in client code, not on server
   - SQL string interpolation in DB queries

4. **Evaluate findings**:
   - **CRITICAL finding** (credential leak, hardcoded API key in committed code, SQL injection) → **BLOCKER**. Immediately loop back to **Phase 1: Write** with full details. Do NOT proceed.
   - **HIGH finding** (XSS, outdated dep with known exploit, exposed internal path) → Flag as MAJOR. Loop back to **Phase 1: Write** with findings.
   - **MEDIUM/LOW** → Log for the final report, proceed to Phase 5: Build.

5. **Run dynamic scanning later**: The nuclei vulnerability scanner runs against the live server in Phase 6: Interact. You don't need to run it here.

**Output check**: Security findings report with severity levels. No CRITICAL/HIGH blocking findings, or they are already fed back to Write phase.

### Phase 5: Build

**Goal**: Get the app running so we can interact with it.

1. Delegate to @general to start the dev server:
   - For Next.js apps: `cd E:\Glitch AI\code\ai-gm && node scripts/start-dev.ps1`
   - For other projects: appropriate start command
2. Wait for server readiness using `wait-for-server.mjs`:
   ```
   node glitch-memorycore/plugins/dev-loop/wait-for-server.mjs http://localhost:3000 --timeout 60
   ```
3. If server fails to start → capture error, loop back to Phase 1 with server error context

**Important**: Use `Start-Process -WindowStyle Hidden` (PowerShell) or the existing start-dev scripts to avoid hanging. Do NOT run long-lived servers directly in the bash tool.

**Output check**: Server responds with HTTP 200 at the expected URL.

### Phase 6: Interact

**Goal**: Verify the app works through actual browser interaction — clicking, typing, navigating.

1. Delegate to **@coder** to write a JSON interaction plan for `browser-interact.mjs`:
   - Plan what pages/features need testing
   - Use the Interaction DSL Reference below for available action types
   - Include assertions to verify correct behavior
   - Include screenshots at key steps for @vision analysis
   - Save the plan as a JSON file in the ai-gm project directory

2. Delegate to **@general** to execute the plan:
   ```
   cd E:\Glitch AI\code\ai-gm && node scripts/browser-interact.mjs --plan plans/feature-test.json --out-dir browser-test-output/feature-name
   ```
   - If using `--plan-json` on Windows, pipe the JSON carefully (double quotes inside single quotes)

3. Read the results:
   - Parse the `---RESULTS_START---` / `---RESULTS_END---` JSON from stdout
   - Read `results.json` from the output directory
   - Check: `summary.success === true` and `summary.failed === 0`
   - Review per-step results for any failures

4. If interaction tests fail:
   - If step-level failures → include failure details in loop-back to Phase 1
   - If browser crash → check server is still running, retry Phase 5: Build

5. **Dynamic security scan** — While the server is running, run nuclei against it:
   ```bash
   tools/security/nuclei.exe -u http://localhost:3000 -o reports/security/dev-loop-nuclei.txt
   ```
   Parse results for any CRITICAL/HIGH findings. Add them to the failure context if found.

### Phase 7: Verify

**Goal**: Visually confirm the UI looks correct and matches expectations.

1. For each screenshot from the interaction plan, delegate to **@vision**:
   ```
   "Analyze this screenshot: <path-to-screenshot.png>
    The expected state is: <description of what should be visible>
    Does this match? Report any visual issues."
   ```

2. Compile @vision's findings:
   - If all screenshots match expectations → phase passes
   - If any screenshot shows issues → note the visual defects

3. If visual defects found → loop back to Phase 1 with @vision's descriptions of what's wrong

### Phase 8: Iterate — VOC-Guided Decision

**Goal**: Decide whether to loop or finish, guided by Value-Order Correlation (VOC).

1. **Compute verifier quality score** for the current iteration using continuous scoring (from code-review Phase 6)
2. **Track VOC** — maintain a running list of (iteration_number, quality_score) pairs
3. **Compute Spearman rank correlation** between iteration indices and quality scores:
   ```
   VOC = rank_correlation(argsort(scores), iteration_indices)
   ```
4. **Make a decision based on VOC + results**:
   - All phases passed AND VOC > 0.8 → Feature complete. Move to next feature or notify user.
   - VOC 0.5-0.8 but phase failed → Loop back to Phase 1 with failure context. Quality is improving, keep iterating.
   - VOC < 0.5 → **Escalate**: Quality is not improving. Flag to user. May need architectural rethink, not more iterations.
   - Negative VOC → **Stop**: Quality is decreasing. Something is fundamentally wrong. Escalate to user immediately.
5. **Collect all failure context**: Gather results from Review, Security Scan, Interact, and Verify phases
6. **Loop budget**: Maximum 3 iterations per feature before escalating (regardless of VOC)
7. After all features complete → present summary to user

**VOC tracking table format:**
```
## VOC Progress
| Iteration | Quality Score | Delta |
|-----------|--------------|-------|
| 1 | 0.52 | — |
| 2 | 0.68 | +0.16 |
| 3 | 0.74 | +0.06 |
| 4 | 0.71 | -0.03 |

VOC: 0.82 — quality improving, but iteration 4 plateau. One more iteration before escalate.
```

## Interaction DSL Reference

All action types supported by `browser-interact.mjs`:

### Navigation & Page Actions

| Action | Parameters | Description |
|--------|-----------|-------------|
| `navigate` | `url` (required), `waitUntil` (default: 'networkidle') | Navigate to a URL |
| `waitForNavigation` | `waitUntil` (default: 'networkidle') | Wait for page to finish loading |

### Element Interaction

| Action | Parameters | Description |
|--------|-----------|-------------|
| `click` | `selector`, `text`, `label`, `placeholder`, `role`+`name`, or `testId` | Click an element |
| `fill` | `selector` (required), `value` (required) | Type into a form field |
| `selectOption` | `selector` (required), `value` (required) | Select a dropdown option |
| `check` | `selector` (required), `force` (optional) | Check a checkbox |
| `uncheck` | `selector` (required), `force` (optional) | Uncheck a checkbox |
| `hover` | `selector`, `text`, or other selector resolution | Hover over an element |
| `scrollIntoView` | `selector` (required) | Scroll element into view |
| `pressKey` | `key` (required), `selector` (optional to focus first) | Press a keyboard key |

### Waiting

| Action | Parameters | Description |
|--------|-----------|-------------|
| `waitForSelector` | `selector` (required), `state` ('visible'/'hidden'/'attached', default: 'visible') | Wait for element to appear |
| `waitForTimeout` | `ms` (default: 1000) | Wait N milliseconds |

### Extraction

| Action | Parameters | Description |
|--------|-----------|-------------|
| `extractText` | `selector` (required) | Get text content of an element |
| `extractAttribute` | `selector` (required), `attribute` (required) | Get an attribute value |
| `evaluate` | `code` or `expression` (required) | Run arbitrary JS in page context |
| `screenshot` | `name` (default auto), `fullPage` (default true) | Take a screenshot |

### Assertions

| Action | Parameters | Description |
|--------|-----------|-------------|
| `assertVisible` | `selector` (required) | Assert element is visible |
| `assertHidden` | `selector` (required) | Assert element is hidden |
| `assertText` | `selector` (required), `expected` or `includes` (one required) | Assert element text matches |
| `assertUrl` | `pattern` (required, string or regex) | Assert current URL matches |
| `assertCount` | `selector` (required), `expected` (required), `operator` (default '===') | Assert element count matches |

### Common Parameters (all actions)

| Parameter | Type | Description |
|-----------|------|-------------|
| `label` | string | Human-readable name for stdout logging |
| `timeout` | number | Per-action timeout in ms (default: 30000) |
| `fatal` | boolean | If true, abort entire run on failure |
| `suppressScreenshot` | boolean | Skip auto-screenshot for this step |
| `force` | boolean | Force action (bypass actionability checks) |

### Selector Resolution (all actions with element targeting)

Actions that target elements accept ANY of these parameters (in priority order):
- `selector` — CSS selector (e.g., `#submit-btn`, `.card`, `button[type="submit"]`)
- `text` — Matches by visible text: `text=Submit`
- `label` — Matches by label element: `label=Email address`
- `placeholder` — Matches by placeholder attribute
- `role` + `name` — ARIA role with accessible name: `role=button[name="Submit"]`
- `testId` — Matches by `data-testid` attribute

## Best Practices

### Writing Interaction Plans

1. **Start simple**: Begin with basic navigation and rendering checks before complex workflows
2. **One test per concern**: Each feature gets its own plan file
3. **Key screenshots**: Take screenshots at important states (initial render, after user action, error states)
4. **Assert early, assert often**: Use `assertVisible`, `assertText`, `assertUrl` to verify state at each step
5. **Graceful error paths**: Test both happy path and error states (empty forms, invalid input, missing data)
6. **Label everything**: Each action should have a descriptive `label` for readable output

### Using @vision for Verification

When asking @vision to check screenshots, include:
- The expected state description (what should be on screen)
- The component/feature being verified
- Specific things to check (colors, layout, text, responsiveness)

Example prompt:
```
"Analyze this screenshot: browser-test-output/signup/step-003.png
Expected state: The sign-up form after clicking 'Create Account' with all fields valid.
Should show: A success message 'Account created!' and a redirect button.
Check for: Proper spacing, visible text, no layout breaks."
```

### Fallback on Failure

- **Server won't start**: Check for port conflicts, kill existing processes with `stop-dev.ps1`, retry
- **Browser crashes**: Restart server, relaunch browser, retry from Phase 5: Build
- **Selector not found**: The @reviewer may have missed something — check the actual rendered HTML (use `evaluate` action to dump HTML)
- **Intermittent failures**: Add `waitForTimeout` or `waitForSelector` before dependent actions