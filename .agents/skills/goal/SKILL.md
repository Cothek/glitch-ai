---
name: goal
description: "Project goal definition — asks clarifying questions to figure out what you're actually building before writing any code. Works for UI screens, features, CLI tools, and backend APIs. Use when the brief is ambiguous, starting something new, or when you need to nail down what you actually want."
---

# Goal — Project Goal Definition

This skill produces a **goal definition**, not code. The point is to force low-fi thinking — clarifying what success looks like, prioritizing what matters, sketching the structure, catching edge cases — before any code is written. Skipping this step is how you build the wrong thing: straight to implementation, no discovery, every project drifts.

**Core principle:** The goal definition is a single Markdown block with all 5 steps, in order. Nothing else. Do NOT write code during goal definition. Do NOT skip steps.

---

## Step 0 — Detect Project Type

Before defining the goal, determine what kind of project this is. Ask quietly (no explicit question to the user — infer from context):

| If the target is... | Use mode... |
|-|-|
| A visual interface, page, screen, component, layout | **UI mode** |
| A feature, workflow, process, system behavior | **Feature/System mode** |
| A CLI, script, automation, command-line tool | **CLI/Tool mode** |
| A backend service, API endpoint, data pipeline, server logic | **Backend/API mode** |

If ambiguous, ask one clarifying question: "Is this a UI screen, a feature/workflow, a CLI tool, or a backend API?"

If the project is large (multiple of the above), run goal once per distinct component. A full-stack feature might run goal twice: once for the API backend, once for the UI surface.

---

## UI Mode

Define the goal for a UI screen before writing components.

### Step 1 — Clarify (3-5 questions)

Ask these before defining the goal. Don't guess:

- What's the **primary user action** on this screen? (One verb, one object.)
- What data is **visible by default** vs **hidden behind a click or tab**?
- What does **success** look like — a state, a redirect, a toast?
- Who's the **primary user** — first-timer, power user, mobile-first?

### Step 2 — Content inventory

Bullet list of every piece of content that will appear. Annotate each by priority:

- **P0** — must be visible on first paint. Cut it and the screen fails.
- **P1** — one click away (tab, accordion, drawer).
- **P2** — settings-level; rarely accessed.

Example:
```
- P0  Headline (one line, the value prop)
- P0  Primary CTA
- P0  Hero chart / metric
- P1  Secondary nav tabs
- P1  Recent activity list
- P2  Export / integrations menu
```

### Step 3 — ASCII layout

Low-fi sketch showing regions. No specific copy, no colors, no font sizes. One desktop variant + one mobile variant. Use box characters:

```
Desktop
┌──────────────────────────────────────────────┐
│ [logo]                 [nav]         [user]  │
├──────────────────────────────────────────────┤
│  ┌────────────────┐   ┌───────────────────┐  │
│  │ Headline + sub │   │                   │  │
│  │                │   │   Hero visual     │  │
│  │ [Primary CTA]  │   │                   │  │
│  └────────────────┘   └───────────────────┘  │
│                                              │
│  ── Social proof row ──                      │
│                                              │
│  ┌─── Feature 1 ───┐   ┌─── Feature 2 ───┐   │
│  └─────────────────┘   └─────────────────┘   │
└──────────────────────────────────────────────┘
```

Asymmetry is fine and often better — don't force center-everything.

### Step 4 — State list

Enumerate the states this screen must handle. Mark each as **required** / **optional (why)** / **N/A**.

- **idle** — default state, data present.
- **loading** — skeletons that mirror final layout, 200ms delay before showing.
- **empty** — first-run or no data; doubles as onboarding.
- **error** — specific cause + recovery action + support ID.
- **partial** — some data loaded, some failed (e.g., one widget erred).
- **conflict** — user-edit collision (rare but load-bearing on collaborative surfaces).
- **offline** — queue writes, reconcile on reconnect.
- **success** — confirmation state after the primary action completes.

### Step 5 — Open questions

Do NOT start coding until these are answered. Default set:

- Accent color — brand-defined, or to be chosen?
- Typography — existing tokens, or new system?
- Responsive breakpoints — what's the minimum supported width?
- Animation — CSS only, or a library?
- Data source — real API ready, or mock for now?
- Keyboard / a11y requirements — anything beyond baseline?

---

## Feature/System Mode

Define the goal for a feature, workflow, or system behavior before implementing.

### Step 1 — Clarify (3-5 questions)

- What **problem** does this solve? Who has this problem?
- What is the **core action** the user takes? (One verb.)
- What **triggers** this feature — user action, scheduled, event? What's the entry point?
- What does **success** look like — what observable outcome tells us this works?
- What's the **"why now"** — why are we building this instead of something else?

### Step 2 — Feature inventory

Bullet list of every capability this feature exposes. Annotate each by priority:

- **P0** — core path. Feature is useless without this. Ship-blocking.
- **P1** — important but has a workaround. Ship without it, but soon.
- **P2** — nice-to-have. Future iteration.

Example:
```
- P0  User invites another user via email
- P0  Invitee receives notification
- P0  Invitee accepts and gets access
- P1  Bulk invite via CSV upload
- P1  Invite expiration and reminder
- P2  SSO/SAML invite auto-provisioning
- P2  Admin audit log of invites
```

### Step 3 — Workflow diagram

Low-fi ASCII diagram of the flow from entry to completion. Show branching paths:

```
User hits "Share" on document
  │
  ├─[Is collaborator?]──Yes──> Add permission inline
  │
  └─[No account yet?]──Yes──> Send invite email
        │                          │
        │                    ┌──────┘
        │                    ▼
        │              [Accept?]──No──> Expire after 7d
        │                    │
        │                    ▼
        │              Provision access
        │                    │
        └────────────────────┘
                        ▼
              Notify doc owner
```

Show the main flow (happy path) + at least two branch flows.

### Step 4 — Edge cases and failure modes

Enumerate what can go wrong and how the system should respond. Mark each as **handle now** / **handle later** / **out of scope**.

- **Auth failure** — what if the user isn't logged in?
- **Permission denied** — what if they lack access?
- **Resource not found** — what if the target doesn't exist?
- **Rate limit / throttle** — what if they're doing this too fast?
- **Idempotency** — what if they trigger this twice?
- **Partial failure** — what if half the operation succeeds?
- **Stale state** — what if the data changed since they loaded the page?
- **Backpressure** — what if downstream is slow or down?
- **Timeout** — what if the operation takes too long?
- **Data validation** — what if input is malformed?

### Step 5 — Open questions

Default set:
- Integration points — what existing systems does this touch?
- Data storage — new tables? New collections? Existing schema?
- Rollout strategy — feature flag? Beta users? Gradual?
- Observability — what metrics/logs tell us if this is working?
- Dependencies — what must exist before this can land?
- Backward compatibility — does this break existing behavior?

---

## CLI/Tool Mode

Define the goal for a command-line tool or automation script before writing code.

### Step 1 — Clarify (3-5 questions)

- What's the **single core verb** this tool performs? (One verb, one noun: "convert markdown to html", "validate JSON schema", "scaffold a component")
- What **input** does it take? (File, stdin, argument, environment variable?)
- What **output** does it produce? (File, stdout, modified files?)
- Is this a **one-shot** command or a **long-running** process (watch, serve, daemon)?
- Who's the **primary user** — developer, CI pipeline, end-user?

### Step 2 — Command tree / flags inventory

Bullet list of every command and flag, annotated by priority:

- **P0** — required for the tool to be useful at all.
- **P1** — common customization, needed for real use.
- **P2** — edge-case flags, config file overrides, hidden options.

Example:
```
- P0  `tool <input>` — basic usage, default output
- P0  `--output, -o` — specify output path
- P1  `--format, -f` — output format (json, yaml, text)
- P1  `--verbose, -v` — detailed logs
- P2  `--config` — config file path
- P2  `--dry-run` — preview without side effects
- P2  `TOOL_CONFIG` env var as config fallback
```

### Step 3 — Data flow diagram

ASCII sketch showing input → processing → output, including side effects:

```
[stdin / file / arg]
        │
        ▼
  ┌─────────────┐
  │  Parse input │
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │  Validate   │───Error──> stderr + exit 1
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │  Transform  │
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │  Write      │──> file / stdout
  └─────────────┘
         │
         ▼
  Exit 0
```

Show exit codes, side effects (file writes, network calls), and error paths.

### Step 4 — Error modes and edge cases

- **Missing input** — no args, no stdin, no file. Show usage?
- **Bad input** — parsing fails. Helpful error message?
- **File conflicts** — output file exists. Overwrite, skip, or error?
- **Permissions** — can't read input or write output?
- **Large input** — streaming vs loading entirely into memory?
- **SIGINT/SIGTERM** — graceful shutdown or cleanup?
- **Race conditions** — two instances running at once?
- **Exit codes** — what does 0, 1, 2+ mean?

### Step 5 — Open questions

- Platform — Windows only, cross-platform, WSL?
- Distribution — npm package, standalone binary, script to copy?
- Dependencies — what runtime/packages does the user need installed?
- Performance — what input size should it handle in under 1s?
- Testing — how do you test a CLI? Snapshot output? Fixture files?

---

## Backend/API Mode

Define the goal for a backend API, service, or data pipeline before implementing.

### Step 1 — Clarify (3-5 questions)

- What **resource** does this manage? (One noun: "grants", "users", "documents".)
- What are the **core operations**? (CRUD? Commands? Queries? Events?)
- Who/what are the **consumers**? (Web frontend, mobile app, other services, third-party?)
- What **consistency guarantees** are needed? (Strong? Eventual? Best-effort?)
- What **scale** is expected? (Requests per second, data volume, concurrent users.)

### Step 2 — Endpoint / operation inventory

Bullet list of every operation, annotated by priority:

- **P0** — core operations. Without these the API is useless. Ship-blocking.
- **P1** — important for real usage but has a manual workaround.
- **P2** — future iteration.

Example:
```
- P0  `GET /resources` — list with pagination, filtering
- P0  `POST /resources` — create
- P0  `GET /resources/:id` — read single
- P0  `PATCH /resources/:id` — partial update
- P1  `DELETE /resources/:id` — soft or hard delete
- P1  `POST /resources/:id/archive` — lifecycle action
- P2  `GET /resources/export` — bulk export CSV
- P2  Webhook events on create/update/delete
```

### Step 3 — Data model sketch

ASCII entity-relationship sketch showing the data model:

```
┌──────────────┐     ┌─────────────────┐
│  Resource    │     │  AuditEntry     │
├──────────────┤     ├─────────────────┤
│  id: UUID    │     │  id: UUID       │
│  name: str   │────>│  resourceId: FK │
│  status: enum│     │  action: str    │
│  created: ts │     │  userId: FK     │
│  updated: ts │     │  timestamp: ts  │
└──────────────┘     └─────────────────┘
       │
       │ 1:n
       ▼
┌──────────────┐
│  Version     │
├──────────────┤
│  id: UUID    │
│  data: JSON  │
│  created: ts │
└──────────────┘
```

Show primary entities, key fields, relationships, and cardinality.

### Step 4 — Failure modes

- **Auth failure** — unauthenticated request. 401 vs 403?
- **Validation error** — malformed body. Error format? Field-level errors?
- **Not found** — resource doesn't exist. 404, soft or hard?
- **Conflict** — version mismatch or duplicate. 409 with resolution hint?
- **Rate limit** — too many requests. 429 with Retry-After?
- **Internal error** — unexpected failure. Structured error response without leak?
- **Downstream failure** — database or service is down. Circuit breaker? Fallback?
- **Timeout** — operation exceeds limit. Async job pattern?
- **Payload size** — request/response too large. Streaming? Pagination?

### Step 5 — Open questions

- Auth — API key, JWT, session, OAuth? Who can call this?
- Data storage — relational, document, key-value, file storage?
- Pagination — cursor-based, offset, keyset?
- Versioning — URL prefix, header, or no versioning yet?
- Rate limiting — per-user, per-IP, per-endpoint?
- Logging/observability — structured logs, metrics, traces?
- Error format — consistent envelope (e.g., `{ error: { code, message, details } }`)?
- SDK/client — first-party client library, or just spec (OpenAPI)?

---

## Output Contract (All Modes)

- Produce a single Markdown block with all 5 steps, in order. Nothing else.
- Do **NOT** write any implementation code during goal definition.
- End with the open questions and wait for confirmation before proceeding.
- After the user confirms the goal definition, only then move to implementation.
- If the confirmed goal reveals a design surface, load `ui-craft` or `brief` for the design phase.

## When NOT to Define the Goal

- Trivial changes (single field, one-line fix, comment)
- The user explicitly says "just build it, no goal definition needed"
- Hotfix/emergency where speed matters more than discovery
