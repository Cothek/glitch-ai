// scripts/test-vision-dispatch.mjs
// End-to-end verification test for the vision dispatch flow.
// Tests the vision-logger.mjs compliance tracking across the full lifecycle:
//   DETECTED -> DISPATCHED -> COMPLETED -> DELETED
// plus error handling and log file integrity.
//
// Matches the existing custom assert-based runner pattern used by
// scripts/test-vision-logger.mjs (no Vitest dependency required).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  logVisionDetection,
  logVisionDispatch,
  logVisionCompletion,
  logVisionDeletion,
  logVisionError,
  getVisionLogStats,
  VISION_LOG_FILE,
} from './lib/vision-logger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`  PASS: ${message}`);
  } else {
    failed += 1;
    console.error(`  FAIL: ${message}`);
  }
}

async function readLogLines() {
  let content = '';
  try {
    content = await fs.readFile(VISION_LOG_FILE, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return content.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
}

async function main() {
  console.log('Vision Dispatch End-to-End Tests');
  console.log('=================================');
  console.log(`Log file: ${VISION_LOG_FILE}`);
  console.log('');

  // Snapshot the log file so we can measure what this test added.
  const initialLines = await readLogLines();
  const initialLineCount = initialLines.length;

  // --- Scenario 1: Flag detection (DETECTED entry written) ---
  console.log('Scenario 1: Flag detection (DETECTED entry)');
  const testImagePath = path.join(PROJECT_ROOT, 'data', 'screenshots', 'test-vision-dispatch.png');
  await logVisionDetection(testImagePath);
  assert(true, 'logVisionDetection did not throw');

  // --- Scenario 2: Path extraction (absolute path preserved in log) ---
  console.log('Scenario 2: Path extraction (absolute path preserved)');
  const linesAfterDetect = await readLogLines();
  const lastEntry = linesAfterDetect[linesAfterDetect.length - 1];
  assert(lastEntry.includes('DETECTED:'), 'Last entry is a DETECTED entry');
  assert(lastEntry.includes(testImagePath), 'DETECTED entry contains the absolute image path');
  assert(path.isAbsolute(testImagePath), 'Test image path is absolute');

  // --- Scenario 3: Manifest fallback (DISPATCHED + COMPLETED lifecycle) ---
  console.log('Scenario 3: Manifest fallback (full dispatch lifecycle)');
  const testTaskId = 'ses_vision_e2e_test';
  await logVisionDispatch(testTaskId);
  await logVisionCompletion(testTaskId, true);
  await logVisionDeletion();

  const linesAfterLifecycle = await readLogLines();
  const recentLines = linesAfterLifecycle.slice(-3);
  assert(recentLines[0].includes('DISPATCHED:') && recentLines[0].includes(testTaskId),
    'DISPATCHED entry contains the task ID');
  assert(recentLines[1].includes('COMPLETED:') && recentLines[1].includes('(success)'),
    'COMPLETED entry marked as success');
  assert(recentLines[2].includes('DELETED:') && recentLines[2].includes('NEW_IMAGE_FLAG removed'),
    'DELETED entry confirms flag removal');

  // --- Scenario 4: Error handling (corrupted/invalid input) ---
  console.log('Scenario 4: Error handling (invalid input)');
  // Empty string error message
  await logVisionError('');
  // Error instance with empty message
  await logVisionError(new Error(''));
  // Non-Error, non-string input (number)
  await logVisionError(42);
  // Very long error message (stress test)
  const longMsg = 'x'.repeat(10000);
  await logVisionError(longMsg);

  const linesAfterErrors = await readLogLines();
  const errorLines = linesAfterErrors.slice(-4);
  assert(errorLines.every((l) => l.includes('ERROR:')), 'All error entries tagged with ERROR:');
  assert(errorLines[3].includes(longMsg), 'Long error message preserved in full');

  // --- Verify log file integrity ---
  console.log('');
  console.log('Verifying log file integrity...');
  const finalLines = await readLogLines();
  const addedLines = finalLines.length - initialLineCount;

  // 1 DETECTED + 1 DISPATCHED + 1 COMPLETED + 1 DELETED + 4 ERROR = 8 new lines
  assert(addedLines === 8, `Expected 8 new log lines, got ${addedLines}`);

  // Every line must have a valid timestamp prefix
  const tsRegex = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] [A-Z]+:/;
  const allValid = finalLines.every((l) => tsRegex.test(l));
  assert(allValid, 'All log lines have valid [timestamp] ACTION: format');

  // --- Verify stats reflect the new entries ---
  console.log('');
  console.log('Verifying getVisionLogStats()...');
  const stats = await getVisionLogStats();
  console.log('Stats:', JSON.stringify(stats, null, 2));

  assert(stats.DETECTED >= 1, `stats.DETECTED >= 1 (got ${stats.DETECTED})`);
  assert(stats.DISPATCHED >= 1, `stats.DISPATCHED >= 1 (got ${stats.DISPATCHED})`);
  assert(stats.COMPLETED >= 1, `stats.COMPLETED >= 1 (got ${stats.COMPLETED})`);
  assert(stats.DELETED >= 1, `stats.DELETED >= 1 (got ${stats.DELETED})`);
  assert(stats.ERROR >= 4, `stats.ERROR >= 4 (got ${stats.ERROR})`);
  assert(stats.total === stats.DETECTED + stats.DISPATCHED + stats.COMPLETED + stats.DELETED + stats.ERROR,
    'stats.total equals sum of action counts');

  // --- Summary ---
  console.log('');
  console.log('=================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`Log file: ${path.relative(PROJECT_ROOT, VISION_LOG_FILE)}`);
  console.log(`Total log entries: ${finalLines.length}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
