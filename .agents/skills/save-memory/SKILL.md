---
name: save-memory
description: "MUST use when @memory agent is dispatched for any memory write.
              Load this skill on activation.
              Provides the methodology for writing all Glitch memory files."
---

# Save Memory — @memory Agent Methodology

## Activation
Load this skill on activation. Follow the protocol below for every memory write.

## Mandatory First Action — Heartbeat (Always)

Before ANY write operation (even if the task seems trivial):

1. **Update `user/current-session.md`** — Set the `Last Memory Update` field to the current ISO timestamp: `YYYY-MM-DDTHH:mm:ssZ` (e.g., `2026-07-09T22:00:00Z`)
2. **Update the target file's YAML frontmatter** — Set the `timestamp` field to the current date: `YYYY-MM-DDT00:00:00Z`
3. **Do NOT skip** this step even if you think timestamps are recent. This is the heartbeat that prevents stale-session gaps. Every dispatch keeps the system alive.
4. **Exception**: If `current-session.md` itself is the target file, you only need to update the frontmatter timestamp (the Last Memory Update line is being written as part of the content update).

**Format for timestamp updates:**
- `Last Memory Update` in current-session.md: `YYYY-MM-DDTHH:mm:ssZ` (with hours/minutes)
- Frontmatter `timestamp` in all files: `YYYY-MM-DDT00:00:00Z` (date only, consistent with existing format)

**Rationale**: Without this, memory timestamps only get updated when Glitch explicitly remembers to do it during compaction. This leads to files showing 22-day-old timestamps even during active sessions. By making timestamp updates mandatory on every @memory dispatch, timestamps stay current naturally.

## Scope
You write files in `user/*.md` only. You do NOT:
- Run git commands (Glitch handles this)
- Write code or config files
- Delete files unless explicitly instructed
- Modify YAML frontmatter — EXCEPT you MUST update `timestamp` as part of the Heartbeat (see Mandatory First Action above)

## File Map (What Goes Where)

| Trigger | Target File | Action |
|---------|-------------|--------|
| User expresses a preference | `user/main-memory.md` → User Profile section | Append new section under **Preferences** |
| A decision is made | `user/decisions.md` | Append new entry (date + category + decision + rationale + implications) |
| Something breaks or an error is fixed | `user/post-mortems.md` | Append new PM-NNN entry |
| A follow-up is needed | `user/reminders.md` | Append new reminder with date |
| A project progresses | `user/projects/project-list.md` | Update existing entry or add new |
| Workstream status changes | `user/session-dashboard.md` | Update the matching workstream row |
| A session is substantial | `user/daily-diary/current/YYYY-MM-DD.md` | Append diary section |
| Pattern discovered (2+ occurrences) | `user/patterns.md` | Append new pattern entry |
| Repeated workflow (3x+) | `user/forge-log.md` | Append forge entry |
| Scratchpad accumulation | `user/current-session.md` → Working Memory | Append scratchpad bullet |

## Append Format Per File

### decisions.md
```
## YYYY-MM-DD — Title of Decision
_Category: CATEGORY_NAME_

**Decision**: [one-sentence decision]

**Rationale**: [why this decision was made]

**Implications**: [what this means going forward]
```

### post-mortems.md
```
## PM-NNN: Title
_Category: KNOWN_ISSUES_

**Incident**: [what happened]

**Root cause**: [why it happened]

**Fix**: [what was done to fix it]

**Prevention**: [how to prevent recurrence]
```

### reminders.md
Use the existing frontmatter format. Append under `## Open` with:
```
### YYYY-MM-DD — Title
_Category: CATEGORY_NAME_
[Description]
```

### main-memory.md
Do NOT overwrite. Find the appropriate section (Troy Profile, Preferences, etc.) and append a new bullet or subsection.

### current-session.md
- **Session Recap**: Append a new `## Session Recap (YYYY-MM-DD)` section at the top of the file if none exists for today, or add bullet points to today's section.
- **Working Memory (Scratchpad)**: Append `### Scratchpad (Real-time)` or add to it with bullet points prefixed by type (`#### 🔧 FAILURE`, `#### 🔧 OPERATIONAL`, `#### 🔧 PATTERN`, `#### 🔧 FALLBACK`, `#### 🔧 DIRECTIVE`, `#### 🔧 FIX`).
- **Last Memory Update**: Update the timestamp at the top.

### patterns.md
```
## YYYY-MM-DD — Pattern Title
_Category: WORKFLOW_RULES_ (or appropriate category)

[Description of the pattern]

**Frequency**: N occurrences
**Filed as**: skill, rule, or preference
```

### forge-log.md
```
## YYYY-MM-DD — Entry
[Description]
```

## Format Rules
1. **Timestamp format**: `YYYY-MM-DD` for dates, `YYYY-MM-DDT00:00:00Z` for ISO timestamps
2. **Category tags**: Use `_Category: NAME_` on the line after the heading. Valid values:
   - `ARCHITECTURE_DECISIONS` — design decisions
   - `CONSTRAINTS` — limitations or requirements
   - `CONFIG_DEFAULTS` — configuration choices
   - `NAMING` — naming conventions
   - `USER_PREFERENCES` — Troy's preferences
   - `USER_DIRECTIVES` — hard rules Troy set
   - `ENVIRONMENT` — environment/OS specifics
   - `WORKFLOW_RULES` — operational patterns
   - `KNOWN_ISSUES` — bugs and failures
3. **Append, don't overwrite** — never modify or remove existing entries
4. **Timestamp everything** — every entry gets a date
5. **Preserve YAML frontmatter** — do not remove or modify the `---\n...\n---` block at the top of files
6. **Update `timestamp` field** in YAML frontmatter to current date when appending

## Entry Hierarchy
- Files use Markdown headings: `##` for dated entries, `###` for subsections under entries
- Within entries, use bold labels (`**Decision:**`, `**Rationale:**`)
- Bullet lists for implications, steps, or options

## Session Dashboard Format
Find the matching workstream in `## Active Workstreams` and update its Status, Progress, or Next Step cell. The table format is:
```
| Status | Progress | Next Step |
|--------|----------|-----------|
```
Use checkmark (✅) for completed, 🔲 for pending, or other emoji for in-progress.

## What NOT to Do
- Do not run git add/commit/push — Glitch handles this
- Do not edit files outside `user/`
- Do not delete content from files
- Do not change YAML frontmatter `type` or `title` fields
- Do not add entries without a date
- Note: `user/` is a separate nested git repo (`Cothek/glitch-user-troy`). When you write to `user/*.md`, Glitch commits in both the parent repo and the user repo. You don't need to do anything special.
- Note: Your permission block denies `edit`. You can only `write` (overwrites the file) and `read`. When appending, read the file first, then write the combined content.
