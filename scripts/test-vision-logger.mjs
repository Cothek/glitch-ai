// scripts/test-vision-logger.mjs
// Tests for the vision dispatch compliance logger.
// Runs each function, then verifies the log file contents and stats.

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

async function main() {
  console.log('Vision Dispatch Logger Tests');
  console.log('============================');
  console.log(`Log file: ${VISION_LOG_FILE}`);
  console.log('');

  // Snapshot the log file size so we can measure what this test added.
  let initialContent = '';
  try {
    initialContent = await fs.readFile(VISION_LOG_FILE, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const initialLineCount = initialContent
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#')).length;

  // --- Test 1: logVisionDetection ---
  console.log('Test 1: logVisionDetection');
  const testImagePath = 'E:\\Glitch AI\\glitch-ai\\data\\screenshots\\chat-image-test.png';
  await logVisionDetection(testImagePath);
  assert(true, 'logVisionDetection did not throw');

  // --- Test 2: logVisionDispatch ---
  console.log('Test 2: logVisionDispatch');
  const testTaskId = 'ses_test_abc123';
  await logVisionDispatch(testTaskId);
  assert(true, 'logVisionDispatch did not throw');

  // --- Test 3: logVisionCompletion (success) ---
  console.log('Test 3: logVisionCompletion (success)');
  await logVisionCompletion(testTaskId, true);
  assert(true, 'logVisionCompletion(success) did not throw');

  // --- Test 4: logVisionCompletion (failure) ---
  console.log('Test 4: logVisionCompletion (failure)');
  await logVisionCompletion('ses_test_def456', false);
  assert(true, 'logVisionCompletion(failure) did not throw');

  // --- Test 5: logVisionDeletion ---
  console.log('Test 5: logVisionDeletion');
  await logVisionDeletion();
  assert(true, 'logVisionDeletion did not throw');

  // --- Test 6: logVisionError (string) ---
  console.log('Test 6: logVisionError (string)');
  await logVisionError('Failed to read image file');
  assert(true, 'logVisionError(string) did not throw');

  // --- Test 7: logVisionError (Error instance) ---
  console.log('Test 7: logVisionError (Error instance)');
  await logVisionError(new Error('Image file not found'));
  assert(true, 'logVisionError(Error) did not throw');

  // --- Verify log file contents ---
  console.log('');
  console.log('Verifying log file contents...');
  const finalContent = await fs.readFile(VISION_LOG_FILE, 'utf8');
  const finalLines = finalContent.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const addedLines = finalLines.length - initialLineCount;

  assert(addedLines === 7, `Expected 7 new log lines, got ${addedLines}`);
  assert(finalContent.includes('DETECTED:'), 'Log contains DETECTED entries');
  assert(finalContent.includes('DISPATCHED:'), 'Log contains DISPATCHED entries');
  assert(finalContent.includes('COMPLETED:'), 'Log contains COMPLETED entries');
  assert(finalContent.includes('DELETED:'), 'Log contains DELETED entries');
  assert(finalContent.includes('ERROR:'), 'Log contains ERROR entries');
  assert(finalContent.includes(testImagePath), 'Log contains the test image path');
  assert(finalContent.includes(testTaskId), 'Log contains the test task ID');
  assert(finalContent.includes('(success)'), 'Log contains success status');
  assert(finalContent.includes('(failure)'), 'Log contains failure status');
  assert(finalContent.includes('Failed to read image file'), 'Log contains error message');

  // Verify timestamp format on the last line
  const lastLine = finalLines[finalLines.length - 1];
  const tsMatch = lastLine.match(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/);
  assert(tsMatch !== null, `Last line has valid timestamp format: ${lastLine}`);

  // --- Verify stats ---
  console.log('');
  console.log('Verifying getVisionLogStats()...');
  const stats = await getVisionLogStats();
  console.log('Stats:', JSON.stringify(stats, null, 2));

  assert(stats.DETECTED >= 1, `stats.DETECTED >= 1 (got ${stats.DETECTED})`);
  assert(stats.DISPATCHED >= 1, `stats.DISPATCHED >= 1 (got ${stats.DISPATCHED})`);
  assert(stats.COMPLETED >= 2, `stats.COMPLETED >= 2 (got ${stats.COMPLETED})`);
  assert(stats.DELETED >= 1, `stats.DELETED >= 1 (got ${stats.DELETED})`);
  assert(stats.ERROR >= 2, `stats.ERROR >= 2 (got ${stats.ERROR})`);
  assert(stats.total === stats.DETECTED + stats.DISPATCHED + stats.COMPLETED + stats.DELETED + stats.ERROR,
    `stats.total equals sum of action counts`);

  // --- Summary ---
  console.log('');
  console.log('============================');
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
