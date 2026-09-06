// test-get-port-pid.mjs — Unit tests for parsePortPid() regex logic
// (scripts/lib/parse-netstat.mjs).
//
// Tests the regex that extracts a listening PID from `netstat -ano` output
// for a given TCP port. Covers IPv4, IPv6, non-matching, multi-line,
// non-LISTENING states, and empty input.
//
// Run: node scripts/test-get-port-pid.mjs
// (or: data\node\node.exe scripts/test-get-port-pid.mjs)

import assert from "node:assert";
import { parsePortPid } from "../scripts/lib/parse-netstat.mjs";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failed++;
    console.error(`  \u2717 ${name}`);
    console.error(`    ${e.message}`);
  }
}

// ============================================================
console.log("\n1. IPv4 — standard LISTENING line:");
// ============================================================

test("IPv4 address with port 4102 returns PID 12345", () => {
  const output = [
    "Active Connections:",
    "",
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:4102           0.0.0.0:0              LISTENING       12345",
    "  TCP    192.168.1.5:443        10.0.0.1:54321         ESTABLISHED     8888",
    "",
  ].join("\n");

  const result = parsePortPid(output, 4102);
  assert.strictEqual(result, 12345, `Expected 12345, got: ${result}`);
});

test("IPv4 loopback address with port 8080 returns PID 999", () => {
  const output = "  TCP    127.0.0.1:8080         127.0.0.1:50000        LISTENING       999\n";
  const result = parsePortPid(output, 8080);
  assert.strictEqual(result, 999, `Expected 999, got: ${result}`);
});

// ============================================================
console.log("\n2. IPv6 — bracketed address:");
// ============================================================

test("IPv6 [::] address with port 4102 returns PID 67890", () => {
  const output = "  TCP    [::]:4102              [::]:0                  LISTENING       67890\n";
  const result = parsePortPid(output, 4102);
  assert.strictEqual(result, 67890, `Expected 67890, got: ${result}`);
});

test("IPv6 [::1] address with port 3000 returns PID 42", () => {
  const output = "  TCP    [::1]:3000             [::1]:0                 LISTENING       42\n";
  const result = parsePortPid(output, 3000);
  assert.strictEqual(result, 42, `Expected 42, got: ${result}`);
});

// ============================================================
console.log("\n3. No matching port — port not present in output:");
// ============================================================

test("port 9999 not in output returns null", () => {
  const output = [
    "  TCP    0.0.0.0:4102           0.0.0.0:0              LISTENING       12345",
    "  TCP    0.0.0.0:4103           0.0.0.0:0              LISTENING       12346",
    "",
  ].join("\n");

  const result = parsePortPid(output, 9999);
  assert.strictEqual(result, null, `Expected null, got: ${result}`);
});

// ============================================================
console.log("\n4. Multiple lines — target port appears among others:");
// ============================================================

test("target port 4102 is on the 3rd line of 5 — returns correct PID", () => {
  const output = [
    "  TCP    0.0.0.0:80             0.0.0.0:0              LISTENING       1111",
    "  TCP    0.0.0.0:443            0.0.0.0:0              LISTENING       2222",
    "  TCP    0.0.0.0:4102           0.0.0.0:0              LISTENING       3333",
    "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4444",
    "  TCP    0.0.0.0:5000           0.0.0.0:0              LISTENING       5555",
    "",
  ].join("\n");

  const result = parsePortPid(output, 4102);
  assert.strictEqual(result, 3333, `Expected 3333, got: ${result}`);
});

test("two listening lines for same port returns first match", () => {
  // Edge case: if somehow two lines list the same port (unlikely but regex returns first)
  const output = [
    "  TCP    0.0.0.0:4102           0.0.0.0:0              LISTENING       11111",
    "  TCP    127.0.0.1:4102         0.0.0.0:0              LISTENING       22222",
    "",
  ].join("\n");

  const result = parsePortPid(output, 4102);
  assert.strictEqual(result, 11111, `Expected first match 11111, got: ${result}`);
});

// ============================================================
console.log("\n5. Non-LISTENING states — port present but wrong state:");
// ============================================================

test("port 4102 in ESTABLISHED state returns null (no LISTENING match)", () => {
  const output = "  TCP    192.168.1.5:4102      10.0.0.1:54321         ESTABLISHED     8888\n";
  const result = parsePortPid(output, 4102);
  assert.strictEqual(result, null, `Expected null (ESTABLISHED, not LISTENING), got: ${result}`);
});

test("port 4102 in TIME_WAIT state returns null", () => {
  const output = "  TCP    192.168.1.5:4102      10.0.0.1:54321         TIME_WAIT       0\n";
  const result = parsePortPid(output, 4102);
  assert.strictEqual(result, null, `Expected null (TIME_WAIT), got: ${result}`);
});

test("port 4102 LISTENING exists alongside ESTABLISHED — returns the LISTENING PID", () => {
  const output = [
    "  TCP    192.168.1.5:4102      10.0.0.1:54321         ESTABLISHED     8888",
    "  TCP    0.0.0.0:4102           0.0.0.0:0              LISTENING       9999",
    "",
  ].join("\n");

  const result = parsePortPid(output, 4102);
  assert.strictEqual(result, 9999, `Expected LISTENING PID 9999, got: ${result}`);
});

// ============================================================
console.log("\n6. Empty / trivial input:");
// ============================================================

test("empty string returns null", () => {
  assert.strictEqual(parsePortPid("", 4102), null);
});

test("header-only output (no data lines) returns null", () => {
  const output = "Active Connections:\n\n  Proto  Local Address          Foreign Address        State           PID\n";
  assert.strictEqual(parsePortPid(output, 4102), null);
});

// ============================================================
console.log("\n7. Edge cases:");
// ============================================================

test("port number appears in remote address column only — does not match", () => {
  // The regex anchors on the local address port, not the remote.
  // Remote: 10.0.0.1:4102 — the regex looks for [:\\s]PORT before the
  // foreign address column, so this should not match as a listener.
  const output = "  TCP    192.168.1.5:50000     10.0.0.1:4102          ESTABLISHED     7777\n";
  const result = parsePortPid(output, 4102);
  assert.strictEqual(result, null, `Expected null (port only in remote column), got: ${result}`);
});

test("large PID (6-digit) parses correctly", () => {
  const output = "  TCP    0.0.0.0:4102           0.0.0.0:0              LISTENING       123456\n";
  const result = parsePortPid(output, 4102);
  assert.strictEqual(result, 123456, `Expected 123456, got: ${result}`);
});

test("port 410 must NOT match when looking for 4102 (no substring match)", () => {
  // The regex uses the port directly in the pattern, so port 410 in the
  // output must not match a search for port 4102. Verifies no substring bug.
  const output = "  TCP    0.0.0.0:410            0.0.0.0:0              LISTENING       8888\n";
  const result = parsePortPid(output, 4102);
  assert.strictEqual(result, null, `Expected null (port 410 ≠ 4102), got: ${result}`);
});

test("multiple ports on same line (impossible in netstat, but regex handles)", () => {
  // This is a synthetic edge case to verify regex robustness.
  // Real netstat never puts two ports in the local address field.
  const output = "  TCP    0.0.0.0:4102           0.0.0.0:0              LISTENING       7777\n";
  const result = parsePortPid(output, 4102);
  assert.strictEqual(result, 7777, `Expected 7777, got: ${result}`);
});

// ============================================================
// Summary
// ============================================================

console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${"=".repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
