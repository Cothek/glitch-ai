#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'audit-data-review.mjs');

async function mkTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'audit-data-review-test-'));
}

async function rmTempDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

async function writeFile(fp, content = '') {
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, content, 'utf8');
}

async function setMtime(fp, daysAgo) {
  const t = new Date(Date.now() - daysAgo * 86400000);
  await fs.utimes(fp, t, t);
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  return fn().then(
    () => { passed++; console.log(`  ✓ ${name}`); },
    (e) => { failed++; console.log(`  ✗ ${name}`); console.log(`    ${e.message}`); }
  );
}

async function main() {
  console.log('TAP version 13');
  console.log(`# audit-data-review.mjs tests`);

  const tmp = await mkTempDir();
  const dataDir = path.join(tmp, 'data');
  await fs.mkdir(dataDir, { recursive: true });

  await writeFile(path.join(dataDir, 'secrets.json'), '{"test":true}');
  await writeFile(path.join(dataDir, 'agent-tier.json'), '{"tier":"paid"}');
  await writeFile(path.join(dataDir, 'opencode.pid'), '12345');
  await writeFile(path.join(dataDir, '.review-pass.json'), '{}');
  await writeFile(path.join(dataDir, 'test-node.mjs'), 'console.log("hi")');
  await writeFile(path.join(dataDir, 'test.txt'), 'hello');
  await writeFile(path.join(dataDir, 'append-shopping.js'), 'console.log("shop")');
  await writeFile(path.join(dataDir, 'bootstrap.log'), 'log data');
  await writeFile(path.join(dataDir, 'auth-proxy.log'), 'proxy log');
  await writeFile(path.join(dataDir, '.stuck-signal.ses_test123.json'), '{"stuck":true}');
  await setMtime(path.join(dataDir, '.stuck-signal.ses_test123.json'), 14);
  await writeFile(path.join(dataDir, '.stuck-signal.ses_recent.json'), '{"stuck":false}');
  await setMtime(path.join(dataDir, '.stuck-signal.ses_recent.json'), 2);

  await fs.mkdir(path.join(dataDir, 'node.old'), { recursive: true });
  await writeFile(path.join(dataDir, 'node.old', 'node.exe'), 'fake-binary-data-here');

  await fs.mkdir(path.join(dataDir, 'test-copy-overwrite'), { recursive: true });
  await writeFile(path.join(dataDir, 'test-copy-overwrite', 'leftover.txt'), 'leftover');

  await fs.mkdir(path.join(dataDir, 'screenshots'), { recursive: true });
  await writeFile(path.join(dataDir, 'screenshots', 'img1.png'), 'png-data');
  await setMtime(path.join(dataDir, 'screenshots', 'img1.png'), 60);
  await writeFile(path.join(dataDir, 'screenshots', 'img2.png'), 'png-data-2');
  await setMtime(path.join(dataDir, 'screenshots', 'img2.png'), 10);

  await fs.mkdir(path.join(dataDir, 'backups'), { recursive: true });
  for (let i = 0; i < 5; i++) {
    await writeFile(path.join(dataDir, 'backups', `backup-${i}.tar.gz`), `backup-data-${i}`);
    await setMtime(path.join(dataDir, 'backups', `backup-${i}.tar.gz`), 30 + i * 10);
  }

  await fs.mkdir(path.join(dataDir, 'samples'), { recursive: true });
  await writeFile(path.join(dataDir, 'samples', 'design.html'), '<html>');
  await fs.mkdir(path.join(dataDir, 'reports'), { recursive: true });
  await writeFile(path.join(dataDir, 'reports', 'security.pdf'), 'pdf-data');
  await fs.mkdir(path.join(dataDir, 'tools'), { recursive: true });
  await writeFile(path.join(dataDir, 'tools', 'sqlite.exe'), 'exe-data');

  await fs.mkdir(path.join(dataDir, 'plans'), { recursive: true });
  await writeFile(path.join(dataDir, 'plans', 'q4.md'), '# Q4 plan');

  await fs.mkdir(path.join(dataDir, 'node'), { recursive: true });
  await writeFile(path.join(dataDir, 'node', 'node.exe'), 'real-node');
  await fs.mkdir(path.join(dataDir, 'gh-cli'), { recursive: true });
  await writeFile(path.join(dataDir, 'gh-cli', 'gh.exe'), 'gh-binary');

  const jsonOut = execSync(
    `node "${SCRIPT}" --json --data-dir "${dataDir}"`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  const report = JSON.parse(jsonOut);

  await test('report has expected top-level fields', async () => {
    assert.ok(report.totalSize !== undefined, 'totalSize missing');
    assert.ok(report.entryCount !== undefined, 'entryCount missing');
    assert.ok(report.candidateCount !== undefined, 'candidateCount missing');
    assert.ok(report.reclaimable !== undefined, 'reclaimable missing');
    assert.ok(report.categories, 'categories missing');
  });

  await test('secrets.json is KEEP (protected runtime)', async () => {
    const rt = report.categories.runtime || {};
    const item = (rt.items || []).find(i => i.name === 'secrets.json');
    assert.ok(item, 'secrets.json not found in runtime');
    assert.strictEqual(item.recommendation, 'KEEP');
    assert.strictEqual(item.protected, true);
  });

  await test('node/ is KEEP (protected runtime)', async () => {
    const rt = report.categories.runtime || {};
    const item = (rt.items || []).find(i => i.name === 'node');
    assert.ok(item, 'node/ not found in runtime');
    assert.strictEqual(item.recommendation, 'KEEP');
  });

  await test('opencode.pid is KEEP (protected .pid ext)', async () => {
    const rt = report.categories.runtime || {};
    const item = (rt.items || []).find(i => i.name === 'opencode.pid');
    assert.ok(item, 'opencode.pid not found in runtime');
    assert.strictEqual(item.recommendation, 'KEEP');
  });

  await test('node.old/ is CLEANUP CANDIDATE (stale artifact)', async () => {
    const art = report.categories.artifacts || {};
    const item = (art.items || []).find(i => i.name === 'node.old');
    assert.ok(item, 'node.old not found in artifacts');
    assert.strictEqual(item.recommendation, 'CLEANUP CANDIDATE');
    assert.ok(item.note.includes('stale'), `expected stale note, got: ${item.note}`);
  });

  await test('test-copy-overwrite/ is CLEANUP CANDIDATE (stale artifact)', async () => {
    const art = report.categories.artifacts || {};
    const item = (art.items || []).find(i => i.name === 'test-copy-overwrite');
    assert.ok(item, 'test-copy-overwrite not found in artifacts');
    assert.strictEqual(item.recommendation, 'CLEANUP CANDIDATE');
  });

  await test('stale .stuck-signal.ses_ (14d) is CLEANUP CANDIDATE', async () => {
    const ts = report.categories['temp-scratch'] || {};
    const item = (ts.items || []).find(i => i.name === '.stuck-signal.ses_test123.json');
    assert.ok(item, 'stale stuck signal not found');
    assert.strictEqual(item.recommendation, 'CLEANUP CANDIDATE');
  });

  await test('recent .stuck-signal.ses_ (2d) is KEEP', async () => {
    const ts = report.categories['temp-scratch'] || {};
    const item = (ts.items || []).find(i => i.name === '.stuck-signal.ses_recent.json');
    assert.ok(item, 'recent stuck signal not found');
    assert.strictEqual(item.recommendation, 'KEEP');
  });

  await test('samples/ is INFO (recent-move)', async () => {
    const rm = report.categories['recent-move'] || {};
    const item = (rm.items || []).find(i => i.name === 'samples');
    assert.ok(item, 'samples/ not found in recent-move');
    assert.strictEqual(item.recommendation, 'INFO');
  });

  await test('reports/ is INFO (recent-move)', async () => {
    const rm = report.categories['recent-move'] || {};
    const item = (rm.items || []).find(i => i.name === 'reports');
    assert.ok(item, 'reports/ not found in recent-move');
    assert.strictEqual(item.recommendation, 'INFO');
  });

  await test('tools/ is INFO (recent-move)', async () => {
    const rm = report.categories['recent-move'] || {};
    const item = (rm.items || []).find(i => i.name === 'tools');
    assert.ok(item, 'tools/ not found in recent-move');
    assert.strictEqual(item.recommendation, 'INFO');
  });

  await test('plans/ is KEEP (user-data)', async () => {
    const ud = report.categories['user-data'] || {};
    const item = (ud.items || []).find(i => i.name === 'plans');
    assert.ok(item, 'plans/ not found in user-data');
    assert.strictEqual(item.recommendation, 'KEEP');
  });

  await test('test-node.mjs is CLEANUP CANDIDATE (temp-scratch)', async () => {
    const ts = report.categories['temp-scratch'] || {};
    const item = (ts.items || []).find(i => i.name === 'test-node.mjs');
    assert.ok(item, 'test-node.mjs not found in temp-scratch');
    assert.strictEqual(item.recommendation, 'CLEANUP CANDIDATE');
  });

  await test('backups/ is REVIEW with count note', async () => {
    const art = report.categories.artifacts || {};
    const item = (art.items || []).find(i => i.name === 'backups');
    assert.ok(item, 'backups/ not found in artifacts');
    assert.strictEqual(item.recommendation, 'REVIEW');
    assert.ok(item.note.includes('backups'), `expected backups note, got: ${item.note}`);
  });

  await test('screenshots/ is REVIEW with cleanup note', async () => {
    const art = report.categories.artifacts || {};
    const item = (art.items || []).find(i => i.name === 'screenshots');
    assert.ok(item, 'screenshots/ not found in artifacts');
    assert.strictEqual(item.recommendation, 'REVIEW');
    assert.ok(item.note.includes('cleanup-screenshots'), `expected cleanup note, got: ${item.note}`);
  });

  await test('bootstrap.log is REVIEW (known manifest, not cleanup)', async () => {
    const art = report.categories.artifacts || {};
    const item = (art.items || []).find(i => i.name === 'bootstrap.log');
    assert.ok(item, 'bootstrap.log not found in artifacts');
    assert.notStrictEqual(item.recommendation, 'CLEANUP CANDIDATE', `bootstrap.log should not be cleanup, got: ${item.recommendation}`);
    assert.strictEqual(item.protected, true, 'bootstrap.log should be protected');
  });

  await test('auth-proxy.log is REVIEW (known manifest, not cleanup)', async () => {
    const art = report.categories.artifacts || {};
    const item = (art.items || []).find(i => i.name === 'auth-proxy.log');
    assert.ok(item, 'auth-proxy.log not found in artifacts');
    assert.notStrictEqual(item.recommendation, 'CLEANUP CANDIDATE', `auth-proxy.log should not be cleanup, got: ${item.recommendation}`);
    assert.strictEqual(item.protected, true, 'auth-proxy.log should be protected');
  });

  await test('text report renders without crash', async () => {
    const textOut = execSync(
      `node "${SCRIPT}" --data-dir "${dataDir}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    assert.ok(textOut.includes('# data/ Review Report'), 'missing header');
    assert.ok(textOut.includes('Runtime'), 'missing runtime section');
    assert.ok(textOut.includes('Deletion is handled by'), 'missing footer');
  });

  await test('candidateCount > 0 (node.old, test-copy-overwrite, temp files)', async () => {
    assert.ok(report.candidateCount > 0, `expected candidates, got ${report.candidateCount}`);
  });

  await test('reclaimable > 0', async () => {
    assert.ok(report.reclaimable > 0, `expected reclaimable > 0, got ${report.reclaimable}`);
  });

  await test('--mark-reviewed creates last-data-review.json', async () => {
    execSync(
      `node "${SCRIPT}" --mark-reviewed --data-dir "${dataDir}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const raw = await fs.readFile(path.join(dataDir, 'last-data-review.json'), 'utf8');
    const parsed = JSON.parse(raw);
    assert.ok(parsed.lastReview, 'lastReview missing');
    const then = new Date(parsed.lastReview).getTime();
    assert.ok(!isNaN(then), 'invalid timestamp');
    assert.ok(Date.now() - then < 5000, 'timestamp not recent');
  });

  await test('missing data/ handled gracefully', async () => {
    const out = execSync(
      `node "${SCRIPT}" --json --data-dir "${path.join(tmp, 'nonexistent')}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.missing, true);
  });

  await rmTempDir(tmp);

  console.log('');
  console.log(`# ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error(`Test runner error: ${e.message}`);
  process.exit(1);
});
