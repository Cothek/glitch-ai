---
name: handoff
description: "MUST use when user says 'handoff', 'continue this in another
             session', 'pass this to another agent', 'compact for handoff',
             or when the current conversation needs to be summarized so a
             fresh agent can pick up the work."
---

# Handoff

## Activation
When this skill activates, output:
"Activating handoff..."

## Purpose
Write a handoff document summarizing the current conversation so a fresh
agent can continue the work. The doc is an actionable next-agent brief,
not a transcript and not a memory dump. It complements Glitch's R3
compaction / `current-session.md` flow: compaction preserves memory,
handoff produces a doc the next agent can act on directly.

## Where to Save
Save the handoff document to the OS temp directory, NOT the current
workspace. Resolve the temp dir in this order:

1. `$TMPDIR` (Unix/macOS)
2. `/tmp` (Unix/macOS fallback)
3. `%TEMP%` (Windows)
4. `$env:TEMP` (PowerShell)

Filename: `handoff-<timestamp>.md` where `<timestamp>` is an
ISO-8601-style stamp like `2026-08-02T14-30-00` (colons replaced with
dashes for filesystem safety).

After writing, print the absolute path so the user can copy it into a
new session.

## Protocol

1. **Tailor to the next session.** If the user passed arguments (e.g.
   `handoff focus on the auth refactor`), treat them as a description
   of what the next session will focus on. Weight the doc toward that
   focus. If no arguments, write a general-purpose handoff.
2. **Scan the conversation for state.** Identify:
   - The goal / task being worked on
   - Decisions made and why
   - Open questions / blockers
   - Files touched (paths only, not contents)
   - Commands run that the next agent should know about
   - Errors hit and their resolutions
3. **Reference, don't duplicate.** Do NOT paste content already
   captured in other artifacts. Reference them by path or URL:
   - Specs, plans, ADRs → file path
   - Issues → URL or `owner/repo#123`
   - Commits → SHA or short SHA
   - Diffs → file path or `git diff <ref>` command
   - Memory files → `user/<file>.md`
4. **Redact sensitive info.** Before writing, scrub:
   - API keys, tokens, OAuth secrets
   - Passwords and connection strings with credentials
   - PII (emails, phone numbers, addresses) unless explicitly required
   - Internal hostnames / IPs that aren't already public
   Replace with `[REDACTED]` or a generic placeholder like
   `<API_KEY>`. If a secret is needed for the next session, note
   *which* secret is needed and where to find it (e.g. "Stripe test
   key in `data/secrets.json` under `stripe.test`"), never the value.
5. **Write the Suggested skills section.** This is the key
   differentiator. List the skills the next agent should invoke first,
   in priority order. Pick from the registry based on what the work
   actually needs. Common picks:
   - `wayfinder` — multi-session foggy work
   - `goal` — ambiguous or underspecified next steps
   - `work-plan` — known plan to resume
   - `debugging` — unresolved error
   - `breakthrough` — stuck on a hard problem
   - `code-review` — code changes pending review
   - `testing` — coverage gaps
   - `observation` — codebase health check
   - `session-briefing` — fresh context load
   One line per skill explaining *why* it's relevant to this handoff.
6. **Write the document.** Use the structure below.
7. **Print the path.** Output the absolute path of the saved file so
   the user can paste it into the next session.

## Document Structure

```markdown
# Handoff — <one-line summary>

**From session:** <date or session identifier>
**To next session focus:** <user's argument, or "general continuation">
**Saved at:** <absolute path>

## Goal
<What we're trying to accomplish. 1-3 sentences.>

## Current State
<Where we are right now. What's done, what's in progress, what's blocked.>

## Key Decisions
- <Decision 1> — <why>
- <Decision 2> — <why>

## Open Questions / Blockers
- <Question or blocker 1>
- <Question or blocker 2>

## Files Touched
- `<path>` — <what changed>
- `<path>` — <what changed>

## References (do not duplicate)
- Spec: `<path>`
- Plan: `<path>`
- ADR: `<path>`
- Issue: `<url>`
- Commits: `<sha>, <sha>`
- Memory: `user/<file>.md`

## Suggested Skills
The next agent should invoke these, in order:
1. **<skill-name>** — <why this skill is relevant>
2. **<skill-name>** — <why>
3. **<skill-name>** — <why>

## Next Steps
1. <Concrete next action>
2. <Concrete next action>
3. <Concrete next action>

## Notes for the Next Agent
<Anything that doesn't fit above — gotchas, context, things to watch out for.>
```

## Mandatory Rules

1. **Save to temp, not workspace.** Never write the handoff into the
   current project. It is a transient artifact for the next session,
   not a project file.
2. **Reference, don't duplicate.** If the content already lives in a
   spec, plan, ADR, commit, or memory file, link to it. Do not paste
   it. The handoff is a map, not the territory.
3. **Always include Suggested skills.** This is the core value-add.
   Without it, the handoff is just a summary. With it, the next agent
   has a clear starting protocol.
4. **Redact before writing.** Scrub secrets and PII in the same pass
   that produces the doc. Never write a draft and then "redact later."
5. **Tailor to the argument.** If the user said what the next session
   will focus on, the doc must reflect that focus. A general-purpose
   handoff is only acceptable when no argument was given.
6. **Print the absolute path.** The user needs to copy it. A relative
   path or "saved" without a path is a failure.
7. **Keep it scannable.** Use headers, bullets, short sentences. The
   next agent will read this cold with no prior context. Optimize for
   fast orientation, not completeness.

## Glitch Integration

This skill complements, does not replace, the existing memory flow:

- **R3 compaction** (`run-compaction.mjs`) — preserves memory across
  sessions by promoting scratchpad → updating timestamps → auto-commit.
  Output: `user/current-session.md`, `user/decisions.md`,
  `user/post-mortems.md`, etc. Audience: future Glitch sessions.
- **handoff** (this skill) — produces an actionable next-agent brief
  with suggested skills. Output: `handoff-<timestamp>.md` in OS temp.
  Audience: a specific fresh agent picking up *this* work.

Use **compaction** when ending a session normally. Use **handoff**
when branching to a fresh session, passing work to another agent, or
when the user explicitly asks for a handoff doc.

## Level History

- **Lv.1** — Base: handoff doc with suggested skills + redaction.
