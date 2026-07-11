---
name: testing
description: "MUST use when user says 'write tests', 'add tests', 'test coverage',
              'unit test', 'integration test', 'e2e test', 'test this',
              'missing tests', 'broken test', 'test failing', 'run tests',
              'TDD', 'red green refactor',
              or when code changes need test coverage validation.
              Fires automatically as a quality gate companion to code-review."
---

# Testing — Test Writing & Quality Gate Companion

## Activation
When this skill activates, output:
"Running testing protocol..."

## Bypass Criteria (Trivial Changes)
Skip if ALL of:
- No logic changes (comments, formatting, renames, deps only)
- Existing tests pass without modification
- No new functions/components added

---

## Phase 0: Assess Landscape

### 0A: Framework Detection
Auto-detect the project's test framework. Check for:
- `vitest` → `vitest.config.*` in project root
- `jest` → `jest.config.*` in project root
- `playwright` → `playwright.config.*`
- `cypress` → `cypress.config.*`
- `mocha` / `jasmine` → `mocha` or `jasmine` in devDependencies
- `python unittest` / `pytest` → test files in `tests/`
- If none found → recommend Vitest (default for Vite/Next.js projects)

### 0B: Pattern Matching
Before writing any test, examine existing tests for conventions:
- Naming style: `describe/it` or `test()` or custom?
- Assertion style: `expect()` or `assert` or custom matchers?
- File naming: `*.test.ts`, `*.spec.ts`, `*.test.tsx`?
- Mocking approach: `vi.mock`, `jest.mock`, manual mocks?
- Test organization: co-located with source or in `__tests__/`?
- Does the project use testing-library (`@testing-library/react`)? If so, use `screen.getByRole`, `userEvent`, etc.

**Rule**: Match existing conventions exactly. Don't introduce a new pattern unless existing tests are inconsistent.

### 0C: Baseline
1. Run existing test suite to establish baseline (pass/fail)
2. Note any existing failures before your changes
3. Identify test files for the changed modules

---

## Phase 1: Identify What to Test

### New Code
- New functions/classes — test happy path + all edge cases
- New API routes — test response shapes, HTTP codes, error states
- New React components — test rendering, state transitions, user interactions, accessibility
- New server actions — test success/error return types, loading states

### Modified Code
- Changed logic — existing tests still pass? Add regression tests.
- Fixed bugs — add regression test that **would have caught the bug** before the fix
- Refactored code — existing tests should cover; if not, add characterization tests

### Edge Case Coverage Template
For every test target, cover:
1. **Happy path** — normal input, expected output
2. **Empty/null** — what happens with empty arrays, null objects, undefined values
3. **Boundary values** — min/max values, off-by-one edges, string length limits
4. **Error states** — what happens when a dependency fails, API returns 500, DB is down
5. **Type coercion** — unexpected types passed in, malformed data
6. **Race conditions** — concurrent calls, timeout behavior, request cancellation

### Dependency Coverage
- Are the callers/consumers of changed code tested?
- Are side effects (DB writes, API calls, file I/O, email sends) tested via mocks?
- Are mock implementations tested for realistic behavior?

---

## Phase 2: The TDD Cycle (Red → Green → Refactor)

When starting from scratch or implementing a new feature, use TDD:

**RED**: Write a failing test first
```typescript
describe('PasswordValidator', () => {
  it('should reject passwords shorter than 8 characters', () => {
    expect(validatePassword('Ab1!')).toBe(false);
  });
});
```

**GREEN**: Write the minimum code to pass the test
```typescript
function validatePassword(password: string): boolean {
  return password.length >= 8;
}
```

**REFACTOR**: Clean up without changing behavior
- Extract duplicate logic
- Improve naming
- Add type safety

**Repeat** for each edge case. TDD ensures every behavior has a test and every test covers actual behavior.

---

## Phase 3: Write Tests

For each test target:

1. **Name the test clearly** — `describe('feature')` + `it('should do X when Y')`. Test names should read as sentences.
2. **Arrange** — set up inputs/mocks/state. Use factory functions for complex setup.
3. **Act** — invoke the code under test. One action per test.
4. **Assert** — verify the expected outcome. One logical assertion per test.
5. **Edge cases** — see template above
6. **Cleanup** — tear down mocks, reset state (afterEach/afterAll)

### Test Quality Standards
- **Test behavior, not implementation** — assert on visible outcomes, not internal state or mock call counts (unless specifically needed)
- **No test interdependence** — each test must be runnable independently
- **Deterministic** — no random data, no time-dependent values without mocking
- **Fast** — unit tests should run in milliseconds. Anything over 100ms is suspicious.
- **Readable** — test code is documentation. If it's hard to read, it fails its purpose.

### Prioritize
- Unit tests first (fast, isolated, high coverage)
- Integration tests second (real dependencies, fewer in number)
- E2E tests last (slow, brittle — only for critical paths)

### Mocking Rules
- Mock external services at boundaries — never hit real APIs in unit tests
- Mock at the right level: HTTP layer via MSW, DB layer via test DB or mock
- Verify mocks are realistic — mock return values should match actual response shapes
- After test, verify mocks were called as expected (if relevant)

---

## Phase 4: Run & Verify

1. Run the new tests in isolation first
2. Run the full test suite
3. If tests fail → diagnose and fix (fix the TEST if the source is correct, or flag the source issue)
4. If flaky tests found → identify cause: async timing, shared mutable state, test ordering, unclosed resources
   - Flag flaky tests as MAJOR issue — they erode trust in the test suite
   - Recommend fix: await all promises, reset state in beforeEach, avoid shared fixtures
5. If coverage is below 80% on new code → flag as MINOR, note uncovered paths

### Flaky Test Detection Checklist
- [ ] Tests depend on network response timing? → Mock the network
- [ ] Tests share mutable state? → Reset in beforeEach
- [ ] Tests depend on test execution order? → Make each test self-contained
- [ ] Tests have unhandled promises? → Add proper await/cleanup
- [ ] Tests use setTimeout/interval? → Use fake timers instead

---

## Phase 5: Coverage Analysis

After writing tests:

1. Identify untested functions and branches in the changed code
2. If coverage drops below project threshold (or 80%), note which specific paths are uncovered
3. Recommend specific tests to add (not just percentages)
4. Key areas that MUST have coverage:
   - Auth/authorization logic
   - Data validation/parsing
   - Error handling paths
   - API route handlers
   - State transitions
   - Data transformation/mapping

---

## Phase 6: Report

```markdown
## Test Report

### Summary
- Framework: Vitest | Jest | Playwright
- Tests written: N
- New test files: N
- Full suite: ✅ PASS | ❌ FAIL (N failures)
- Coverage on changed code: X% (threshold: 80%)

### Tests Added
- `src/utils/auth.test.ts` — 8 tests (happy + edge + error paths)
- `src/components/UserList.test.tsx` — 5 tests (render + interaction + empty state)

### Coverage Gaps
- `src/utils/validation.ts:42-58` — unhandled edge case on line 51

### Flaky Tests Detected
- None

### Regression Guarantee
- Bug fix in `auth.ts` has regression test that would catch reintroduction
```

### Integration with Code Review
If the code-review gate flagged issues, verify they're addressed in the test coverage.

---

## Agent-Specific Testing Patterns

For testing AI agent code (decision logic, tool calls, non-deterministic output):

### Testing Decision Logic
- Test each decision branch in isolation (if/else, switch/case)
- Test with controlled inputs where the expected path is known

### Testing Tool Calls
- Mock external tool responses
- Test that the correct tool is called for a given input
- Test error handling when tools fail

### Testing Multi-Step Flows
- Test each step of the flow independently 
- Test the full flow with sequential mocks
- Test failure recovery at each step

### Testing Non-Deterministic Output
- Test schema conformance (is the output shape correct?)
- Test range-based assertions (score > 0, length < 500 chars)
- Test input boundaries (empty context, max length context)

---

## Mandatory Rules
1. Never modify source code — tests only
2. Always run full suite before declaring done
3. One test suite run per test file written
4. Regression tests for every bug fix — must catch the bug if reintroduced
5. Mock external services — never hit real APIs in unit tests
6. If no test framework exists → recommend Vitest (default)
7. Match existing test conventions — don't introduce new patterns
8. Each test must be runnable independently — no shared mutable state
9. Test behavior, not implementation details
10. Detect framework first, then write

## Level History
- **Lv.1** — Base: 4-phase test writing protocol with quality gate integration.
- **Lv.2** — Enhanced: Framework detection, pattern matching, edge case coverage template, TDD cycle (Red-Green-Refactor), flaky test detection, coverage analysis, agent-specific testing patterns, test quality standards.
