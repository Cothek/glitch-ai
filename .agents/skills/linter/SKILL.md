# Linter - AI Slop Detector

Run a deterministic checklist against any text (drafts, docs, PR descriptions, error messages, comments, commit messages) to flag AI slop patterns. Verification skill, not a generation skill.

## When to Use

- "lint this", "check this for slop", "verify writing", "run linter", "analyze text quality"
- Before publishing docs, README updates, or PR descriptions
- Before committing docs, before publishing
- When reviewing AI-generated drafts for telltales
- When auditing existing documentation for accumulated AI patterns

## What It Checks

The linter runs 13 categories. Each category has a specific pattern, a flag rule, and a fix.

### 1. Long Sentences
- **Descriptive text**: flag if >25 words
- **Instructional text** (steps, how-tos): flag if >20 words
- **Fix**: split into two sentences. Use a period, not a comma.

### 2. Semicolons
- **Flag**: any semicolon (`;`) outside code blocks
- **Why**: STE bans entirely. Semicolons signal "trying to sound smart."
- **Fix**: split into two sentences, or use a period.

### 3. Contractions
- **Flag**: missing contractions in casual prose ("do not", "is not", "will not", "cannot", "it is", "you are")
- **Note**: STE bans contractions. Troy allows them. Flag as **"Troy preference: use contractions"** not as a violation.
- **Fix**: use "don't", "isn't", "won't", "can't", "it's", "you're".

### 4. Passive Voice with Known Actor
- **Flag**: "X is VERBed by Y" where Y is named
- **Examples**:
  - "The file is read by the parser" -> "The parser reads the file"
  - "The config was loaded by the bootstrap script" -> "The bootstrap script loaded the config"
- **Exception**: passive is fine when the actor is unknown or irrelevant ("The file was deleted").

### 5. -ing Main Verbs
- **Flag**: progressive tense as the main verb ("is reading", "is writing", "is processing")
- **Fix**: use simple present ("reads", "writes", "processes").
- **Exception**: ongoing action that simple present can't express ("While the system is running...").

### 6. Nominalizations
- **Flag**: noun forms of verbs where the verb is clearer
- **Common offenders**:
  - "perform an analysis of" -> "analyze"
  - "configuration of" -> "configure"
  - "implementation of" -> "implement"
  - "make a decision" -> "decide"
  - "provide assistance" -> "help"
  - "conduct a review" -> "review"
  - "take into consideration" -> "consider"
  - "give an explanation" -> "explain"

### 7. Phrasal Verbs
- **Flag**: vague phrasal verbs that hide the actual action
- **Banned list**:
  - "spin up" -> "start" or "launch"
  - "reach out" -> "contact" or "email"
  - "dive into" -> "examine" or "start"
  - "kick off" -> "start" or "begin"
  - "roll out" -> "release" or "deploy"
  - "tear down" -> "stop" or "remove"
  - "ramp up" -> "increase" or "scale"
  - "circle back" -> "revisit" or "follow up"
  - "drill down" -> "examine" or "investigate"

### 8. Banned Words (Corporate/Academic)
- **Flag**: any of these words or phrases
- **List**:
  - begin / commence / initiate -> start
  - utilize / leverage / facilitate / ensure -> use / help / make sure
  - prior to / subsequent to -> before / after
  - obtain / acquire -> get
  - demonstrate -> show
  - additionally / furthermore / moreover -> also (or cut entirely)
  - comprehensive -> complete or full (or cut)
  - utilization -> use
  - aforementioned -> (name it again or use "this")
  - henceforth -> from now on
  - therein -> there
  - whilst -> while
  - amongst -> among
  - numerous / myriad / plethora -> many
  - in order to -> to
  - a variety of -> various (or list them)
  - in the event that -> if
  - due to the fact that -> because

### 9. Marketing Adjectives
- **Flag**: any of these empty adjectives
- **List**:
  - seamless, robust, powerful, cutting-edge, effortless
  - world-class, next-generation, revolutionary
  - blazing, lightning-fast, elegant, delightful
  - turnkey, best-in-class, state-of-the-art
  - game-changing, first-class, battle-tested, enterprise-grade
  - supercharge, unlock, unleash, empower
- **Fix**: describe what actually makes it good with a number or concrete detail.

### 10. Modal Hedges
- **Flag**: phrases that hedge without adding meaning
- **List**:
  - "it is important to note"
  - "it should be noted"
  - "it is worth noting"
  - "please note that"
  - "as mentioned"
  - "as noted above"
- **Fix**: cut the phrase. Just say the thing.

### 11. Long Paragraphs
- **Flag**: any paragraph with >6 sentences
- **Fix**: split at a natural break. Use a heading or bullet list if the content is list-like.

### 12. Em Dashes
- **Flag**: em dash characters (`—`, `--`, `–`) outside code blocks
- **Note**: Troy's preference. Use commas, colons, or periods instead.
- **Exception**: code comments or technical docs where the style guide requires them.

### 13. Terminology Inconsistency
- **Flag**: same concept referred to by different names within the same document
- **Detection**: harder to auto-detect. Flag for manual review if you notice drift.
- **Examples**:
  - "user" vs "customer" vs "account holder" in the same doc
  - "API key" vs "auth token" vs "secret" for the same thing
  - "config" vs "configuration" vs "settings" mixed
- **Fix**: pick one term, use it consistently. Add a glossary if needed.

## How to Run

### Step 1: Gather the Text
Identify the text to lint. It can be:
- A file path (read it)
- Pasted text in the conversation
- A draft you're about to send

### Step 2: Count Baseline Metrics
- **Words**: total word count
- **Sentences**: count by splitting on `.`, `!`, `?` (ignore code blocks)
- **Paragraphs**: count by splitting on blank lines

### Step 3: Run Each Category
Go through categories 1-13 in order. For each category:
1. Scan the text for matches
2. Record the count
3. Capture 1-3 representative examples (quote the exact phrase)

### Step 4: Score
Calculate violations per 100 words:
```
score = (total_violations / word_count) * 100
```

### Step 5: Build the Report
Use the output format below. Include the violations table and a summary.

### Step 6: Suggest Top 3 Fixes
Identify the 3 categories with the highest counts. Suggest concrete fixes for each.

## Output Format

```markdown
## Lint Report
**Words:** X | **Sentences:** Y | **Paragraphs:** Z | **Violations:** N | **Per 100 words:** N.NN

| Category | Count | Examples |
|---|---|---|
| Long sentence (>25w) | 3 | "This sentence is way too long and contains too many ideas that should be split..." |
| Semicolon | 1 | "First idea; second idea" |
| Passive voice | 2 | "The file is read by the parser" |
| -ing main verb | 1 | "The system is processing requests" |
| Nominalization | 2 | "perform an analysis of", "make a decision" |
| Phrasal verb | 1 | "spin up the server" |
| Banned word | 4 | "utilize", "leverage", "commence", "in order to" |
| Marketing adjective | 2 | "seamless", "robust" |
| Modal hedge | 1 | "It is important to note that..." |
| Long paragraph (>6 sentences) | 0 | — |
| Em dash | 3 | "word — another", "word -- another" |
| Contraction missing (Troy pref) | 5 | "do not", "is not", "will not" |

**Summary:** [One paragraph: overall slop level + top 3 fixes]

**Top 3 fixes:**
1. [Category with highest count]: [concrete fix]
2. [Second highest]: [concrete fix]
3. [Third highest]: [concrete fix]
```

## Scoring Reference

Based on STE linter heuristics:

| Score (per 100 words) | Assessment |
|---|---|
| 0.0 - 0.5 | Clean. Ship it. |
| 0.5 - 1.5 | Minor slop. Worth a quick pass. |
| 1.5 - 3.0 | Noticeable slop. Needs editing. |
| 3.0 - 5.0 | Heavy slop. Likely AI-generated without review. |
| 5.0+ | Severe slop. Rewrite from scratch. |

## Automated Tool (Optional)

If Python and `ste-lint.py` are available, run for automated scoring:

```bash
python3 ste-lint.py path/to/file.md
```

The Python tool automates categories 1, 2, 4, 5, 6, 7, 8, 9, 10. It does NOT check:
- Em dashes (Troy-specific)
- Contractions (Troy preference, opposite of STE)
- Long paragraphs
- Terminology inconsistency

Use the manual checklist for the gaps the Python tool misses.

## Example Run

**Input text:**
> "It is important to note that our seamless platform leverages cutting-edge technology to facilitate the configuration of your account. Prior to commencing the process, please ensure that you have obtained your API key. The configuration is performed by the system in order to provide a robust experience. Furthermore, our team will reach out to you subsequent to the initialization phase. The system is processing your request — please do not refresh the page."

**Lint Report:**
```
Words: 72 | Sentences: 5 | Paragraphs: 1 | Violations: 17 | Per 100 words: 23.61

| Category | Count | Examples |
|---|---|---|
| Modal hedge | 1 | "It is important to note that" |
| Marketing adjective | 3 | "seamless", "cutting-edge", "robust" |
| Banned word | 7 | "leverages", "facilitate", "prior to", "commencing", "in order to", "subsequent to", "obtained" |
| Nominalization | 1 | "configuration of" |
| Passive voice | 1 | "configuration is performed by the system" |
| -ing main verb | 1 | "is processing" |
| Phrasal verb | 1 | "reach out" |
| Em dash | 1 | "request — please" |
| Contraction missing | 1 | "do not" |

Summary: Severe slop (23.61 per 100 words). This reads as unedited AI output. Top fixes: (1) cut all marketing adjectives and replace with concrete details, (2) remove modal hedges and banned words, (3) convert passive to active voice.
```

## Notes

- This skill is a **checker**, not a generator. It does not write or rewrite text. It flags issues for the human (or the writing skill) to fix.
- For prevention (rules to follow when writing), see the writing skill.
- Run it before publishing any AI-assisted draft.
- The categories overlap. A single phrase can trigger multiple flags (e.g., "leverage" is both a banned word AND often appears with marketing adjectives).
- When in doubt, flag it. False positives are cheaper than missed slop.
