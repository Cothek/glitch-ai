#!/usr/bin/env node

/**
 * Shared git repo sync module - branch-aware update checking for all Glitch launch scripts.
 *
 * Replaces the old syncMainRepo() pattern that only worked on `main` branch.
 * Now: detects ANY branch, checks its upstream, checks for updates, prompts the user.
 *
 * Exports:
 *   checkRepoUpdates(options)   -- Check glitch-ai repo for updates, prompt if interactive
 *   checkUserRepoUpdates(options) -- Check user/ repo for updates, prompt if interactive
 *
 * Options:
 *   cwd                         -- Repo root (default: process.cwd())
 *   interactive                 -- Show prompts (default: true)
 *   allowBranchSwitch           -- Show "switch to main" option (default: true)
 *   quiet                       -- Suppress "up-to-date" logging (default: false)
 */

import { execFileSync } from 'child_process';
import { createInterface } from 'readline';
import { existsSync } from 'fs';
import { join } from 'path';

// ===== Cross-platform helpers =====

const isWin = process.platform === 'win32';

function log(color, msg) {
  if (msg === undefined) {
    console.log(color);
  } else {
    console.log(`${color}${msg}\x1b[0m`);
  }
}

function run(cmd, args, opts = {}) {
  try {
    // On Windows, .cmd/.bat must run through cmd.exe explicitly
    if (isWin && (cmd.endsWith('.cmd') || cmd.endsWith('.bat'))) {
      args = ['/d', '/s', '/c', cmd, ...args];
      cmd = 'cmd.exe';
    }
    const out = execFileSync(cmd, args, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      ...opts,
    });
    return { success: true, stdout: (out || '').toString().trim(), status: 0 };
  } catch (e) {
    return {
      success: false,
      stdout: ((e.stdout || '')).toString().trim(),
      stderr: ((e.stderr || '')).toString().trim(),
      error: e.message || String(e),
      status: e.status,
    };
  }
}

function askQuestion(query) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// ===== Color constants =====

const C = {
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  DARK_GREEN: '\x1b[32;2m',
  DARK_YELLOW: '\x1b[33;2m',
  DARK_GRAY: '\x1b[90m',
  WHITE: '\x1b[37m',
};

// ===== Core logic =====

/**
 * Get the current git branch name.
 * @param {string} cwd
 * @returns {{ branch: string|null, isDetached: boolean }}
 */
function getCurrentBranch(cwd) {
  const r = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 5000 });
  if (!r.success) return { branch: null, isDetached: false };
  const b = r.stdout.trim();
  if (b === 'HEAD') return { branch: null, isDetached: true };
  return { branch: b, isDetached: false };
}

/**
 * Check if an upstream tracking branch exists.
 * @returns {boolean}
 */
function hasUpstream(cwd, branch) {
  const r = run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{u}`], { cwd, timeout: 5000 });
  return r.success && r.stdout.trim().length > 0;
}

/**
 * Fetch all branches from origin.
 * @returns {boolean}
 */
function fetchOrigin(cwd) {
  const r = run('git', ['fetch', 'origin'], { cwd, timeout: 30000 });
  return r.success;
}

/**
 * Get behind/ahead counts for a branch vs its remote.
 * @returns {{ behind: number, ahead: number }|null}
 */
function getBehindAhead(cwd, branch) {
  const upstreamRef = `origin/${branch}`;

  const behindR = run('git', ['rev-list', '--count', `HEAD..${upstreamRef}`], { cwd, timeout: 10000 });
  if (!behindR.success || !/^\d+$/.test(behindR.stdout)) return null;
  const behind = parseInt(behindR.stdout, 10);

  const aheadR = run('git', ['rev-list', '--count', `${upstreamRef}..HEAD`], { cwd, timeout: 10000 });
  const ahead = aheadR.success && /^\d+$/.test(aheadR.stdout) ? parseInt(aheadR.stdout, 10) : 0;

  return { behind, ahead };
}

/**
 * Fast-forward pull the current branch.
 * @returns {boolean}
 */
function pullBranch(cwd, branch) {
  const r = run('git', ['pull', '--ff-only', 'origin', branch], { cwd, timeout: 30000 });
  return r.success;
}

/**
 * Update submodules.
 */
function syncSubmodules(cwd) {
  run('git', ['submodule', 'update', '--init', '--recursive'], { cwd, timeout: 60000 });
}

/**
 * Check if working tree is dirty (has uncommitted changes).
 * @returns {boolean}
 */
function isDirty(cwd) {
  const r = run('git', ['status', '--porcelain'], { cwd, timeout: 5000 });
  return r.success && r.stdout.trim().length > 0;
}

/**
 * Switch to main branch, stashing changes first if dirty.
 * @returns {boolean}
 */
function switchToMain(cwd, currentBranch) {
  if (isDirty(cwd)) {
    log(C.YELLOW, '  Local changes detected, stashing...');
    run('git', ['stash', 'push', '-m', `glitch-auto-stash: ${currentBranch}`], { cwd, timeout: 15000 });
  }
  const r = run('git', ['checkout', 'main'], { cwd, timeout: 30000 });
  return r.success;
}

/**
 * Get list of modified tracked files (diff --name-only).
 * @returns {string[]}
 */
function getModifiedFiles(cwd) {
  const r = run('git', ['diff', '--name-only'], { cwd, timeout: 10000 });
  if (!r.success || !r.stdout) return [];
  return r.stdout.split('\n').filter(l => l.trim().length > 0);
}

/**
 * Discard local changes to tracked files (git restore .).
 */
function discardChanges(cwd) {
  run('git', ['restore', '.'], { cwd, timeout: 15000 });
}

/**
 * Switch to a specific branch, stashing changes first if dirty.
 * @returns {boolean}
 */
function switchBranch(cwd, targetBranch, sourceBranch) {
  if (isDirty(cwd)) {
    log(C.YELLOW, '  Local changes detected, stashing...');
    run('git', ['stash', 'push', '-m', `glitch-auto-stash: ${sourceBranch}`], { cwd, timeout: 15000 });
  }
  const r = run('git', ['checkout', targetBranch], { cwd, timeout: 30000 });
  return r.success;
}

// ===== Exported functions =====

/**
 * Check a git repo for updates. Prompts interactively if updates found.
 *
 * @param {Object} options
 * @param {string} [options.cwd] - Repo root (default: process.cwd())
 * @param {string} [options.label='Repo'] - Display label for logs
 * @param {boolean} [options.interactive=true] - Show prompts
 * @param {boolean} [options.allowBranchSwitch=true] - Show "switch to main" option
 * @param {boolean} [options.quiet=false] - Suppress "up-to-date" logs
 * @returns {Promise<{ checked: boolean, updated: boolean, switchedBranch: boolean }>}
 */
export async function checkRepoUpdates(options = {}) {
  const {
    cwd = process.cwd(),
    label = 'Repo',
    interactive = true,
    allowBranchSwitch = true,
    quiet = false,
  } = options;

  if (!quiet) log(C.CYAN, `  Checking ${label} updates...`);

  // 1. Check .git exists
  if (!existsSync(join(cwd, '.git'))) {
    if (!quiet) log(C.DARK_YELLOW, `  ${label}: not a git repository, skipping`);
    return { checked: false, updated: false, switchedBranch: false };
  }

  // 2. Detect current branch
  const { branch, isDetached } = getCurrentBranch(cwd);
  if (!branch) {
    if (isDetached) {
      if (!quiet) log(C.DARK_YELLOW, `  ${label}: detached HEAD -- skipping`);
    } else {
      if (!quiet) log(C.DARK_YELLOW, `  ${label}: could not detect branch -- skipping`);
    }
    return { checked: false, updated: false, switchedBranch: false };
  }

  // 3. Check upstream exists
  if (!hasUpstream(cwd, branch)) {
    if (!quiet) log(C.DARK_YELLOW, `  ${label}: branch '${branch}' has no upstream -- skipping`);
    return { checked: true, updated: false, switchedBranch: false };
  }

  // 4. Fetch origin
  if (!fetchOrigin(cwd)) {
    if (!quiet) log(C.DARK_YELLOW, `  ${label}: could not fetch (offline?)`);
    return { checked: false, updated: false, switchedBranch: false };
  }

  // 5. Check behind/ahead for current branch
  const ba = getBehindAhead(cwd, branch);
  if (!ba) {
    if (!quiet) log(C.DARK_YELLOW, `  ${label}: could not check behind count`);
    return { checked: false, updated: false, switchedBranch: false };
  }

  // 6. Check divergence
  if (ba.behind > 0 && ba.ahead > 0) {
    log(C.YELLOW, `  ${label}: '${branch}' diverged (${ba.ahead} ahead, ${ba.behind} behind).`);
    log(C.YELLOW, `  Run: git pull origin ${branch}`);
    return { checked: true, updated: false, switchedBranch: false };
  }

  // 7. Check main status for reference (only if on a different branch)
  let mainBehind = 0;
  if (branch !== 'main' && hasUpstream(cwd, 'main')) {
    const mainBA = getBehindAhead(cwd, 'main');
    if (mainBA) mainBehind = mainBA.behind;
  }

  // 8. Up-to-date
  if (ba.behind <= 0) {
    if (!quiet) {
      if (mainBehind > 0 && branch !== 'main') {
        log(C.DARK_GREEN, `  ${label}: ${branch} up-to-date; main is ${mainBehind} commit(s) behind`);
      } else {
        log(C.DARK_GREEN, `  ${label}: up-to-date (branch: ${branch})`);
      }
    }
    return { checked: true, updated: false, switchedBranch: false };
  }

  // ===== Updates available =====

  if (!interactive) {
    // Silent/headless mode -- only auto-pull on main
    if (branch !== 'main') {
      if (!quiet) log(C.DARK_YELLOW, `  ${label}: ${branch} is ${ba.behind} behind (auto-sync only on main)`);
      return { checked: true, updated: false, switchedBranch: false };
    }
    log(C.DARK_GRAY, `  ${label}: ${ba.behind} commit(s) behind, syncing...`);
    if (pullBranch(cwd, branch)) {
      log(C.DARK_GREEN, `  ${label}: synced`);
      syncSubmodules(cwd);
      return { checked: true, updated: true, switchedBranch: false };
    }
    log(C.DARK_YELLOW, `  ${label}: pull failed (need manual update)`);
    return { checked: true, updated: false, switchedBranch: false };
  }

  // ===== Interactive prompt =====

  log('');
  log(C.YELLOW, '  ╔══════════════════════════════════════════════════╗');
  log(C.YELLOW, '  ║     Updates Available                           ║');
  log(C.YELLOW, '  ╚══════════════════════════════════════════════════╝');
  log(C.YELLOW, `  ${label}: '${branch}' is ${ba.behind} commit(s) behind origin/${branch}`);
  if (mainBehind > 0 && branch !== 'main') {
    log(C.DARK_YELLOW, `  main is ${mainBehind} commit(s) behind origin/main`);
  }
  log('');
  log(C.WHITE, '  [P] Pull updates now (fast-forward) [default]');
  log(C.WHITE, '  [s] Skip (update later)');
  if (allowBranchSwitch && branch !== 'main') {
    log(C.WHITE, '  [m] Switch to main & update (recommended)');
  }
  log('');

  const choice = (await askQuestion('  > ')).trim().toLowerCase();

  if (choice === '' || choice === 'p') {
    log(C.CYAN, `  Pulling origin/${branch}...`);
    if (pullBranch(cwd, branch)) {
      log(C.GREEN, `  ${label}: updated!`);
      syncSubmodules(cwd);
      return { checked: true, updated: true, switchedBranch: false };
    }
    // Pull failed -- likely dirty working tree. Show conflicts and offer discard.
    log(C.YELLOW, `  ${label}: pull failed (local changes may be blocking).`);
    const modified = getModifiedFiles(cwd);
    if (modified.length > 0) {
      log(C.YELLOW, `  ${modified.length} tracked file(s) modified locally:`);
      for (const f of modified.slice(0, 10)) {
        log(C.DARK_GRAY, `    ${f}`);
      }
      if (modified.length > 10) {
        log(C.DARK_GRAY, `    ... and ${modified.length - 10} more`);
      }
    }
    log('');
    log(C.WHITE, '  [d] Discard local changes and retry (reverts tracked files only)');
    log(C.WHITE, '  [c] Cancel (keep changes, update later)');
    const retry = (await askQuestion('  > ')).trim().toLowerCase();
    if (retry === 'd') {
      log(C.CYAN, '  Discarding local changes...');
      discardChanges(cwd);
      if (pullBranch(cwd, branch)) {
        log(C.GREEN, `  ${label}: updated!`);
        syncSubmodules(cwd);
        return { checked: true, updated: true, switchedBranch: false };
      }
      log(C.RED, `  ${label}: pull still failed after discarding. Check git status.`);
    }
    return { checked: true, updated: false, switchedBranch: false };
  }

  if (choice === 'm' && allowBranchSwitch && branch !== 'main') {
    log(C.CYAN, `  Switching to main...`);
    if (!switchToMain(cwd, branch)) {
      log(C.RED, `  ${label}: failed to switch to main. Check git status.`);
      return { checked: true, updated: false, switchedBranch: false };
    }
    log(C.CYAN, '  Pulling origin/main...');
    if (pullBranch(cwd, 'main')) {
      log(C.GREEN, `  ${label}: switched to main and updated!`);
      syncSubmodules(cwd);
      return { checked: true, updated: true, switchedBranch: true };
    }
    log(C.RED, `  ${label}: pull failed after switching. Check git status.`);
    return { checked: true, updated: false, switchedBranch: true };
  }

  // 's' — explicit skip
  if (!quiet) log(C.DARK_YELLOW, `  ${label}: skipping update.`);
  return { checked: true, updated: false, switchedBranch: false };
}

/**
 * Check the user/ sub-repo for updates. Branch-aware variant.
 * User repos typically live on main, but we check the actual current branch.
 *
 * @param {Object} options - Same as checkRepoUpdates
 * @returns {Promise<{ checked: boolean, updated: boolean, switchedBranch: boolean }>}
 */
export async function checkUserRepoUpdates(options = {}) {
  return checkRepoUpdates({
    label: 'User data',
    ...options,
    // User repos are more conservative -- no branch switching
    allowBranchSwitch: false,
  });
}
