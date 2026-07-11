---
name: dev-loop
description: "MUST load when running autonomous development — building features end-to-end without user interaction.
              Activates when: user says 'build this feature', 'implement X', 'run the dev loop', 'autonomous mode',
              or when running autonomously — continuously iterating on code with write → review → render → interact → verify cycles.
              NOT for single-file edits, simple changes, or one-off tasks."
---

# Autonomous Dev Loop — Write → Review → Security Scan → Build → Interact → Verify → Iterate

## Activation
When this skill activates, output:
"🔄 Running autonomous dev loop [write → review → security scan → build → interact → verify → iterate]..."

## Architecture

The dev loop orchestrates sub-agents in a strict sequence for each feature:

```
┌──────────────────────────────────────────────────────────┐
│                     DELEGATOR (me)                        │
│    Orchestrates phases, evaluates results, loops back    │
└───┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬─────┘
    │      │      │      │      │      │      │      │
    ▼      ▼      ▼      ▼      ▼      ▼      ▼      ▼
 Write  Review  Secure  Build  Interact Verify Iterate Complete
  │       │     Scan    │       │       │       │       │
  ▼       ▼       ▼    ▼       ▼       ▼       ▼       ▼
@coder  @reviewer @pent- @general @coder  @vision  Glitch
@general          ester          +       checks   evaluates
                   +             @general screens  pass/fail
                  snyk    wait   runs     hots    loops back
                  truffle -for-  browser-         or finishes
                  nuclei  server interact
```

### Sub-agent Roles in the Loop

| Phase | Agent | Action | Output |
|-------|-------|--------|--------|
| **Write** | @coder or @general | Writes code files for the feature | Code changes |
| **Review** | @reviewer | Quality + security audit | Structured report with pass/fail verdict |
| **Security Scan** | @pentester or @pentester-paid | Static scans: snyk, trufflehog, code pattern grep for OWASP issues | Security findings report with severity |
| **Build** | @general | Start dev server, wait for readiness | Server running on port |
| **Interact** | @coder (plan) + @general (execute) | Write JSON plan, run browser-interact.mjs + dynamic nuclei scan | Screenshots + results.json + nuclei findings |
| **Verify** | @vision | Analyze screenshots against expectations | Visual pass/fail report |
| **Iterate** | Delegator | Evaluate all results (code, security, visual), decide loop or finish | Next phase instructions |

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

### Phase 1: Write

**Goal**: Implement the feature code.

1. Delegate to @coder (complex: 5+ files, auth, API) or @general (simple: 1-5 files)
2. Provide clear requirements: what to build, expected behavior, acceptance criteria
3. Include any context from previous loop iterations (failure reasons, review findings)
4. After code is written, verify the file changes exist

**Output check**: All files were created/modified and pass basic syntax check.

### Phase 2: Review

**Goal**: Catch bugs, security issues, and quality problems before running.

1. Delegate to @reviewer with the list of changed files
2. Wait for full structured report
3. Check gate verdict:
   - **FAIL** (BLOCKER found) → Immediately loop back to **Phase 1: Write** with the BLOCKER details. Do NOT proceed.
   - **PASS with changes required** (MAJOR findings) → Loop back to **Phase 1: Write** with MAJOR findings to fix.
   - **PASS** (only MINORs/NITs) → Proceed to Phase 3: Security Scan.

### Phase 3: Security Scan

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
   - **MEDIUM/LOW** → Log for the final report, proceed to Phase 4: Build.

5. **Run dynamic scanning later**: The nuclei vulnerability scanner runs against the live server in Phase 5: Interact. You don't need to run it here.

**Output check**: Security findings report with severity levels. No CRITICAL/HIGH blocking findings, or they are already fed back to Write phase.

### Phase 4: Build

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

### Phase 5: Interact

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
   - If browser crash → check server is still running, retry Phase 4: Build

5. **Dynamic security scan** — While the server is running, run nuclei against it:
   ```bash
   tools/security/nuclei.exe -u http://localhost:3000 -o reports/security/dev-loop-nuclei.txt
   ```
   Parse results for any CRITICAL/HIGH findings. Add them to the failure context if found.

### Phase 6: Verify

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

### Phase 7: Iterate

**Goal**: Decide whether to loop or finish.

1. **Collect all failure context**: Gather results from Review, Security Scan, Interact, and Verify phases
2. **Make a decision**:
   - All phases passed → Feature complete. Move to next feature or notify user.
   - Phase failed → Loop back to **Phase 1: Write** with ALL failure context:
     - @reviewer's findings (quality issues)
     - @pentester's findings (security vulnerabilities, CVEs, secrets)
     - Interaction test failures (which steps failed, error messages)
     - nuclei scan results (dynamic vulnerability findings)
     - @vision's visual analysis (what doesn't look right)
     - Console errors captured during interaction
3. **Loop budget**: Maximum 3 iterations per feature before escalating
4. After all features complete → present summary to user

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
- **Browser crashes**: Restart server, relaunch browser, retry from Phase 4: Build
- **Selector not found**: The @reviewer may have missed something — check the actual rendered HTML (use `evaluate` action to dump HTML)
- **Intermittent failures**: Add `waitForTimeout` or `waitForSelector` before dependent actions
