#!/usr/bin/env node
// Tests for write-review-pass.mjs, check-review-pass.mjs, and the shared helper.
// Self-contained — no external test framework. Mirrors test-audit-data-review.mjs style.

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileExistsOnDiskOrBranch } from './lib/review-pass-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WRITE_SCRIPT = join(ROOT, 'scripts', 'write-review-pass.mjs');
const CHECK_SCRIPT = join(ROOT, 'scripts', 'check-review-pass.mjs');
const MARKER_PATH = join(ROOT, 'data', '.review-pass.json');
const MARKER_BACKUP = MARKER_PATH + '.test-backup';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd: ROOT, ...opts });
}

function runExpectFail(cmd, opts = {}) {
  try {
    execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd: ROOT, ...opts });
    return { exited: 0, stdout: '', stderr: '' };
  } catch (err) {
    return { exited: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

function readMarker() {
  return JSON.parse(readFileSync(MARKER_PATH, 'utf8'));
}

function deleteMarker() {
  if (existsSync(MARKER_PATH)) unlinkSync(MARKER_PATH);
}

function saveRealMarker() {
  if (existsSync(MARKER_PATH)) {
    renameSync(MARKER_PATH, MARKER_BACKUP);
  }
}

function restoreRealMarker() {
  if (existsSync(MARKER_BACKUP)) {
    renameSync(MARKER_BACKUP, MARKER_PATH);
  } else {
    deleteMarker();
  }
}

function writeTempMarker(obj) {
  mkdirSync(join(ROOT, 'data'), { recursive: true });
  writeFileSync(MARKER_PATH, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function main() {
  console.log('TAP version 13');
  console.log('# review-pass tooling tests');

  saveRealMarker();

  try {
    // ── write-review-pass.mjs tests ──

    test('1. Default invocation writes valid marker (no --files)', () => {
      deleteMarker();
      run(`node "${WRITE_SCRIPT}"`);
      assert.ok(existsSync(MARKER_PATH), 'marker should exist');
      const m = readMarker();
      assert.strictEqual(m.all_changed_files, true, 'all_changed_files should be true with no changed files');
      assert.ok(Array.isArray(m.files), 'files should be an array');
    });

    test('2. --files with real disk file writes marker with file listed', () => {
      deleteMarker();
      run(`node "${WRITE_SCRIPT}" --files "scripts/write-review-pass.mjs"`);
      const m = readMarker();
      assert.ok(m.files.includes('scripts/write-review-pass.mjs'), 'file should be in marker');
      assert.strictEqual(m.all_changed_files, false);
    });

    test('3. --files with non-existent file (no --target-branch) exits 1', () => {
      deleteMarker();
      const result = runExpectFail(`node "${WRITE_SCRIPT}" --files "nonexistent/fake-file.ts"`);
      assert.strictEqual(result.exited, 1, 'should exit 1');
      assert.ok(!existsSync(MARKER_PATH), 'marker should NOT be written');
    });

    test('4. --files with branch-only file + --target-branch writes marker', () => {
      deleteMarker();
      const testFile = 'README.md';
      const tmpName = testFile + '.tmp-rename-test';
      renameSync(join(ROOT, testFile), join(ROOT, tmpName));
      try {
        run(`node "${WRITE_SCRIPT}" --files "${testFile}" --target-branch HEAD`);
        assert.ok(existsSync(MARKER_PATH), 'marker should exist');
        const m = readMarker();
        assert.ok(m.files.includes(testFile), 'file should be in marker');
        assert.strictEqual(m.target_branch, 'HEAD', 'target_branch should be set');
      } finally {
        renameSync(join(ROOT, tmpName), join(ROOT, testFile));
      }
    });

    test('5. Marker has all required fields', () => {
      deleteMarker();
      run(`node "${WRITE_SCRIPT}" --files "scripts/write-review-pass.mjs"`);
      const m = readMarker();
      for (const field of ['verdict', 'reviewer_agent', 'timestamp', 'epoch_ms', 'files', 'all_changed_files', 'hash']) {
        assert.ok(field in m, `missing field: ${field}`);
      }
    });

    test('6. Same files produce same hash (deterministic)', () => {
      deleteMarker();
      run(`node "${WRITE_SCRIPT}" --files "scripts/write-review-pass.mjs"`);
      const hash1 = readMarker().hash;
      deleteMarker();
      run(`node "${WRITE_SCRIPT}" --files "scripts/write-review-pass.mjs"`);
      const hash2 = readMarker().hash;
      assert.strictEqual(hash1, hash2, 'hashes should match');
    });

    test('7. Empty --verdict is accepted (normalized to empty string)', () => {
      deleteMarker();
      run(`node "${WRITE_SCRIPT}" --verdict ""`);
      const m = readMarker();
      assert.strictEqual(m.verdict, '', 'verdict should be empty string');
    });

    // ── check-review-pass.mjs tests ──

    test('8. No marker on disk → exit 1', () => {
      deleteMarker();
      const result = runExpectFail(`node "${CHECK_SCRIPT}"`);
      assert.strictEqual(result.exited, 1, 'should exit 1');
      assert.ok(result.stderr.includes('not found'), 'should report not found');
    });

    test('9. Fresh marker, no --files → exit 0', () => {
      writeTempMarker({
        verdict: 'PASS', reviewer_agent: 'reviewer', epoch_ms: Date.now(),
        files: ['scripts/write-review-pass.mjs'], all_changed_files: false, hash: 'abc',
      });
      const result = run(`node "${CHECK_SCRIPT}"`);
      assert.ok(result.includes('✓ Marker valid'), 'should report valid');
    });

    test('10. Fresh marker, --files covering marker files → exit 0', () => {
      writeTempMarker({
        verdict: 'PASS', reviewer_agent: 'reviewer', epoch_ms: Date.now(),
        files: ['scripts/write-review-pass.mjs'], all_changed_files: false, hash: 'abc',
      });
      const result = run(`node "${CHECK_SCRIPT}" --files "scripts/write-review-pass.mjs"`);
      assert.ok(result.includes('✓ Marker valid'), 'should report valid');
    });

    test('11. Fresh marker, --files NOT covered → exit 1', () => {
      writeTempMarker({
        verdict: 'PASS', reviewer_agent: 'reviewer', epoch_ms: Date.now(),
        files: ['scripts/write-review-pass.mjs'], all_changed_files: false, hash: 'abc',
      });
      const result = runExpectFail(`node "${CHECK_SCRIPT}" --files "some/other-file.ts"`);
      assert.strictEqual(result.exited, 1, 'should exit 1');
      assert.ok(result.stderr.includes('not covered'), 'should report not covered');
    });

    test('12. Old marker (epoch_ms 3h ago) → exit 1', () => {
      writeTempMarker({
        verdict: 'PASS', reviewer_agent: 'reviewer',
        epoch_ms: Date.now() - 3 * 3600 * 1000,
        files: [], all_changed_files: true, hash: 'abc',
      });
      const result = runExpectFail(`node "${CHECK_SCRIPT}"`);
      assert.strictEqual(result.exited, 1, 'should exit 1');
      assert.ok(result.stderr.includes('expired'), 'should report expired');
    });

    test('13. --max-age 1 with fresh marker → exit 1', () => {
      writeTempMarker({
        verdict: 'PASS', reviewer_agent: 'reviewer', epoch_ms: Date.now() - 2000,
        files: [], all_changed_files: true, hash: 'abc',
      });
      const result = runExpectFail(`node "${CHECK_SCRIPT}" --max-age 1`);
      assert.strictEqual(result.exited, 1, 'should exit 1');
    });

    test('14. --target-branch with branch-only file → exit 0', () => {
      const testFile = 'scripts/write-review-pass.mjs';
      const tmpName = testFile + '.tmp-rename-test2';
      renameSync(join(ROOT, testFile), join(ROOT, tmpName));
      try {
        writeTempMarker({
          verdict: 'PASS', reviewer_agent: 'reviewer', epoch_ms: Date.now(),
          files: [testFile], all_changed_files: false, hash: 'abc', target_branch: 'HEAD',
        });
        const result = run(`node "${CHECK_SCRIPT}" --files "${testFile}" --target-branch HEAD`);
        assert.ok(result.includes('✓ Marker valid'), 'should report valid');
      } finally {
        renameSync(join(ROOT, tmpName), join(ROOT, testFile));
      }
    });

    // ── shared helper tests ──

    test('15. Real disk file → { exists: true, source: "disk" }', () => {
      const result = fileExistsOnDiskOrBranch('scripts/write-review-pass.mjs', ROOT);
      assert.strictEqual(result.exists, true);
      assert.strictEqual(result.source, 'disk');
    });

    test('16. Non-existent file, no branch → { exists: false, source: null }', () => {
      const result = fileExistsOnDiskOrBranch('nonexistent/fake-file-xyz.ts', ROOT);
      assert.strictEqual(result.exists, false);
      assert.strictEqual(result.source, null);
    });

    test('17. File on HEAD but not on disk → { exists: true, source: "branch" }', () => {
      const testFile = 'scripts/write-review-pass.mjs';
      const tmpName = testFile + '.tmp-rename-test3';
      renameSync(join(ROOT, testFile), join(ROOT, tmpName));
      try {
        const result = fileExistsOnDiskOrBranch(testFile, ROOT, 'HEAD');
        assert.strictEqual(result.exists, true, 'should exist on HEAD');
        assert.strictEqual(result.source, 'branch', 'source should be branch');
      } finally {
        renameSync(join(ROOT, tmpName), join(ROOT, testFile));
      }
    });

  } finally {
    restoreRealMarker();
  }

  console.log('');
  console.log(`# ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exit(1);
}

try {
  main();
} catch (e) {
  console.error(`Test runner error: ${e.message}`);
  restoreRealMarker();
  process.exit(1);
}
