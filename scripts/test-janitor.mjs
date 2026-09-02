#!/usr/bin/env node
/**
 * Test harness for scripts/janitor.mjs
 *
 * Creates a sandboxed temp directory, fabricates files with controlled mtimes,
 * runs janitor logic against the sandbox, and asserts each rule.
 *
 * Usage: node scripts/test-janitor.mjs
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runJanitor } from './janitor.mjs';

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

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function setMtime(filePath, ageMs) {
  const t = new Date(Date.now() - ageMs);
  await fs.utimes(filePath, t, t);
}

async function main() {
  console.log('Janitor Tests');
  console.log('=============');

  const sandbox = path.join(os.tmpdir(), `opencode-test-janitor-${process.pid}`);
  const dataDir = path.join(sandbox, 'data');

  try {
    // Setup: create data/ dir structure
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(path.join(dataDir, 'temp'), { recursive: true });
    await fs.mkdir(path.join(dataDir, 'tmp'), { recursive: true });
    await fs.mkdir(path.join(dataDir, 'scratch'), { recursive: true });

    // ── Rule 1: Stale flag deleted ──────────────────────────────────────
    console.log('Rule 1: MEMORY_TRIGGER_FLAG older than 24h is deleted');
    {
      const staleFlag = path.join(dataDir, 'MEMORY_TRIGGER_FLAG.ses_stale');
      await fs.writeFile(staleFlag, 'stale flag data');
      await setMtime(staleFlag, 25 * 3600000); // 25 hours old

      const freshFlag = path.join(dataDir, 'MEMORY_TRIGGER_FLAG.ses_fresh');
      await fs.writeFile(freshFlag, 'fresh flag data');
      await setMtime(freshFlag, 1 * 3600000); // 1 hour old

      const report = runJanitor({ base: sandbox, apply: true });

      assert(!(await exists(staleFlag)), 'Stale flag deleted');
      assert(await exists(freshFlag), 'Fresh flag kept');
      assert(report.flagsDeleted === 1, `flagsDeleted = 1 (got ${report.flagsDeleted})`);
      assert(report.flagsKept === 1, `flagsKept = 1 (got ${report.flagsKept})`);

      // Cleanup fresh flag for next test
      await fs.unlink(freshFlag);
    }

    // ── Rule 2: Old log deleted, fresh log kept ──────────────────────────
    console.log('Rule 2: Non-protected log older than 7d is deleted');
    {
      const oldLog = path.join(dataDir, 'verify-old.log');
      await fs.writeFile(oldLog, 'old log data');
      await setMtime(oldLog, 8 * 86400000); // 8 days old

      const freshLog = path.join(dataDir, 'verify-fresh.log');
      await fs.writeFile(freshLog, 'fresh log data');
      await setMtime(freshLog, 1 * 86400000); // 1 day old

      const report = runJanitor({ base: sandbox, apply: true });

      assert(!(await exists(oldLog)), 'Old non-protected log deleted');
      assert(await exists(freshLog), 'Fresh log kept');
      assert(report.logsDeleted >= 1, `logsDeleted >= 1 (got ${report.logsDeleted})`);

      await fs.unlink(freshLog);
    }

    // ── Rule 2b: Protected log truncated not deleted ─────────────────────
    console.log('Rule 2b: Protected log (launch.log) truncated when >5MB');
    {
      const launchLog = path.join(dataDir, 'launch.log');
      // Create a 6MB log with 3000 lines
      const line = 'x'.repeat(2000) + '\n';
      const lines = 3000;
      let content = '';
      for (let i = 0; i < lines; i++) content += line;
      await fs.writeFile(launchLog, content);
      await setMtime(launchLog, 8 * 86400000); // 8 days old — would be deleted if not protected

      const report = runJanitor({ base: sandbox, apply: true });

      assert(await exists(launchLog), 'Protected launch.log NOT deleted');
      assert(report.logsTruncated === 1, `logsTruncated = 1 (got ${report.logsTruncated})`);

      // Verify truncation: file should have ~2000 lines now
      const truncated = await fs.readFile(launchLog, 'utf-8');
      const lineCount = truncated.split('\n').length;
      assert(lineCount <= 2001, `Truncated to <=2001 lines (got ${lineCount})`);

      await fs.unlink(launchLog);
    }

    // ── Rule 2c: Protected log NOT truncated when <5MB ──────────────────
    console.log('Rule 2c: Protected log NOT truncated when <5MB');
    {
      const authLog = path.join(dataDir, 'auth-proxy.log');
      await fs.writeFile(authLog, 'small log content\n');
      await setMtime(authLog, 8 * 86400000);

      const report = runJanitor({ base: sandbox, apply: true });

      assert(await exists(authLog), 'Small protected log kept as-is');
      const stat = await fs.stat(authLog);
      assert(stat.size < 1000, `Small protected log not truncated (size=${stat.size})`);

      await fs.unlink(authLog);
    }

    // ── Rule 3: Temp dirs cleared but kept ───────────────────────────────
    console.log('Rule 3: data/temp, data/tmp, data/scratch cleared but dirs kept');
    {
      const tempFile = path.join(dataDir, 'temp', 'tempfile.txt');
      const tmpFile = path.join(dataDir, 'tmp', 'tmpfile.txt');
      const scratchFile = path.join(dataDir, 'scratch', 'scratchfile.txt');
      await fs.writeFile(tempFile, 'temp data');
      await fs.writeFile(tmpFile, 'tmp data');
      await fs.writeFile(scratchFile, 'scratch data');

      const report = runJanitor({ base: sandbox, apply: true });

      assert(!(await exists(tempFile)), 'temp/tempfile.txt cleared');
      assert(!(await exists(tmpFile)), 'tmp/tmpfile.txt cleared');
      assert(!(await exists(scratchFile)), 'scratch/scratchfile.txt cleared');
      assert(await exists(path.join(dataDir, 'temp')), 'data/temp/ dir still exists');
      assert(await exists(path.join(dataDir, 'tmp')), 'data/tmp/ dir still exists');
      assert(await exists(path.join(dataDir, 'scratch')), 'data/scratch/ dir still exists');
      assert(report.tempCleared === 3, `tempCleared = 3 (got ${report.tempCleared})`);
    }

    // ── Dry-run mode: nothing deleted ────────────────────────────────────
    console.log('Dry-run: nothing deleted');
    {
      const dryFlag = path.join(dataDir, 'MEMORY_TRIGGER_FLAG.ses_dry');
      await fs.writeFile(dryFlag, 'dry run flag');
      await setMtime(dryFlag, 25 * 3600000);

      const dryLog = path.join(dataDir, 'old-dry.log');
      await fs.writeFile(dryLog, 'old dry log');
      await setMtime(dryLog, 8 * 86400000);

      const report = runJanitor({ base: sandbox, apply: false });

      assert(await exists(dryFlag), 'Dry-run: stale flag kept');
      assert(await exists(dryLog), 'Dry-run: old log kept');
      assert(report.flagsDeleted === 1, `Dry-run: flagsDeleted counted (got ${report.flagsDeleted})`);
      assert(report.logsDeleted >= 1, `Dry-run: logsDeleted counted (got ${report.logsDeleted})`);

      await fs.unlink(dryFlag);
      await fs.unlink(dryLog);
    }

    // ── Empty data/ dir: no crash ────────────────────────────────────────
    console.log('Edge: empty data/ dir causes no crash');
    {
      const emptySandbox = path.join(os.tmpdir(), `opencode-test-janitor-empty-${process.pid}`);
      await fs.mkdir(path.join(emptySandbox, 'data'), { recursive: true });

      const report = runJanitor({ base: emptySandbox, apply: true });
      assert(report.flagsDeleted === 0, 'Empty: flagsDeleted = 0');
      assert(report.logsDeleted === 0, 'Empty: logsDeleted = 0');

      await fs.rm(emptySandbox, { recursive: true, force: true });
    }

    // ── Missing data/ dir: no crash ──────────────────────────────────────
    console.log('Edge: missing data/ dir causes no crash');
    {
      const noDataSandbox = path.join(os.tmpdir(), `opencode-test-janitor-nodata-${process.pid}`);
      await fs.mkdir(noDataSandbox, { recursive: true });

      const report = runJanitor({ base: noDataSandbox, apply: true });
      assert(report.flagsDeleted === 0, 'Missing data/: flagsDeleted = 0');

      await fs.rm(noDataSandbox, { recursive: true, force: true });
    }

  } finally {
    await fs.rm(sandbox, { recursive: true, force: true });
  }

  console.log('');
  console.log('=============');
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
