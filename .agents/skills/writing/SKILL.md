# Writing Craft - Remove AI Telltales

When producing ANY written content (responses, documentation, comments, commit messages, code review comments, or generated text), apply these rules to avoid common AI writing tells.

## Two Modes

This skill operates in two modes. Pick the one that fits the context.

**Default mode (Troy's preferences)**: Apply all rules below except where they conflict with Troy's explicit preferences. Troy allows contractions and bans em dashes. STE bans contractions and allows em dashes. Default mode follows Troy.

**Strict STE mode**: Apply every rule including contractions expansion and em dash removal. Use this for technical documentation, safety-critical procedures, or when the user explicitly asks for STE-strict output.

When in doubt, default mode wins. Troy's preferences override STE defaults.

## Mode Detection

Use **Strict STE mode** when:
- Writing procedures, runbooks, safety-critical text, error messages
- The user explicitly asks for "STE strict" or "ASD-STE100 strict" output
- The context is a formal technical procedure where every rule must apply

Use **Default mode** (Troy's preferences) when:
- Writing general prose: READMEs, PR descriptions, docs, comments, release notes
- The user asks to "remove AI tells" or "make this not sound like AI"
- No explicit mode is specified. Default mode wins

---

## Hard Rules (Always Apply)

### Punctuation

- **No em dashes**. Use a single dash, comma, colon, or period instead.
- Example: "Three things: speed, clarity, and precision." NOT "Three things - speed, clarity, and precision." or "Three things -- speed, clarity, and precision."
- Exception: Code comments or technical documentation where the style guide explicitly requires them.

- **No semicolons**. Write two sentences instead.
- Example: "The test passed. The build is green." NOT "The test passed; the build is green."

### No AI Filler Words

Never use these words and phrases. They are AI tells with no added meaning:

- "delve" / "delving into"
- "navigate" / "navigating"
- "tapestry" of anything
- "realm" (use "area", "field", or just name it directly)
- "landscape" (use "ecosystem", "space", or "field")
- "leverage" (use "use")
- "utilize" (use "use")
- "harness" the power of
- "unlock" (use "enable" or just name the capability)
- "empower" users to
- "seamless" (describe what actually makes it good)
- "cutting-edge" / "state-of-the-art" (show, don't tell)

### No Padding Openers

- Do NOT start responses with "Certainly!", "Absolutely!", "Of course!", "Great question!"
- Do NOT use "I think", "I believe", "In my opinion", "It seems to me"
- Do NOT start paragraphs with "In addition,", "Furthermore,", "Moreover,", "Additionally,"
- Just state the answer directly.

### No Padding Phrases

- "It is worth noting that..." -> just note it
- "It is important to mention that..." -> just mention it
- "It should be noted that..." -> just say it
- "At the end of the day" -> cut it
- "In order to" -> use "to"
- "In terms of" -> just say what you mean
- "When it comes to" -> cut the phrase

### Contractions

- Default mode: Use contractions. "don't", "it's", "they're", "we'll", "can't", "won't", "you're".
- Strict STE mode: Expand all contractions. "do not", "it is", "they are", "we will", "cannot", "will not", "you are".
- Exception in both modes: When you need emphasis ("I do NOT agree") or formal technical writing.

### Active Voice

- Prefer active voice over passive.
- "The config sets the model" NOT "The model is set by the config"
- Exception: When the actor is unknown or irrelevant ("The file was deleted").

---

## STE Principles (Simplified Technical English)

These rules come from ASD-STE100, the aerospace standard for clear technical writing. They apply in both modes.

### Terminology Discipline

Use one name for one thing. Never call the same item by two different names in the same document.

- Give each word one meaning. "Fall" means to move down, not to decrease.
- Pick a term and stick with it. If you call it "the server" on line 1, do not call it "the system" on line 10.

Use the short common word. Replace long or formal words with their plain equivalents:

| Long form | Short form |
|-----------|------------|
| begin, commence, initiate | start |
| utilize, leverage | use |
| facilitate | help |
| ensure | make sure |
| prior to | before |
| subsequent to | after |
| regarding, concerning | about |
| obtain, acquire | get |
| demonstrate | show |
| additionally, furthermore, moreover | also |

### Sentence Length Caps

- Max 25 words for descriptive text.
- Max 20 words for instructions and procedures.
- One instruction per sentence.

If a sentence runs over the cap, split it. Two short sentences beat one long one.

### No Nominalizations

Replace noun forms of verbs with the verb itself. Cut "-tion", "-ment", "-ance", "-ence" + "of" patterns.

- "Analyze the log" NOT "Perform an analysis of the log"
- "Configure the server" NOT "Carry out the configuration of the server"
- "Decide now" NOT "Make a decision now"
- "The test failed" NOT "There was a failure of the test"

### Condition Before Command

Put the condition first, then the imperative. This makes the trigger clear before the action.

- "If the file does not exist, create it." NOT "Create the file if it does not exist."
- "When the build fails, check the logs." NOT "Check the logs when the build fails."

### No Stacked Auxiliaries or Hedge Chains

Catch chains like "it is important to note that this may help to improve X". Cut the whole stack.

- "This improves X" NOT "It is important to note that this may help to improve X"
- "The fix works" NOT "It should be noted that the fix may potentially help to address the issue"

If you find yourself writing "it is important to note", stop. Just state the thing.

---

## Strongly Recommended

### Sentence Variety

- Mix short and long sentences. A 3-word sentence followed by a 25-word sentence reads better than uniform 15-word sentences.
- Vary how you start each sentence. Not every paragraph needs a transition word.

### Specificity Over Abstraction

- Use concrete numbers and names instead of vague quantifiers.
- "Reduced load time by 42ms" NOT "significantly improved performance"
- "The login form" NOT "the user interface component"

### Direct Over Verbose

- Shorten phrases to their direct form.
- "Because" NOT "due to the fact that"
- "About" NOT "with regard to" / "with respect to"
- "Can" NOT "is able to" / "has the ability to"
- "Before" NOT "prior to"
- "After" NOT "subsequent to"

### No Faux Humility

- Do not qualify strong statements with weak hedges.
- "This is the wrong approach" NOT "I think this might not be the best approach"
- "It fails because..." NOT "It seems like it might possibly fail because..."
- Save hedges for actual uncertainty. When you know, state it.

### End Strong

- Avoid trailing off with "and so on", "etc.", "and more", "among others"
- If the list is complete, finish it. If it is not, pick the most important items and stop.

---

## Self-Lint Checklist

Run this checklist on every text response before returning it. If any check fails, fix it.

For thorough checking, run the linter skill which separates these into distinct categories with specific fixes.

- [ ] Any sentence over 25 words? Split it.
- [ ] Any semicolon? Replace with a period.
- [ ] Any contraction? Expand it (strict STE mode only; default mode allows them).
- [ ] Any passive voice with a known actor? Make it active.
- [ ] Any "-ing" main verb (is reading, was analyzing)? Replace with simple tense (reads, analyzed).
- [ ] Any nominalization (perform an analysis of, configuration of)? Replace with plain verb (analyze, configure).
- [ ] Any phrasal verb (spin up, reach out, dive into)? Replace with single verb (start, contact, examine).
- [ ] Same thing named two ways? Pick one name.
- [ ] Any marketing adjective (seamless, robust, cutting-edge, etc.)? Remove it.
- [ ] Any modal hedge (it is important to note, it should be noted, etc.)? Cut it.
- [ ] Any paragraph over 6 sentences? Split it.
- [ ] Any em dash? Replace with comma, colon, or period.
- [ ] Any filler word from the banned list? Remove it.
- [ ] Any padding opener or phrase? Cut it.
