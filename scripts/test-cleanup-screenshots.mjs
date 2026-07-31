// scripts/test-cleanup-screenshots.mjs
// Tests for the screenshot cleanup script.
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

async function listFiles(dir) {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

async function setMtime(filePath, ageMs) {
  const t = new Date(Date.now() - ageMs);
  await fs.utimes(filePath, t, t);
}

async function main() {
  console.log('Cleanup Screenshots Tests');
  console.log('=========================');

  const sandbox = path.join(os.tmpdir(), `opencode-test-cleanup-${process.pid}`);
  const screenshotsDir = path.join(sandbox, 'data', 'screenshots');
  const copiedScript = path.join(sandbox, 'scripts', 'cleanup-screenshots.mjs');

  try {
    await fs.mkdir(screenshotsDir, { recursive: true });
    await fs.mkdir(path.dirname(copiedScript), { recursive: true });
    await fs.copyFile(
      path.join(__dirname, 'cleanup-screenshots.mjs'),
      copiedScript,
    );

    // --- Test 1: Old file is deleted ---
    console.log('Test 1: File older than --days N is deleted');
    {
      const days = 7;
      const oldFile = path.join(screenshotsDir, 'old-image.png');
      await fs.writeFile(oldFile, 'old data');
      await setMtime(oldFile, (days + 2) * 86400000);

      const result = runScript(copiedScript, ['--days', String(days)]);
      const remaining = await listFiles(screenshotsDir);

      assert(result.code === 0, `Exit code 0 (got ${result.code})`);
      assert(!remaining.includes('old-image.png'), 'old-image.png was deleted');

      await fs.unlink(oldFile).catch(() => {});
    }

    // --- Test 2: New file is kept ---
    console.log('Test 2: File newer than --days N is kept');
    {
      const days = 7;
      const newFile = path.join(screenshotsDir, 'new-image.png');
      await fs.writeFile(newFile, 'new data');
      await setMtime(newFile, 60000);

      runScript(copiedScript, ['--days', String(days)]);
      const remaining = await listFiles(screenshotsDir);

      assert(remaining.includes('new-image.png'), 'new-image.png was kept');

      await fs.unlink(newFile).catch(() => {});
    }

    // --- Test 3: Protected files always preserved ---
    console.log('Test 3: manifest.json and NEW_IMAGE_FLAG always preserved');
    {
      const manifest = path.join(screenshotsDir, 'manifest.json');
      const flag = path.join(screenshotsDir, 'NEW_IMAGE_FLAG');
      await fs.writeFile(manifest, '{}');
      await fs.writeFile(flag, 'flag');
      await setMtime(manifest, 999 * 86400000);
      await setMtime(flag, 999 * 86400000);

      runScript(copiedScript, ['--days', '1']);
      const remaining = await listFiles(screenshotsDir);

      assert(remaining.includes('manifest.json'), 'manifest.json preserved at 999 days old');
      assert(remaining.includes('NEW_IMAGE_FLAG'), 'NEW_IMAGE_FLAG preserved at 999 days old');

      await fs.unlink(manifest).catch(() => {});
      await fs.unlink(flag).catch(() => {});
    }

    // --- Test 4: --dry-run deletes nothing ---
    console.log('Test 4: --dry-run deletes nothing');
    {
      const file1 = path.join(screenshotsDir, 'dry-run-test.png');
      await fs.writeFile(file1, 'data');
      await setMtime(file1, 30 * 86400000);

      const result = runScript(copiedScript, ['--days', '1', '--dry-run']);
      const remaining = await listFiles(screenshotsDir);

      assert(remaining.includes('dry-run-test.png'), 'File still present after --dry-run');
      assert(result.stdout.includes('DRY RUN'), 'Output says DRY RUN');

      await fs.unlink(file1).catch(() => {});
    }

    // --- Test 5: Invalid --days exits 1 ---
    console.log('Test 5: Invalid --days value exits 1');
    {
      const result = runScript(copiedScript, ['--days', 'abc']);
      assert(result.code === 1, `Exit code 1 for --days abc (got ${result.code})`);
      assert(result.stderr.includes('Invalid'), 'Stderr mentions invalid value');
    }

    // --- Test 6: Missing directory exits 0 ---
    console.log('Test 6: Missing directory exits 0');
    {
      await fs.rm(screenshotsDir, { recursive: true, force: true });
      const result = runScript(copiedScript);
      assert(result.code === 0, `Exit code 0 for missing dir (got ${result.code})`);
      assert(
        result.stdout.includes('Nothing to clean') || result.stdout.includes('not found'),
        'Stdout mentions nothing-to-clean or not found',
      );
      await fs.mkdir(screenshotsDir, { recursive: true });
    }

    // --- Test 7: Subdirectory not recursed ---
    console.log('Test 7: Subdirectory is not recursed into');
    {
      const subdir = path.join(screenshotsDir, 'subdir');
      await fs.mkdir(subdir);
      const oldInSubdir = path.join(subdir, 'ancient.png');
      await fs.writeFile(oldInSubdir, 'ancient');
      await setMtime(oldInSubdir, 999 * 86400000);

      runScript(copiedScript, ['--days', '1']);

      const remaining = await listFiles(screenshotsDir);
      assert(remaining.includes('subdir'), 'Subdirectory still present');

      const subContents = await listFiles(subdir);
      assert(subContents.includes('ancient.png'), 'File inside subdir still present');

      await fs.rm(subdir, { recursive: true, force: true });
    }

    // --- Test 8: Default 14 days ---
    console.log('Test 8: Default behavior uses 14 days');
    {
      const old15 = path.join(screenshotsDir, 'fifteen-days.png');
      const fresh1 = path.join(screenshotsDir, 'one-day.png');
      await fs.writeFile(old15, 'old');
      await fs.writeFile(fresh1, 'fresh');
      await setMtime(old15, 15 * 86400000);
      await setMtime(fresh1, 1 * 86400000);

      runScript(copiedScript);
      const remaining = await listFiles(screenshotsDir);

      assert(!remaining.includes('fifteen-days.png'), '15-day-old file deleted (default 14 days)');
      assert(remaining.includes('one-day.png'), '1-day-old file kept (default 14 days)');

      await fs.unlink(old15).catch(() => {});
      await fs.unlink(fresh1).catch(() => {});
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
  console.log('=========================');
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
