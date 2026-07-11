---
name: work-plan
description: "MUST use when user says 'copy plan', 'append plan', 'resume plan',
             or when plan mode output needs to be converted to executable format."
---

# Work Plan Execution

## Activation
When this skill activates, output the appropriate message:
- Copy: "Copying plan to execution format..."
- Append: "Appending to existing plan..."
- Resume: "Resuming plan execution..."

## Protocol

### Copy Plan
1. Read the latest plan from `C:\Users\cothe\.claude\plans\` (Windows) or `~/.claude/plans/` (Unix)
2. Convert plan steps to checkbox format: `- [ ] Task description`
3. Preserve architecture diagrams and notes
4. Write to `Project Resources/project-plan.md`
5. Begin executing from the first `[ ]` item

### Append Plan
1. Read existing `Project Resources/project-plan.md`
2. Append new plan steps as checkboxes
3. Preserve existing progress (keep `[x]` items as-is)

### Resume Plan
1. Read `Project Resources/project-plan.md`
2. Count completed `[x]` vs pending `[ ]` items
3. Report progress: "N of M items done. Next: [task]"
4. Continue from the next `[ ]` item

## Execution Loop
For each `[ ]` todo item:
1. Execute the task
2. Mark `[x]` in the plan file
3. Checkpoint save every 5 items
4. Move to next `[ ]` item

## Progress States
| Symbol | Meaning |
|--------|---------|
| `[ ]` | Pending |
| `[x]` | Completed |
| `[~]` | Blocked |

## Level History
- **Lv.1** — Base: Plan capture, checkbox execution, resume after context reset.
