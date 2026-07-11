---
name: auto-commit
description: "MUST use when user says 'commit', 'save changes', 'git commit',
             or when a task is completed and code needs to be preserved.
             Also triggers in Vigilant mode after any completed task."
---

# Auto-Commit

## Activation
When this skill activates, output:
"Committing changes to history..."

## Protocol

### Step 1: Analyze Changes
- [ ] Run `git status` to see uncommitted changes
- [ ] Run `git diff --staged` and `git diff` to understand what changed
- [ ] Identify which files were modified, added, or deleted
- [ ] Skip sensitive files (.env, credentials, API keys) — warn user if detected

### Step 2: Draft Structured Commit Message
Format:
```
[Feature/fix/refactor]: [Brief title] - [One-line summary]

=== TECHNICAL CHANGES ===
• [file]: [what changed]
• [file]: [what changed]

=== SESSION CONTEXT ===
• Project: [name] | Type: [feature/bugfix/refactor] | Time: ~XX min
• Focus: [what was accomplished]
```

Use **Enhanced** format for meaningful work, **Minimal** for trivial changes, **WIP** for incomplete saves.

### Step 3: Commit
- [ ] Stage relevant files (exclude sensitive files)
- [ ] Commit with the structured message
- [ ] Confirm commit hash and summary to user

### Step 4: Vigilant Mode
After completing any task, proactively check `git status`. If uncommitted changes exist, run the full commit protocol automatically.

## Mandatory Rules
1. Never commit sensitive files (.env, credentials, API keys)
2. Never push to remote without explicit user instruction
3. Always use structured commit messages — no "fix stuff" or "update files"
4. Author commits under the user's configured git name

## Level History
- **Lv.1** — Base: Structured commits with TECHNICAL CHANGES + SESSION CONTEXT sections.
