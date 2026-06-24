---
name: brainstorming
description: "Idea generation and concept development through structured phases with active sparring. Use when exploring possibilities, generating options, or developing a concept from vague to concrete."
---

# Brainstorming — Idea Generation & Concept Development

## My Role

I'm not just a facilitator — I actively contribute:
- **Sparring partner** — I'll push back on weak spots
- **Idea generator** — I'll contribute my own concepts, analogies, and angles
- **Connector** — I'll link to relevant projects, past decisions, and library entries in your memory
- **Devil's advocate** — I'll stress-test ideas so we catch flaws early
- **Builder** — if a concrete plan emerges, I can help execute it

## Step 0 — Detect Brainstorm Mode

Before diving in, determine what kind of thinking this needs. Infer from context, or ask if ambiguous:

| If we're doing... | Emphasis |
|-|-|
| **Feature ideation** — new capabilities, product ideas | SCAMPER heavy. Analogous thinking. Free association. |
| **Problem solving** — something's broken or stuck | Root cause first. Constraint inversion. Worst idea first. |
| **Design exploration** — UI, UX, visual approach | Analogous thinking. Free association. Worst idea first. |
| **Strategy / planning** — direction, trade-offs, priorities | Constraint inversion. SCAMPER (substitute, eliminate, rearrange). |
| **Naming / positioning** — brand, feature, product names | Free association. Analogous thinking. Constraint inversion. |

If it doesn't fit a category neatly, blend techniques from 2-3 modes.

---

## Phase 1 — Frame the Problem

Ask as many questions as needed to fully understand the scope before generating ideas. Default starter sets per mode:

**Feature ideation:**
- What are we trying to enable or improve?
- Who's the target user? What's their pain point?
- What existing solution are we replacing or competing with?
- What's the **"why now"** — what changed to make this worth exploring?
- What's off-limits — constraints, brand boundaries, technical debt limits?

**Problem solving:**
- What exactly is failing? What are the symptoms?
- When did it start? What changed before it broke?
- What have we already tried? Why didn't it work?
- What would "fixed" look like — what's the observable outcome?
- Who's affected and how urgently does this need solving?

**Design exploration:**
- What's the design goal — emotional response, clarity, conversion, delight?
- Who's the audience and what context are they in (device, environment, time)?
- References or inspirations — what designs do we admire in this space?
- Technical constraints — what's the stack, what libraries are we locked into?

**Strategy / planning:**
- What's the decision we're trying to make?
- What options are already on the table?
- What's the timeline and what's at stake?
- Who needs to align on this — any stakeholders not in this conversation?

---

## Phase 2 — Diverge (Generate)

Pick 2-3 techniques based on the mode from Step 0. Don't use all of them — each session picks the ones most likely to spark something.

**SCAMPER** (great for features and products)
- **S**ubstitute — what can we replace? Different material, platform, approach?
- **C**ombine — what can we merge? Two features, two roles, two flows?
- **A**dapt — what else is like this? How do competitors or adjacent industries solve it?
- **M**odify — what can we change? Size, timing, sequence, audience?
- **P**ut to other use — who else could use this? Different persona, different context?
- **E**liminate — what can we remove? What happens if we cut the least essential piece?
- **R**earrange — what if we flipped the order? Reverse the flow, swap input and output?

**Free association** — throw out ideas without judgment, build on each other's ("yes, and...")
- I'll contribute ideas alongside yours
- No idea is too rough — we polish later

**Constraint inversion** — force different thinking by flipping a constraint
- "What if we had unlimited budget?" then "What if we had zero?"
- "What if we had to solve this in 1 hour?" — what's the simplest viable version?
- "What if the user was an expert?" then "What if they were a complete beginner?"

**Analogous thinking** — how do other domains solve this?
- Games, biology, architecture, sports, nature, finance, military
- "What would a restaurant do?" "How would NASA approach this?"

**Worst idea first** — deliberately propose bad ideas to unlock the good ones
- Gets the obvious bad stuff out of the way
- Often reveals constraints you didn't know you had
- Sometimes the "worst" idea has a kernel worth keeping

### Divergence Rules (Mandatory)
1. No criticism during divergence. Every idea gets written down.
2. Build on each other's ideas ("yes, and...") — don't shut them down
3. Capture everything, even rejected ideas — they might spark something later
4. If we go too abstract, pull back with "what does this look like in practice?"

---

## Phase 3 — Converge (Filter & Prioritize)

1. **Group** related ideas into clusters
2. **Pick 2-3 most promising** clusters to explore further
3. **Hybridize** — what if we combined elements from different clusters?
4. **Evaluate each against constraints** from Phase 1
5. **Rank** by a simple framework:

| Idea | Impact (1-5) | Effort (1-5) | Confidence (1-5) | Score |
|-----|-------------|-------------|-----------------|-------|
| A | 4 | 3 | 4 | 5.3 |
| B | 5 | 4 | 3 | 3.8 |

Score = Impact x Confidence / Effort. High score = high impact, high confidence, low effort — do first.

6. **Devil's advocate** — for the top 1-2, I'll stress-test: "What would break this? What are we assuming that might not hold?"

---

## Phase 4 — Commit

1. **Name the winner**: "Winner: [clear description of the chosen direction]"
2. **Define the next step**: What's the first concrete action? The smallest thing we can do to validate this?
3. **Identify the biggest risk**: What's most likely to fail? What do we not know yet?
4. **Capture runners-up**: Saved for later — don't lose them.

### Bridge to Goal

If the winner is concrete enough to build, the natural next step is to run the **`goal` skill** to lock it in with full scope, priorities, and open questions. Brainstorming finds the direction — goal defines it.

If the winner is still vague, loop back to Phase 2 with different techniques.

---

## Output Contract

Produce a single Markdown block with:

```
## Brainstorm Session

**Mode:** [feature / problem / design / strategy]

**Winner:** [chosen direction]
**Score:** [impact x confidence / effort]

**First step:** [smallest actionable thing]
**Biggest risk:** [what could break this]

**Runners-up:** [captured for later]

**Next:** run `goal` to lock this in → [or loop back to diverge]
```

Nothing else. Do NOT write code or start implementation during brainstorming.

---

## When NOT to Brainstorm

- Well-understood problem with an obvious solution — just build it
- Trivial decision with low stakes — pick one and move on
- The user explicitly says "no brainstorming, let's just go"
- Emergency / hotfix where speed matters more than exploration
