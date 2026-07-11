---
name: refactoring
description: "MUST use when user says 'refactor', 'clean this up', 'simplify this',
              'restructure', 'extract this', 'rename', 'reduce duplication',
              'improve this code', 'make this better', 'modernize this',
              'break this apart', 'untangle this',
              or when improving existing code without changing external behavior."
---

# Refactoring — Behavior-Preserving Code Improvement

## Activation
When this skill activates, output:
"Running refactoring protocol..."

## Protocol

### Phase 1: Understand Before Touching
1. Read the code fully — understand what it does, not just what it says
2. Read the test file if it exists
3. **Run GitNexus `context` on the symbol(s) being refactored** — see all callers, callees, and process participation. Use `impact` to evaluate blast radius before making changes.
4. Identify the external contract (public API, function signatures, I/O)
5. Run existing tests to establish baseline

### Phase 2: Identify Refactoring Targets
Scan for:
- **Duplication** — same logic in 2+ places → extract
- **Long functions** — >20 lines → extract helper(s)
- **Deep nesting** — >3 levels → early return, guard clauses, extract
- **God objects/classes** — too many responsibilities → split
- **Poor naming** — doesn't reveal intent → rename (keep one level of indirection)
- **Dead code** — unused params/vars/functions → remove
- **Mutation overload** — state changes scattered → centralize
- **Mixed abstraction levels** — low-level details mixed with high-level logic → extract

### Phase 3: Apply Changes (One Step at a Time)
For each refactoring:
1. Identify one atomic change
2. Apply it
3. Run tests / build
4. If it passes → commit ("refactor: ...")
5. Move to next atomic change
6. If tests fail → revert the single change and retry

### Phase 4: Verify
1. Full test suite pass
2. No behavior change (identical outputs for identical inputs)
3. Document any API changes that affect callers

## Safe Refactoring Patterns (Precedence Order)
```
Rename → Extract → Inline → Move → Split → Restructure
(Safer → Riskier — prefer lower-risk patterns)
```

## Anti-Patterns (Never Do)
- Mixing refactoring with feature work in the same change
- Rewriting from scratch when incremental works
- "I'll fix the tests later"
- Refactoring without tests (unless trivial rename)

## Mandatory Rules
1. Never change external behavior — preserve the contract
2. One atomic change between test runs
3. Run tests after every single change
4. If no tests exist, add characterization tests first
5. Commit after each successful atomic change
6. Revert on red — never pile on fixes

## Level History
- **Lv.1** — Base: 4-phase refactoring protocol with atomic change discipline.
