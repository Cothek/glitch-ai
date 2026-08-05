---
name: research
description: "Investigate a question against high-trust primary sources and capture findings as a single cited Markdown file. Triggers: 'research', 'investigate', 'look up', 'find the facts', 'deep research', 'primary sources', 'compare X vs Y'. NOT for simple lookups, quick fact checks, or debugging."
---

# Research Skill

Investigate a question against high-trust primary sources. Produce a single cited Markdown report.

## Activation Decision Tree

Before activating, classify the question:

- **Simple lookup** (single fact, one source): do NOT activate this skill. Fetch directly with webfetch.
- **Quick mode**: 1-2 sub-questions, ~5 min, 3-5 sources.
- **Standard mode** (default): 3-6 sub-questions, 8-15 sources.
- **Deep mode** (conflicting public claims, safety or financial implications, or legal decisions): 6+ sub-questions, contradiction hunting, 15+ sources, explicit source tiering.

## The 7-Phase Pipeline

### P1 PLAN

Decompose the user's question into 2-6 non-overlapping sub-questions. Write them down before searching. Each sub-question should be independently answerable.

### P2 DIVERSE QUERIES

Generate 2-4 search queries per sub-question. Vary the approach: keyword, semantic, date-filtered, site-restricted. Adapt queries to evidence found so far. Never reuse the same query unchanged.

### P3 RETRIEVE

Parallel retrieval. Dispatch @general agents in parallel for web research, one per independent angle; use @explore for codebase-internal angles. Never research serially when angles are independent. Use webfetch for primary sources. Follow every claim back to the source that owns it: official docs, source code, specs, first-party APIs first. NOT blog summaries or Stack Overflow as primary.

### P4 EVALUATE SOURCES

Tier every source:

- **Tier 1**: official docs, source code, specs, first-party APIs, .gov/.edu institutional.
- **Tier 2**: reputable secondary (peer-reviewed, established outlets).
- **Tier 3**: blogs, forums, community.

Prefer Tier 1. Deduplicate. Flag conflicts between sources explicitly.

### P5 EVIDENCE BINDING

Every factual claim gets an inline citation (URL + quoted passage where possible). Never a bare bibliography as the only citation mechanism. Note confidence:

- **HIGH**: Tier 1, multiple corroborating sources.
- **MEDIUM**: single Tier 1 or multiple Tier 2.
- **LOW**: Tier 3, conflicting, or unverifiable.

### P6 SYNTHESIZE

Write a structured report that ANSWERS the original question. Not a concatenation of per-source summaries. Organize by sub-question. Resolve contradictions explicitly. State what is known vs uncertain.

### P7 VERIFY

Re-read the original request. Confirm every aspect was addressed, every claim has a citation, and limitations or uncertainty are stated. If something is unverifiable, SAY SO rather than guessing.

## Glitch Integration

Your primary job is coordination. Dispatch background sub-agents for retrieval and keep working in parallel. Use @general (free) for web research with @general-paid as fallback, @explore for codebase research, @vision for visual or image sources. Research feeds thinking, it does not replace it. Feeds the wayfinder skill (research tickets) and goal skill (facts before decisions).

Output: ONE cited Markdown file per research question. Save where the repo keeps such notes. Match existing convention. If none, choose a sensible path and say where.

## Mandatory Rules

1. **Primary sources first**: follow claims to the source that owns them.
2. **Cite every claim inline**: every factual statement gets a source link.
3. **NEVER invent citations, DOIs, URLs, or paper metadata**. If a source cannot be verified, state that it could not be verified.
4. **Parallel retrieval via sub-agents**: do not block serially when angles are independent.
5. **Honest uncertainty**: flag conflicting evidence, weak sources, and confidence levels. Uncertainty is always better than false confidence.
6. **Completion criterion**: findings file exists at the chosen path with at least one citation per claim.

## Anti-Patterns

1. **Flat searching**: one query, one search, done.
2. **Confirmation bias**: stopping at the first source that supports the answer.
3. **Single-source monoculture**: all cited sources derive from one upstream origin. Check source independence.
4. **Inventing citations**: guessing DOIs, URLs, or paper metadata to look complete.
5. **Self-confirming**: searching only for support, never for contradiction.
6. **Concatenating summaries**: per-source summaries instead of synthesizing an answer.
7. **No checkpointing**: long research loses work to context limits. Persist notes incrementally if research runs long.

## Output Contract

The final Markdown report must contain:

- The question and scope.
- Findings organized by sub-question with inline citations.
- A confidence and limitations note.
- A source list.
