---
name: mulahazah
description: "Auto-triggers via hook observation on every tool call.
             Also triggers on '/continuous-improvement' command."
---

# Mulahazah — Behavioral Learning

## Activation
Passive: hooks observe every tool call silently (<50ms, non-blocking).
Active: `/continuous-improvement` triggers reflection and analysis.

## Protocol

### Passive Observation
- Hooks capture every tool call as JSONL
- Observations accumulate in `~/.claude/mulahazah/projects/<hash>/`
- No performance impact

### Active Reflection (/continuous-improvement)
1. Review recent observations
2. Extract behavioral rules from patterns
3. Propose new rules for `main/mulahazah-rules.md`
4. **Always ask for approval before adding rules**

### Persistent Rules
- Rules stored in `main/mulahazah-rules.md`
- Read each session, followed automatically
- Rules reinforced by repetition decay without evidence

## Level History
- **Lv.1** — Base: Hook-based observation, rule extraction, persistent behavioral learning.
