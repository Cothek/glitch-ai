#!/usr/bin/env node

// Usage:
//   node scripts/audit-root.mjs           Interactive mode — scan and prompt
//   node scripts/audit-root.mjs --check   Exit 0 (clean) / 1 (dirty), JSON to stdout
//   node scripts/audit-root.mjs --json    Full JSON output
//   node scripts/audit-root.mjs --force   Skip 24h cache

import { promises as fs } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import readline from 'readline';

const ROOT_DIR = process.cwd();
const STATE_FILE = path.join(ROOT_DIR, 'data', 'audit-root-state.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const KNOWN_MANIFEST = new Set([
  '.agents/',
  '.env.example',
  '.git/',
  '.gitignore',
  '.gitmodules',
  '.opencode/',
  '.server-password',
  'config/',
  'data/',
  'glitch-head.txt',
  'glitch-memorycore/',
  'handy-voice/',
  'launch-glitch.bat',
  'launch-glitch.sh',
  'opencode.json',
  'opencode/',
  'plugins/',
  'queue.db',
  'README.md',
  'reports/',
  'screenshots/',
  'scripts/',
  'tools/',
  'user/',
]);

const COMMON_IGNORE = [
  /.*\.log$/i, /^node_modules(\/|$)/i, /^\.env$/i, /^\.env\..+/i,
  /.*\.tmp$/i, /^dist(\/|$)/i, /^build(\/|$)/i, /^\.DS_Store$/i,
  /^\.next(\/|$)/i, /^out(\/|$)/i, /^\.turbo(\/|$)/i,
  /^package-lock\.json$/i, /.*\.tsbuildinfo$/i, /.*\.swp$/i,
  /^coverage(\/|$)/i, /^\.nyc_output(\/|$)/i, /^\.vscode(\/|$)/i,
  /^\.idea(\/|$)/i, /^__pycache__(\/|$)/i, /.*\.pyc$/i,
  /^\.pytest_cache(\/|$)/i, /^target(\/|$)/i, /^\.gradle(\/|$)/i,
];

function humanSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), u.length - 1);
  const v = bytes / Math.pow(1024, i);
  return `${i === 0 ? v : v.toFixed(1)} ${u[i]}`;
}

function formatDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function parseFileNumbers(input, max) {
  if (!input || !input.trim()) return null;
  const nums = new Set();
  for (const part of input.split(',').map(s => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) {
      const s = +m[1], e = +m[2];
      if (s < 1 || e > max || s > e) return null;
      for (let i = s; i <= e; i++) nums.add(i);
    } else {
      const n = +part;
      if (isNaN(n) || n < 1 || n > max) return null;
      nums.add(n);
    }
  }
  const result = [...nums].sort((a, b) => a - b);
  return result.length ? result : null;
}

function git(args) {
  try {
    const cmd = `git ${args}`;
    const out = execSync(cmd, { cwd: ROOT_DIR, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1024 * 1024 });
    return out.trim();
  } catch {
    return null;
  }
}

function hasGitRepo() {
  return git('rev-parse --git-dir') !== null;
}

function isGitIgnored(relPath) {
  return git(`check-ignore -- "${relPath}"`) !== null;
}

function isTracked(relPath) {
  return git(`ls-files --error-unmatch -- "${relPath}"`) !== null;
}

function dirHasTrackedFiles(relPath) {
  const out = git(`ls-files -- "${relPath}/"`);
  return out !== null && out.length > 0;
}

function matchesCommonPatterns(name) {
  return COMMON_IGNORE.some(p => p.test(name) || p.test(name + '/'));
}

async function readState() {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    const s = JSON.parse(raw);
    return {
      lastCheck: s.lastCheck || null,
      knownExtra: Array.isArray(s.knownExtra) ? s.knownExtra : [],
      ignored: Array.isArray(s.ignored) ? s.ignored : [],
    };
  } catch {
    return { lastCheck: null, knownExtra: [], ignored: [] };
  }
}

async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

async function scanDirectory(force, skipCache = false) {
  const state = await readState();

  if (!force && !skipCache && state.lastCheck) {
    const age = Date.now() - new Date(state.lastCheck).getTime();
    if (age < CACHE_TTL_MS) {
      return { files: [], state, gitOk: false, cached: true };
    }
  }

  const gitOk = hasGitRepo();
  const entries = await fs.readdir(ROOT_DIR, { withFileTypes: true });
  const mergedKnown = new Set(KNOWN_MANIFEST);
  for (const k of state.knownExtra) mergedKnown.add(k);
  const ignoredSet = new Set(state.ignored);
  const files = [];

  for (const entry of entries) {
    const name = entry.name;

    if (name === '.git' || mergedKnown.has(name) || ignoredSet.has(name)) continue;

    let stat;
    try {
      stat = await fs.stat(path.join(ROOT_DIR, name));
    } catch {
      continue;
    }

    const isDir = stat.isDirectory();

    if (gitOk) {
      if (isGitIgnored(name)) continue;
      if (isTracked(name)) continue;
      if (isDir && dirHasTrackedFiles(name)) continue;
    } else {
      if (matchesCommonPatterns(name)) continue;
    }

    files.push({
      name,
      path: isDir ? name + '/' : name,
      size: stat.size,
      mtime: stat.mtime,
      isDir,
      reason: gitOk
        ? (isDir ? 'Untracked directory' : 'Not tracked / not ignored')
        : 'Not in known manifest',
    });
  }

  state.lastCheck = new Date().toISOString();
  await writeState(state);
  return { files, state, gitOk, cached: false };
}

function renderTable(files, gitOk, rootDir) {
  const title = 'Root Directory Audit';
  const w = Math.max(66, rootDir.length + 6);
  console.log(`+${'='.repeat(w)}+`);
  console.log(`|  ${title.padEnd(w - 4)}  |`);
  console.log(`|  ${rootDir.padEnd(w - 4)}  |`);
  console.log(`+${'='.repeat(w)}+`);

  if (!gitOk) {
    console.log('\n!! Git not available -- using manifest-only filtering (limited accuracy).\n');
  }

  if (files.length === 0) {
    console.log('\nNo untracked files found. The project root is clean.\n');
    return;
  }

  const nameW = Math.max(4, ...files.map(f => f.name.length + (f.isDir ? 1 : 0)));

  console.log(`\nFound ${files.length} untracked file${files.length === 1 ? '' : 's'} not in the known project structure:\n`);

  const hdr = `  #  ${'File'.padEnd(nameW)}  ${'Size'.padStart(10)}  ${'Modified'.padEnd(19)}  Reason`;
  const div = ` ${'-'.repeat(3)} ${'-'.repeat(nameW)} ${'-'.repeat(10)} ${'-'.repeat(19)} ${'-'.repeat(25)}`;
  console.log(hdr);
  console.log(div);

  files.forEach((f, i) => {
    const n = String(i + 1).padStart(2);
    const fn = (f.isDir ? f.name + '/' : f.name).padEnd(nameW);
    const sz = humanSize(f.size).padStart(10);
    const mt = formatDate(f.mtime);
    console.log(`  ${n}  ${fn}  ${sz}  ${mt}  ${f.reason}`);
  });
  console.log();
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function confirmDelete(count) {
  const a = await ask(`Delete ${count} file${count === 1 ? '' : 's'}? [y/N] `);
  const lowered = a.toLowerCase();
  return lowered === 'y' || lowered === 'yes';
}

async function deleteFiles(list) {
  const deleted = [];
  const failed = [];
  for (const f of list) {
    try {
      await fs.rm(path.join(ROOT_DIR, f.name), { recursive: true, force: true });
      deleted.push(f.name);
    } catch (e) {
      if (e.code === 'ENOENT') {
        deleted.push(f.name);
      } else {
        failed.push({ name: f.name, error: e.message });
      }
    }
  }
  console.log(`\nDeleted ${deleted.length} file${deleted.length === 1 ? '' : 's'}.`);
  if (failed.length > 0) {
    failed.forEach(f => console.log(`  Failed: ${f.name} -- ${f.error}`));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const checkMode = args.includes('--check');
  const force = args.includes('--force');
  const jsonMode = args.includes('--json');
  const interactive = !checkMode && !jsonMode;

  const { files, state, gitOk, cached } = await scanDirectory(force, checkMode);

  // --check: exit code based on dirtiness, JSON summary to stdout
  if (checkMode) {
    const report = {
      status: files.length === 0 ? 'clean' : 'dirty',
      count: files.length,
    };
    if (files.length > 0) {
      report.files = files.map(f => f.path);
    }
    process.stdout.write(JSON.stringify(report) + '\n');
    process.exit(report.status === 'clean' ? 0 : 1);
  }

  // --json: full JSON dump, exit 0
  if (jsonMode) {
    const output = {
      timestamp: new Date().toISOString(),
      cached,
      gitAvailable: gitOk,
      total: files.length,
      items: files.map(f => ({
        name: f.name,
        path: f.path,
        size: f.size,
        sizeHuman: humanSize(f.size),
        modified: formatDate(f.mtime),
        isDirectory: f.isDir,
        reason: f.reason,
      })),
    };
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    process.exit(0);
  }

  // Interactive mode
  if (cached && files.length === 0) {
    console.log('(Project was recently audited. Use --force to re-scan.)');
    process.exit(0);
  }

  renderTable(files, gitOk, ROOT_DIR);
  if (files.length === 0) process.exit(0);

  while (true) {
    const choice = (await ask('Enter choice (a/s/i/k/q): ')).toLowerCase();

    if (choice === 'q') {
      console.log('Exiting without changes.');
      process.exit(0);
    }

    if (choice === 'a') {
      if (!(await confirmDelete(files.length))) continue;
      await deleteFiles(files);
      process.exit(0);
    }

    if (choice === 's') {
      const raw = await ask('Enter file numbers to delete (e.g., 1,3 or 1-3): ');
      const nums = parseFileNumbers(raw, files.length);
      if (!nums || nums.length === 0) {
        console.log('Invalid input. Use format like 1,3 or 1-3.');
        continue;
      }
      const selected = nums.map(i => files[i - 1]);
      if (!(await confirmDelete(selected.length))) continue;
      await deleteFiles(selected);
      process.exit(0);
    }

    if (choice === 'i') {
      const raw = await ask('Enter file numbers to ignore (e.g., 1,3): ');
      const nums = parseFileNumbers(raw, files.length);
      if (!nums || nums.length === 0) {
        console.log('Invalid input.');
        continue;
      }
      const names = nums.map(i => files[i - 1].name);
      state.ignored = [...new Set([...state.ignored, ...names])];
      await writeState(state);
      console.log(`Added ${names.length} file${names.length === 1 ? '' : 's'} to ignore list.`);
      process.exit(0);
    }

    if (choice === 'k') {
      const raw = await ask('Enter file numbers to keep forever (e.g., 1,3): ');
      const nums = parseFileNumbers(raw, files.length);
      if (!nums || nums.length === 0) {
        console.log('Invalid input.');
        continue;
      }
      const names = nums.map(i => files[i - 1].name);
      state.knownExtra = [...new Set([...state.knownExtra, ...names])];
      await writeState(state);
      console.log(`Added ${names.length} file${names.length === 1 ? '' : 's'} to known manifest.`);
      process.exit(0);
    }

    console.log('Invalid choice. Enter a, s, i, k, or q.');
  }
}

main().catch(e => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});