// scripts/test-audit-data.mjs
// Tests for the audit-data quarantine lifecycle script.
// Uses a sandboxed temp directory to avoid touching real files.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function runScript(scriptPath, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
      encoding: 'utf8',
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', code: err.status ?? 1 };
  }
}

async function main() {
  console.log('Audit Data Quarantine Tests');
  console.log('============================');

  const sandbox = path.join(os.tmpdir(), `opencode-test-audit-${process.pid}`);
  const dataDir = path.join(sandbox, 'data');
  const copiedScript = path.join(sandbox, 'scripts', 'audit-data.mjs');
  const manifestPath = path.join(dataDir, 'quarantine-manifest.json');
  const logPath = path.join(dataDir, 'cleanup-log.jsonl');

  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(path.dirname(copiedScript), { recursive: true });
    await fs.copyFile(
      path.join(__dirname, 'audit-data.mjs'),
      copiedScript,
    );

    async function readManifest() {
      try {
        return JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      } catch {
        return {};
      }
    }

    async function writeManifest(m) {
      await fs.writeFile(manifestPath, JSON.stringify(m, null, 2) + '\n', 'utf8');
    }

    async function readLogLines() {
      try {
        const content = await fs.readFile(logPath, 'utf8');
        return content.trim().split('\n').filter(Boolean);
      } catch {
        return [];
      }
    }

    function daysAgoIso(days) {
      return new Date(Date.now() - days * 86400000).toISOString();
    }

    // --- Test 1: New candidate quarantined ---
    console.log('Test 1: New candidate quarantined');
    {
      const testFile = path.join(dataDir, 'test-orphan.js');
      await fs.writeFile(testFile, 'orphan content here');
      const stat = await fs.stat(testFile);

      const result = runScript(copiedScript, ['--report']);
      const manifest = await readManifest();
      const logLines = await readLogLines();

      assert(result.code === 0, `Exit code 0 (got ${result.code})`);
      assert('test-orphan.js' in manifest, 'test-orphan.js in manifest');

      const entry = manifest['test-orphan.js'];
      assert(entry && entry.status === 'watching', `Status is watching (got ${entry?.status})`);
      assert(entry && entry.category === 'auto-flag', `Category is auto-flag (got ${entry?.category})`);
      assert(entry && entry.graceDays === 3, `Grace days is 3 (got ${entry?.graceDays})`);

      const firstSeenTime = entry ? new Date(entry.firstSeen).getTime() : 0;
      assert(Math.abs(Date.now() - firstSeenTime) < 60000, 'firstSeen is recent');
      assert(entry && entry.firstSize === stat.size, `firstSize matches (${entry?.firstSize} === ${stat.size})`);

      const qLog = logLines.find(l => {
        const p = JSON.parse(l);
        return p.action === 'quarantined' && p.path === 'test-orphan.js';
      });
      assert(!!qLog, 'cleanup-log has quarantined entry');
    }

    // --- Test 2: Idempotent re-run ---
    console.log('Test 2: Idempotent re-run');
    {
      const logBefore = (await readLogLines()).length;
      const manifestBefore = await readManifest();
      const countBefore = Object.keys(manifestBefore).length;

      runScript(copiedScript, ['--report']);

      const manifestAfter = await readManifest();
      const logAfter = (await readLogLines()).length;

      assert(Object.keys(manifestAfter).length === countBefore, `No new manifest entries (${Object.keys(manifestAfter).length} === ${countBefore})`);
      assert(logAfter === logBefore, `No new log lines (${logAfter} === ${logBefore})`);
    }

    // --- Test 3: Grace period elapsed → ready ---
    console.log('Test 3: Grace period elapsed → ready');
    {
      const testFile = path.join(dataDir, 'grace-elapsed.js');
      await fs.writeFile(testFile, 'grace test content');

      runScript(copiedScript, ['--report']);

      const manifest = await readManifest();
      manifest['grace-elapsed.js'].firstSeen = daysAgoIso(20);
      await writeManifest(manifest);

      runScript(copiedScript, ['--report']);
      const updated = await readManifest();

      assert(updated['grace-elapsed.js']?.status === 'ready', `Status is ready (got ${updated['grace-elapsed.js']?.status})`);
    }

    // --- Test 4: Changed file resets timer ---
    console.log('Test 4: Changed file resets timer');
    {
      const testFile = path.join(dataDir, 'change-reset.js');
      await fs.writeFile(testFile, 'initial');

      runScript(copiedScript, ['--report']);

      await fs.writeFile(testFile, 'initial+');

      const manifest = await readManifest();
      manifest['change-reset.js'].firstSeen = daysAgoIso(20);
      await writeManifest(manifest);

      runScript(copiedScript, ['--report']);
      const updated = await readManifest();
      const entry = updated['change-reset.js'];

      assert(entry?.status === 'watching', `Status is watching (got ${entry?.status})`);
      const recent = Math.abs(Date.now() - new Date(entry.firstSeen).getTime()) < 60000;
      assert(recent, 'firstSeen was reset to now');
    }

    // --- Test 5: Ready file demoted if changed ---
    console.log('Test 5: Ready file demoted if changed');
    {
      const testFile = path.join(dataDir, 'ready-demote.js');
      await fs.writeFile(testFile, 'demote content');

      runScript(copiedScript, ['--report']);

      const manifest = await readManifest();
      manifest['ready-demote.js'].status = 'ready';
      await writeManifest(manifest);

      await fs.writeFile(testFile, 'demote content modified!!');

      runScript(copiedScript, ['--report']);
      const updated = await readManifest();
      const entry = updated['ready-demote.js'];

      assert(entry?.status === 'watching', `Status demoted to watching (got ${entry?.status})`);
      const recent = Math.abs(Date.now() - new Date(entry.firstSeen).getTime()) < 60000;
      assert(recent, 'firstSeen was reset');
    }

    // --- Test 6: Deleted file removed from manifest ---
    console.log('Test 6: Deleted file removed from manifest');
    {
      const testFile = path.join(dataDir, 'delete-me.js');
      await fs.writeFile(testFile, 'delete me');

      runScript(copiedScript, ['--report']);
      let manifest = await readManifest();
      assert('delete-me.js' in manifest, 'In manifest after quarantine');

      await fs.unlink(testFile);

      runScript(copiedScript, ['--report']);
      manifest = await readManifest();
      assert(!('delete-me.js' in manifest), 'Removed from manifest after file deletion');
    }

    // --- Test 7: Protected files never flagged ---
    console.log('Test 7: Protected files never flagged');
    {
      await fs.writeFile(path.join(dataDir, 'secrets.json'), '{}');
      await fs.writeFile(path.join(dataDir, 'test.pid'), '1234');
      const nodeDir = path.join(dataDir, 'node');
      await fs.mkdir(nodeDir, { recursive: true });
      await fs.writeFile(path.join(nodeDir, 'test.exe'), 'binary');

      runScript(copiedScript, ['--report']);
      const manifest = await readManifest();

      assert(!('secrets.json' in manifest), 'secrets.json not flagged');
      assert(!('test.pid' in manifest), 'test.pid not flagged');

      const hasNodeEntry = Object.keys(manifest).some(k => k.startsWith('node'));
      assert(!hasNodeEntry, 'node/ contents not flagged');

      await fs.unlink(path.join(dataDir, 'secrets.json'));
      await fs.unlink(path.join(dataDir, 'test.pid'));
      await fs.rm(nodeDir, { recursive: true, force: true });
    }

    // --- Test 8: --check exit codes ---
    console.log('Test 8: --check exit codes');
    {
      const manifest = await readManifest();
      for (const key of Object.keys(manifest)) {
        manifest[key].status = 'watching';
        manifest[key].firstSeen = new Date().toISOString();
      }
      await writeManifest(manifest);

      const cleanResult = runScript(copiedScript, ['--check']);
      assert(cleanResult.code === 0, `Exit 0 when clean (got ${cleanResult.code})`);
      const cleanOutput = JSON.parse(cleanResult.stdout);
      assert(cleanOutput.status === 'clean', `Status clean (got ${cleanOutput.status})`);
      assert(cleanOutput.readyCount === 0, `readyCount 0 (got ${cleanOutput.readyCount})`);

      const manifest2 = await readManifest();
      manifest2['test-orphan.js'].firstSeen = daysAgoIso(20);
      await writeManifest(manifest2);

      const dirtyResult = runScript(copiedScript, ['--check']);
      assert(dirtyResult.code === 1, `Exit 1 when dirty (got ${dirtyResult.code})`);
      const dirtyOutput = JSON.parse(dirtyResult.stdout);
      assert(dirtyOutput.status === 'dirty', `Status dirty (got ${dirtyOutput.status})`);
      assert(dirtyOutput.readyCount >= 1, `readyCount >= 1 (got ${dirtyOutput.readyCount})`);
    }

    // --- Test 9: --json output ---
    console.log('Test 9: --json output');
    {
      const result = runScript(copiedScript, ['--json']);
      assert(result.code === 0, `Exit code 0 (got ${result.code})`);

      let parsed;
      try {
        parsed = JSON.parse(result.stdout);
      } catch {
        parsed = null;
      }
      assert(parsed !== null, 'Output is valid JSON');
      assert(parsed && 'manifest' in parsed, 'Has manifest field');
      assert(parsed && 'summary' in parsed, 'Has summary field');
      assert(parsed && 'timestamp' in parsed, 'Has timestamp field');
      assert(parsed?.summary && 'newCount' in parsed.summary, 'Summary has newCount');
      assert(parsed?.summary && 'readyCount' in parsed.summary, 'Summary has readyCount');
    }

    // --- Test 10: --help output ---
    console.log('Test 10: --help output');
    {
      const result = runScript(copiedScript, ['--help']);
      assert(result.code === 0, `Exit code 0 (got ${result.code})`);
      assert(result.stdout.includes('--report'), 'Help mentions --report');
      assert(result.stdout.includes('--clean'), 'Help mentions --clean');
      assert(result.stdout.includes('--detail'), 'Help mentions --detail');
      assert(result.stdout.includes('--check'), 'Help mentions --check');
      assert(result.stdout.includes('--json'), 'Help mentions --json');
    }

    // --- Test 11: Auto-flag category ---
    console.log('Test 11: Auto-flag category');
    {
      const testFile = path.join(dataDir, 'debug.bak');
      await fs.writeFile(testFile, 'backup data');

      runScript(copiedScript, ['--report']);
      const manifest = await readManifest();
      const entry = manifest['debug.bak'];

      assert(!!entry, 'debug.bak in manifest');
      assert(entry?.category === 'auto-flag', `Category auto-flag (got ${entry?.category})`);
      assert(entry?.graceDays === 3, `Grace days 3 (got ${entry?.graceDays})`);
    }

    // --- Test 12: Empty directory flagged ---
    console.log('Test 12: Empty directory flagged');
    {
      const emptyDir = path.join(dataDir, 'empty-dir');
      await fs.mkdir(emptyDir, { recursive: true });

      runScript(copiedScript, ['--report']);
      const manifest = await readManifest();
      const entry = manifest['empty-dir'];

      assert(!!entry, 'empty-dir in manifest');
      assert(entry?.category === 'auto-flag', `Category auto-flag (got ${entry?.category})`);
    }

    // --- Test 13: --clean with no ready items ---
    console.log('Test 13: --clean with no ready items');
    {
      const manifest = await readManifest();
      for (const key of Object.keys(manifest)) {
        manifest[key].status = 'watching';
        manifest[key].firstSeen = new Date().toISOString();
      }
      await writeManifest(manifest);

      const result = runScript(copiedScript, ['--clean']);
      assert(result.code === 0, `Exit code 0 (got ${result.code})`);
      assert(result.stdout.includes('Nothing ready for deletion'), 'Output mentions nothing ready');
    }

    // --- Test 14: Cleanup log format ---
    console.log('Test 14: Cleanup log format');
    {
      const logLines = await readLogLines();
      assert(logLines.length > 0, `Log has entries (${logLines.length} lines)`);

      let allValid = true;
      let allHaveFields = true;
      for (const line of logLines) {
        try {
          const entry = JSON.parse(line);
          if (!entry.timestamp || !entry.action || !entry.path) {
            allHaveFields = false;
          }
        } catch {
          allValid = false;
        }
      }
      assert(allValid, 'All log lines are valid JSON');
      assert(allHaveFields, 'All log entries have timestamp, action, path');
    }

    // --- Test 15: Case-insensitive known manifest ---
    console.log('Test 15: Case-insensitive known manifest');
    {
      const testFile = path.join(dataDir, 'Model-Registry.JSON');
      await fs.writeFile(testFile, '{"test": true}');

      runScript(copiedScript, ['--report']);
      const manifest = await readManifest();

      assert(!('Model-Registry.JSON' in manifest), 'Model-Registry.JSON not in manifest (recognized as known manifest)');

      await fs.unlink(testFile);
    }

    // --- Test 16: Case-insensitive protected ---
    console.log('Test 16: Case-insensitive protected');
    {
      const testFile = path.join(dataDir, 'Secrets.JSON');
      await fs.writeFile(testFile, '{"key": "value"}');

      runScript(copiedScript, ['--report']);
      const manifest = await readManifest();

      assert(!('Secrets.JSON' in manifest), 'Secrets.JSON not in manifest (recognized as protected)');

      await fs.unlink(testFile);
    }

    // --- Test 17: Case-insensitive backups dir ---
    console.log('Test 17: Case-insensitive backups dir');
    {
      const backupsDir = path.join(dataDir, 'Backups');
      await fs.mkdir(backupsDir, { recursive: true });
      const testFile = path.join(backupsDir, 'test.json');
      await fs.writeFile(testFile, '{"backup": true}');

      runScript(copiedScript, ['--report']);
      const manifest = await readManifest();

      const hasBackupEntry = Object.keys(manifest).some(k => k.includes('test.json'));
      assert(hasBackupEntry, 'Backups/test.json in manifest (script recursed into uppercase Backups dir)');

      await fs.unlink(testFile);
      await fs.rm(backupsDir, { recursive: true, force: true });
    }

    // --- Test 18: Stale .tmp file cleanup ---
    console.log('Test 18: Stale .tmp file cleanup');
    {
      const tmpFile = path.join(dataDir, 'quarantine-manifest.json.tmp');
      await fs.writeFile(tmpFile, 'garbage data from crashed run');

      const result = runScript(copiedScript, ['--report']);
      assert(result.code === 0, `Script didn't crash with stale .tmp (exit ${result.code})`);

      const manifest = await readManifest();
      assert(Object.keys(manifest).length > 0, 'Manifest written correctly despite stale .tmp');

      let tmpExists = true;
      try {
        await fs.access(tmpFile);
      } catch {
        tmpExists = false;
      }
      assert(!tmpExists, 'Stale .tmp file removed after successful run');
    }

  } finally {
    await fs.rm(sandbox, { recursive: true, force: true });
  }

  let sandboxExists = true;
  try {
    await fs.access(sandbox);
  } catch {
    sandboxExists = false;
  }

  console.log('');
  console.log('============================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`Sandbox cleaned up: ${!sandboxExists ? 'yes' : 'NO — still exists!'}`);

  if (failed > 0 || sandboxExists) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
