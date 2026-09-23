---
name: wayfinder
description: "MUST use when user says 'wayfinder', 'too big for one session', 'foggy', 'map this huge work', 'plan a large effort', or when the work is too large or unclear for a single agent session and needs to be broken into a map of decision tickets resolved across sessions."
---

# Wayfinder

## Activation
When this skill activates, output:
"Activating wayfinder..."

## Overview

Wayfinder plans a huge chunk of work, more than one agent session can hold, as a shared map of DECISION tickets. Each ticket resolves one decision. The map is done when nothing is left to decide.

Wayfinder is planning, not doing. It produces decisions, not deliverables. When the map clears, hand off to the **work-plan** skill for execution.

Adapted from Matt Pocock's Wayfinder (MIT licensed, github.com/mattpocock/skills).

## Storage Layout

All artifacts live under `<project>/.scratch/<feature-slug>/`:

```
.scratch/<feature-slug>/
  map.md                  # The map (single source of truth)
  issues/
    01-<slug>.md          # One ticket per decision (blockers first)
    02-<slug>.md
    ...
```

- `<feature-slug>`: kebab-case name derived from the destination (e.g., `auth-migration`)
- Ticket numbers: assigned in dependency order, blockers first (01, 02, ...)
- Blocking edges: expressed as a `Blocked by:` line in each ticket file

## Map File Template (`map.md`)

```markdown
# Map: <Destination>

## Destination
<One sentence naming the destination. Fixes scope for everything below.>

## Notes
- **Domain**: <what domain this lives in>
- **Skills to consult**: <list any skills every session should load>
- **Standing preferences**: <anything the user has said that applies globally>

## Decisions so far
<One line per closed ticket: `- [NN-<slug>] <gist of resolution>`>

## Not yet specified
<Fog of war. Decisions that exist but are not sharp enough to state precisely.
Graduate into tickets as the frontier advances.
Test: "can you state the question precisely NOW", not "can you answer it NOW".>

## Out of scope
<Work beyond the destination. Never graduates into tickets.>
```

## Ticket File Template (`issues/<NN>-<slug>.md`)

```markdown
# <NN>. <Ticket Name>

**Type**: research | prototype | grilling | task
**Status**: open | claimed | closed
**Claimed by**: <blank until claimed>
**Blocked by**: <list of ticket numbers/titles, or "None — can start immediately">

## Question
<The decision or investigation, sized to one session.>

## Resolution
<Filled on close. One paragraph max.>
```

## Ticket Types

| Type | Mode | Description |
|------|------|-------------|
| **research** | AFK | Agent resolves alone via subagent (@explore or @general) against primary sources. May resolve multiple per session. |
| **prototype** | HITL | Make a cheap concrete artifact to react to. Capture the answer it produces. |
| **grilling** | HITL | One-question-at-a-time interview with the user. Use the **goal** skill's questioning loop. |
| **task** | HITL | Manual work that must happen before a decision can be made. |

## The Frontier

The **frontier** = all tickets that are:
1. **Open** (not closed)
2. **Unblocked** (no unresolved blockers)
3. **Unclaimed** (no "Claimed by" line)

These are the tickets available for the next session to work on.

## Mandatory Rules

1. **Name the destination first.** It fixes scope. If the user cannot state it, grill them until they can (use the goal skill).
2. **Refer to tickets by name, never bare ID.** Say "Auth Strategy", not "03".
3. **Never resolve more than one ticket per session.** Research tickets are excepted (they may batch).
4. **Claim before working.** Add `Claimed by: Glitch` + date to the ticket file before any investigation begins.
5. **Record resolution on close.** Fill the `## Resolution` section, set Status to `closed`, then append a one-line gist to the map's `## Decisions so far`.
6. **Graduate fog as the frontier advances.** When a "Not yet specified" item becomes precise enough to state as a question, create a ticket file for it and wire its blocking edges.
7. **Out-of-scope items get closed, not resolved.** If something is ruled out, close the ticket with a note in Resolution explaining why, but do NOT add it to "Decisions so far".
8. **Newly-surfaced tickets: create then wire.** Create the ticket file first, then update blocking edges in a second pass.
9. **Charting is one session's work.** Do not spread map creation across multiple sessions.

## Invocation: Chart the Map

Use when the user says "wayfinder", "map this huge work", "plan a large effort", etc.

1. **Name the destination.** If the user cannot state it precisely, grill them one question at a time (load the goal skill). Do not proceed until the destination is fixed.
2. **Map the frontier breadth-first.** Starting from the destination, identify the first wave of decisions that need resolving. Then the next wave. Continue until you hit fog (things you cannot yet state precisely).
3. **If no fog surfaces, stop.** Tell the user: "You don't need a map. This fits in one session." and exit the skill.
4. **Create the map file.** Write `map.md` with the destination, notes, and initial structure.
5. **Create tickets you can specify now.** One file per decision in `issues/`. Number in dependency order (blockers first).
6. **Wire blocking edges in a second pass.** Go through each ticket and fill in the `Blocked by:` line based on the dependency graph.
7. **Stop.** Charting is one session's work. Do not start resolving tickets during charting.

## Invocation: Work Through the Map

Use when a map already exists and the user wants to continue making progress.

1. **Load the map.** Read `map.md` for a low-res view (destination, decisions so far, fog, out of scope). Do NOT read every ticket body unless needed.
2. **Choose a ticket.** If the user names one, use that. Otherwise, pick the first frontier ticket (open + unblocked + unclaimed).
3. **Claim it first.** Add `Claimed by: Glitch` + today's date to the ticket file. Set Status to `claimed`.
4. **Resolve it.**
   - **research**: Dispatch @explore or @general to investigate against primary sources. May resolve multiple research tickets per session.
   - **prototype**: Build a throwaway artifact, capture the answer it produces.
   - **grilling**: Load the goal skill. Ask one question at a time until the decision is clear.
   - **task**: Do the manual work, then record what you learned.
5. **Record resolution.** Fill `## Resolution` in the ticket file. Set Status to `closed`. Append a one-line gist to `## Decisions so far` in `map.md`.
6. **Graduate fog.** Check if any "Not yet specified" items are now precise enough to become tickets. If so, create them and wire blocking edges.
7. **Add new tickets if surfaced.** If the resolution revealed new decisions, create ticket files for them and wire edges.
8. **Expect concurrent edits.** The user may run unblocked tickets in parallel sessions. The map file is the coordination point.

## Handoff

When the map clears (no open tickets remain, fog is empty or all fog items are out of scope):
- Tell the user the map is complete.
- Summarize all decisions from `## Decisions so far`.
- Hand off to the **work-plan** skill for execution planning.

## Level History
- **Lv.1** — Base: Local-markdown map + decision tickets. File-based tracking with blocking edges, frontier computation, fog graduation, and Glitch subagent integration for research/prototype/grilling/task ticket types.
