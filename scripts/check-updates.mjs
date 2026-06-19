#!/usr/bin/env node

/**
 * Shared dependency update checking module
 * Used by all launch scripts (normal, free, local, safe) for consistent behavior
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const POWERSHELL = isWin ? 'powershell.exe' : null;

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DARK_GREEN = '\x1b[32;2m';
const DARK_YELLOW = '\x1b[33;2m';
const DARK_GRAY = '\x1b[90m';
const WHITE = '\x1b[37m';
const RESET = '\x1b[0m';

const StatusFile = join(ROOT_DIR, 'data', 'update-status.json');
const CheckUpdatesScript = join(ROOT_DIR, 'scripts', 'check-updates.ps1');

function log(color, msg) {
  if (msg === undefined) {
    console.log(color);
  } else {
    console.log(`${color}${msg}${RESET}`);
  }
}

function readJson(path) {
  try {
    let content = readFileSync(path, 'utf-8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function run(cmd, args, opts = {}) {
  try {
    if (isWin && (cmd.endsWith('.cmd') || cmd.endsWith('.bat'))) {
      args = ['/d', '/s', '/c', cmd, ...args];
      cmd = 'cmd.exe';
    }
    const out = execFileSync(cmd, args, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      ...opts
    });
    return { success: true, stdout: (out || '').toString().trim(), status: 0 };
  } catch (e) {
    return {
      success: false,
      stdout: ((e.stdout || '')).toString().trim(),
      stderr: ((e.stderr || '')).toString().trim(),
      error: e.message || String(e),
      status: e.status
    };
  }
}

function pwsh(args, opts = {}) {
  if (!POWERSHELL) return { success: false, stdout: '', status: -1, error: 'No PowerShell on this platform' };
  return run(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], opts);
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

/**
 * Run the dependency update check and prompt for updates if available
 * @param {Object} options
 * @param {boolean} options.skipIfNoPowerShell - If true, skip silently on non-Windows
 * @returns {Promise<{checked: boolean, updatesApplied: boolean}>}
 */
export async function checkAndPromptUpdates(options = {}) {
  const { skipIfNoPowerShell = true } = options;

  if (!POWERSHELL) {
    if (!skipIfNoPowerShell) {
      log(DARK_GRAY, '  Dependency update check skipped (Windows-only PS1 scripts)');
    }
    return { checked: false, updatesApplied: false };
  }

  if (!existsSync(CheckUpdatesScript)) {
    log(DARK_YELLOW, '  check-updates.ps1 not found, skipping update check');
    return { checked: false, updatesApplied: false };
  }

  log(CYAN, '  Checking dependency updates...');

  try {
    // Run check-only first
    pwsh(['-File', CheckUpdatesScript, '-CheckOnly'], { timeout: 60000, stdio: 'inherit' });

    // Read results
    if (!existsSync(StatusFile)) {
      log(DARK_YELLOW, '  Update status file not found');
      return { checked: true, updatesApplied: false };
    }

    const status = readJson(StatusFile);
    if (!status || status.updates_available === 0) {
      log(DARK_GREEN, '  All dependencies up-to-date');
      return { checked: true, updatesApplied: false };
    }

    const updateItems = (status.items || []).filter(i => i.update_available);
    if (updateItems.length === 0) {
      log(DARK_GREEN, '  All dependencies up-to-date');
      return { checked: true, updatesApplied: false };
    }

    // Display available updates
    log('');
    log(YELLOW, '  ===== Updates Available =====');
    updateItems.forEach((item, i) => {
      log(CYAN, `  [${i + 1}] ${item.name}`);
      log(DARK_YELLOW, `      ${item.current} -> ${item.latest}`);
    });
    log('');

    // Prompt for selection
    log(WHITE, "  Enter numbers to select (e.g. '1,3'),");
    log(WHITE, "  press Enter to apply all, or type 's' to skip:");
    const selection = await askQuestion('  > ');

    if (selection.trim().toLowerCase() === 's') {
      log(DARK_YELLOW, '  Skipping updates.');
      return { checked: true, updatesApplied: false };
    }

    const selectedNames = [];
    if (selection.trim()) {
      const indices = selection.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      for (const idx of indices) {
        const num = idx - 1;
        if (num >= 0 && num < updateItems.length) {
          selectedNames.push(updateItems[num].name);
        }
      }
    }

    if (selectedNames.length > 0) {
      log(CYAN, '  Applying selected updates...');
      const filterExpr = selectedNames.map(n => `'${n.replace(/'/g, "''")}'`).join(', ');
      pwsh(['-Command', `& '${CheckUpdatesScript.replace(/'/g, "''")}' -Update -Filter @(${filterExpr})`], { stdio: 'inherit', timeout: 120000 });
    } else {
      log(CYAN, '  Applying all updates...');
      pwsh(['-File', CheckUpdatesScript, '-Update'], { stdio: 'inherit', timeout: 120000 });
    }
    log(GREEN, '  Updates complete.');
    return { checked: true, updatesApplied: true };

  } catch (e) {
    log(DARK_YELLOW, `  Update check skipped (non-critical): ${e.message || e}`);
    return { checked: false, updatesApplied: false };
  }
}

/**
 * Run update check only (no prompt), return status
 * @returns {Promise<Object|null>} The update status object or null
 */
export async function checkUpdatesOnly() {
  if (!POWERSHELL || !existsSync(CheckUpdatesScript)) {
    return null;
  }

  try {
    pwsh(['-File', CheckUpdatesScript, '-CheckOnly'], { timeout: 60000, stdio: 'ignore' });
    if (existsSync(StatusFile)) {
      return readJson(StatusFile);
    }
  } catch {
    // Silent fail
  }
  return null;
}

// CLI support for direct invocation
const args = process.argv.slice(2);
if (args.includes('--check-only')) {
  const status = await checkUpdatesOnly();
  if (status) {
    console.log(JSON.stringify(status, null, 2));
  }
  process.exit(0);
}

if (args.includes('--prompt')) {
  const result = await checkAndPromptUpdates({ skipIfNoPowerShell: false });
  process.exit(result.checked ? 0 : 1);
}