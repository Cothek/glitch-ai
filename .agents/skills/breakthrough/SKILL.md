---
name: breakthrough
description: "Use when you're stuck on a hard problem — debugging isn't working,
  approaches have failed, root cause is unclear, or you've been going in circles.
  Helps reframe the problem, check assumptions, research more deeply,
  and find creative solutions. NOT for routine debugging — use the debugging skill for that."
---

# Breakthrough — Overcome Hard Problems

## Activation
When this skill activates, output:
"Running breakthrough protocol — stepping back to find a new angle..."

## When NOT to Use
Skip this skill if:
- The problem is a standard bug with a clear reproduction path (use `debugging` skill)
- The issue is a lack of domain knowledge (use websearch or documentation)
- The problem just needs more time on the same approach

Use it when: you've tried multiple approaches, nothing worked, and you need to think differently.

---

## Phase 0: Name the Wall

State clearly in one sentence each:
1. What am I trying to achieve?
2. What's blocking me right now?
3. What have I tried so far (and what did each attempt teach)?

If you can't clearly state all three, the problem isn't defined well enough yet. Go research first.

---

## Phase 1: Check Assumptions (Most Common Trap)

List everything you're assuming that might be wrong. Include:

- **Layer assumptions**: "The bug is in the frontend" — have you verified the backend isn't sending wrong data?
- **Trust assumptions**: "Library X works correctly" — have you verified with a minimal reproduction?
- **Data assumptions**: "The input is always valid" — what if it's undefined, null, or the wrong type?
- **Timing assumptions**: "This runs after that" — have you checked the actual execution order?
- **API assumptions**: "This function returns what I think" — have you checked the return type/signature?
- **Environment assumptions**: "It works on my machine" — what's different about the target environment?
- **Change assumptions**: "The last change was unrelated" — have you checked git blame on the failing area?

For each assumption, ask: **"What if this is WRONG?"** Then trace what would happen.

---

## Phase 2: Reduce to Minimum

Strip the problem to the absolute simplest case:

1. **Reproduce in isolation** — Can you recreate the problem with 5 lines of code?
2. **Remove everything non-essential** — Comment out half the code. Does it still happen? Binary search.
3. **Test components independently** — Test each function/module in isolation to determine which one is actually failing.
4. **Change one variable at a time** — If you changed 3 things, revert 2 and test each individually.
5. **Use known-good inputs** — If the problem involves data, test with the simplest possible valid input.

> "If I can't reproduce this in a minimal test, I don't understand the root cause yet."

---

## Phase 3: Research

Expand your knowledge base:

1. **Search for the exact error message** — Error messages exist because other people hit them. Search in:
   - GitHub issues of the relevant project
   - Stack Overflow / forums
   - The project's documentation and changelog
   - Your own codebase's git history (git log -p --all -S"error message text")

2. **Check what changed** — If something that was working broke:
   - `git log --oneline -20` to see recent commits
   - `git diff <known-good-commit>..HEAD` to see all changes
   - Check dependency changes in package.json

3. **Search the codebase** — Use grep/search for similar patterns, existing solutions, or related error handling

4. **Check the fundamentals** — Sometimes the issue is a basic misunderstanding:
   - Re-read the docs for the API/library you're using
   - Check the TypeScript type definitions
   - Verify the actual runtime values, not just the types

---

## Phase 4: Reframe the Problem

Describe the problem in THREE different ways:

| Frame | Question | Example |
|-------|----------|---------|
| **Technical** | What's happening at the code/machine level? | "The API returns 403 on this route even though the user has the admin role" |
| **User-facing** | What does someone actually experience? | "When an admin opens the settings page, they see 'Access Denied' instead of the edit form" |
| **Metaphorical** | What's this like in another domain? | "It's like having the right key but the lock won't turn — either the key doesn't match the lock, or the lock is broken" |

After reframing, ask:
- What if I try the OPPOSITE of what I've been doing?
  - If I added code, what if I remove it?
  - If I optimized, what if I try the brute force approach?
  - If I used library X, what if I do it without it?
- What if the PROBLEM STATEMENT itself is wrong? (e.g., "it doesn't work" → what specifically doesn't work?)
- What would this look like to someone with fresh eyes?

---

## Phase 5: Worst Idea First

Generate the worst/ugliest possible solution:

1. What's the most hacky, ugly, embarrassing fix?
2. Would it work? (Even partially?)
3. What does its failure teach you?

Sometimes the hack teaches you WHY it can't work that way — which is the real insight. And sometimes the hack IS the working path, and you can clean it up once you know it works.

---

## Phase 6: Externalize

Get the problem out of your head:

1. **Write it out** — Type the full explanation. The act of writing forces clarity.
2. **Draw it** — Sketch the data flow, component tree, or state machine. Visual layouts expose gaps.
3. **Explain it to someone** (rubber duck) — State each step out loud. The contradiction often appears mid-sentence.
4. **Reduce to one question** — If you had to ask for help, what's the single question you'd ask? If you can't formulate it, you haven't isolated the issue.

---

## If Still Stuck: Escalate

Document the following so you can get help (from a teammate, or as a future reference):

```
## Stuck Report

### Attempted
1. [approach] → [what it taught]
2. [approach] → [what it taught]
3. [approach] → [what it taught]

### What Remains Unknown
- [what you still don't understand]

### Smallest Next Experiment
[one concrete thing to try that would teach something new, even if it doesn't fix it]

### Ideal State
[what working looks like]
```

Then do the smallest next experiment. Even if it fails, it teaches you something.
