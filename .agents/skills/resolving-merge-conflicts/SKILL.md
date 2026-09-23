---
name: resolving-merge-conflicts
description: "MUST use when user says 'merge conflict', 'resolve conflict',
             'rebase conflict', 'conflicting files', or when an in-progress
             git merge or rebase has unresolved conflict markers."
---

# Resolving Merge Conflicts

## Activation
When this skill activates, output:
"Activating resolving-merge-conflicts..."

## Purpose
Work through an in-progress git merge or rebase conflict hunk by hunk,
resolving by intent traced to each side's primary source, then finish
the operation. NEVER `--abort`.

## Protocol
1. **See the current state of the merge/rebase.** Check git history and
   the conflicting files. Run `git status` to list unmerged paths, then
   read each conflicting file end-to-end so the surrounding context is
   understood before any hunk is touched.
2. **Find the primary sources for each conflict.** Understand deeply why
   each change was made and the original intent. Read commit messages,
   PRs, original issues/tickets. Trace each side back to the commit that
   introduced the change and read its full message and any linked
   discussion. The goal is to know *why* each side exists, not just
   *what* it does.
3. **Resolve each hunk.** Preserve both intents where possible. Where
   incompatible, pick the one matching the merge's stated goal and note
   the trade-off. Do NOT invent new behavior. Always resolve; never
   `--abort`. Remove every conflict marker (`<<<<<<<`, `=======`,
   `>>>>>>>`) and verify the resulting code is syntactically valid
   before moving to the next hunk.
4. **Discover the project's automated checks and run them.** Typically
   typecheck, then tests, then format. Fix anything the merge broke.
   Inspect `package.json` scripts, CI config, and any pre-commit hooks
   to find the canonical check sequence for the project.
5. **Finish the merge/rebase.** Stage everything and commit. If
   rebasing, continue the rebase process (`git rebase --continue`) until
   all commits are rebased. Verify the final tree with `git status` and
   `git log --oneline -5` to confirm the operation completed cleanly.

## Glitch Integration
This skill complements Glitch's existing discipline:

- **R16 Branch Discipline** — All core work happens on `develop` or
  feature branches, never directly on `main`. Merge conflicts most often
  arise when a `develop` → `main` promotion collides with a hotfix or
  another in-flight branch.
- **PM-014 Rule** — Before pushing any merge from `develop` to `main`,
  Glitch MUST ask Troy for confirmation first. When a merge conflict
  arises during a `develop` → `main` merge, resolve by intent using
  this skill, then ask Troy before completing the merge per PM-014.
- **R22 Mechanical Review Gate** — If the merge brings in unreviewed
  code from a sub-agent, the review gate still applies after the
  conflict is resolved. Do not let a merge bypass the quality gate.

When a conflict appears in a launch script, safe-mode script, or any
`.bat`/`.ps1`/`.sh`/`.mjs` file, the resolution MUST still go through
`@reviewer` before commit (per the 2026-07-29 directive). Resolve the
conflict, then dispatch the reviewer on the resolved result.

## Mandatory Rules
1. **Never `--abort`.** The merge or rebase must be completed. Aborting
   discards work and breaks the chain of intent. If a conflict truly
   cannot be resolved, escalate to Troy rather than aborting.
2. **Preserve both intents where possible.** When two changes can
   coexist, keep both. Only drop one side when the intents are
   genuinely incompatible, and document the trade-off in the merge
   commit message.
3. **Don't invent new behavior.** A merge resolution is not a feature
   change. If the resolution requires new logic, that is a separate
   commit on a separate branch, not part of the merge.
4. **Run automated checks before finishing.** Typecheck, tests, and
   format must pass on the resolved tree. A merge that breaks the
   build is not a successful merge.
5. **Trace intent to primary source.** Never resolve based on which
   side "looks right" in isolation. Always read the commit, PR, or
   issue that introduced each side before deciding.

## Level History
- **Lv.1** — Base: intent-traced hunk-by-hunk conflict resolution.
  Resolves by reading primary sources, preserves both intents where
  possible, runs automated checks, and finishes the operation without
  ever using `--abort`.
