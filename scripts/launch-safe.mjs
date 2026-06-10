#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, copyFileSync, mkdirSync, writeFileSync, createWriteStream, unlinkSync, rmSync, readFileSync } from 'fs';
import { execFileSync, spawn } from 'child_process';
import { createInterface } from 'readline';
import { get as httpsGet } from 'https';
import { platform } from 'os';

const isWin = platform() === 'win32';
const isMac = platform() === 'darwin';
const isLinux = platform() === 'linux';

const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const DARK_GREEN = '\x1b[32;2m';
const DARK_YELLOW = '\x1b[33;2m';
const MAGENTA = '\x1b[35m';
const RESET = '\x1b[0m';

function log(color, msg) {
  if (msg === undefined) {
    console.log(color);
  } else {
    console.log(`${color}${msg}${RESET}`);
  }
}

function isProcessRunning(name) {
  try {
    if (isWin) {
      const out = execFileSync('tasklist', ['/NH', '/FI', `IMAGENAME eq ${name}.exe`], { encoding: 'utf-8', timeout: 5000 });
      return out.includes(`${name}.exe`);
    } else if (isMac) {
      execFileSync('pgrep', ['-x', name], { encoding: 'utf-8', timeout: 3000 });
      return true;
    } else {
      execFileSync('pgrep', ['-f', 'Handy'], { encoding: 'utf-8', timeout: 3000 });
      return true;
    }
  } catch {
    return false;
  }
}

function pwsh(args, opts = {}) {
  if (!isWin) return { success: false, stdout: '', status: -1, error: 'No PowerShell on this platform' };
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], {
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

function askQuestion(query) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// ---- Branch check: warn if not on main and offer to switch ----
async function checkAndSwitchToMain() {
  const branch = run(GIT_BIN, ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: rootDir, timeout: 5000 });
  if (!branch.success) return;
  const current = branch.stdout.trim();
  if (current === 'main') return;

  log(YELLOW, '');
  log(YELLOW, `  ⚠ Currently on branch '${current}', not 'main'`);
  log(YELLOW, '  Glitch is designed to run from the main branch for stability.');
  log(WHITE, '  [y] Switch to main now (recommended)');
  log(WHITE, '  [n] Continue on current branch');
  const choice = await askQuestion('  > ');

  if (choice.trim().toLowerCase() === 'y') {
    log(CYAN, '  Switching to main...');
    const checkout = run(GIT_BIN, ['checkout', 'main'], { cwd: rootDir, timeout: 15000 });
    if (checkout.success) {
      log(GREEN, '  Switched to main');
    } else {
      log(RED, `  Failed to switch: ${checkout.stderr || checkout.error}`);
      log(YELLOW, '  Continuing on current branch...');
    }
  } else {
    log(DARK_YELLOW, '  Continuing on current branch (may have unstable config)');
  }
  log('');
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    httpsGet(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        try { unlinkSync(destPath); } catch {}
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        try { unlinkSync(destPath); } catch {}
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      file.close();
      try { unlinkSync(destPath); } catch {}
      reject(err);
    });
  });
}

async function ensureHandy() {
  if (existsSync(HandyBin)) return true;

  log(YELLOW, '  Handy not found. Downloading...');
  const handyVoiceDir = join(rootDir, 'handy-voice');
  if (!existsSync(handyVoiceDir)) mkdirSync(handyVoiceDir, { recursive: true });

  try {
    if (isWin) {
      log(CYAN, '  Running bootstrap to install Handy...');
      const bootstrapScript = join(rootDir, 'scripts', 'bootstrap.ps1');
      if (existsSync(bootstrapScript)) {
        const result = pwsh(['-File', bootstrapScript], { stdio: 'inherit', timeout: 120000 });
        if (!result.success) {
          log(YELLOW, '  Bootstrap failed. Install Handy manually: .\\scripts\\bootstrap.ps1');
          return false;
        }
      } else {
        log(YELLOW, '  bootstrap.ps1 not found. Install Handy manually.');
        return false;
      }
    } else if (isMac) {
      const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
      const url = `https://github.com/cjpais/Handy/releases/download/v${HANDY_VERSION}/Handy_${arch}.app.tar.gz`;
      const tarPath = join(handyVoiceDir, 'Handy.app.tar.gz');

      log(CYAN, `  Downloading Handy v${HANDY_VERSION} for macOS (${arch})...`);
      await downloadFile(url, tarPath);

      log(CYAN, '  Extracting...');
      const result = run('tar', ['-xzf', tarPath, '-C', handyVoiceDir], { timeout: 30000 });
      if (!result.success) throw new Error('Extraction failed: ' + (result.stderr || result.error));

      try { unlinkSync(tarPath); } catch {}
    } else if (isLinux) {
      const arch = process.arch === 'arm64' ? 'aarch64' : 'amd64';
      const url = `https://github.com/cjpais/Handy/releases/download/v${HANDY_VERSION}/Handy_${HANDY_VERSION}_${arch}.AppImage`;
      const appImagePath = join(handyVoiceDir, 'Handy.AppImage');

      log(CYAN, `  Downloading Handy v${HANDY_VERSION} for Linux (${arch})...`);
      await downloadFile(url, appImagePath);

      log(CYAN, '  Making executable...');
      const chmod = run('chmod', ['+x', appImagePath], { timeout: 5000 });
      if (!chmod.success) throw new Error('chmod failed: ' + (chmod.stderr || chmod.error));
    }
  } catch (e) {
    log(RED, `  ERROR downloading Handy: ${e.message || e}`);
    return false;
  }

  if (existsSync(HandyBin)) {
    log(GREEN, '  Handy installed!');
    return true;
  }
  return false;
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

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(scriptDir);

const HANDY_VERSION = '0.8.3';
const HandyBin = isWin
  ? join(rootDir, 'handy-voice', 'Handy', 'handy.exe')
  : isMac
    ? join(rootDir, 'handy-voice', 'Handy.app', 'Contents', 'MacOS', 'Handy')
    : join(rootDir, 'handy-voice', 'Handy.AppImage');

const openCodeBin = join(rootDir, 'opencode', platform() === 'win32' ? 'opencode.exe' : 'opencode');
const configPath = join(rootDir, 'opencode.json');
const templatePath = join(rootDir, 'config', 'opencode-safe.json');
const backupDir = join(rootDir, 'data', 'backups');
const modeFile = join(backupDir, '.last-mode');

// ---- Prepend bundled Node to PATH if available ----
const BundledNodeDir = join(rootDir, 'data', 'node');
const BundledNodeBin = join(BundledNodeDir, platform() === 'win32' ? 'node.exe' : 'node');
if (existsSync(BundledNodeBin)) {
  process.env.PATH = (platform() === 'win32' ? ';' : ':') + BundledNodeDir + process.env.PATH;
}

async function main() {
  // ---- Branch check (runs first) ----
  await checkAndSwitchToMain();

  console.log('');
  console.log(' Glitch AI - Safe Mode');
  console.log('');

  if (!existsSync(openCodeBin)) {
    console.error(' OpenCode not found. Run bootstrap.ps1 first.');
    process.exit(1);
  }

  if (existsSync(configPath)) {
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const backupFile = join(backupDir, `opencode-${ts}.json`);
    copyFileSync(configPath, backupFile);
    console.log(`  Previous config backed up -> data/backups/opencode-${ts}.json`);
  }

  if (!existsSync(templatePath)) {
    console.error('  ERROR: Safe mode template not found at config/opencode-safe.json');
    console.error('  Try cloning the repo again or restoring from backup.');
    process.exit(1);
  }

  console.log('  Loading safe mode config...');
  copyFileSync(templatePath, configPath);
  console.log('  Safe mode config loaded.');

  const modeInfo = JSON.stringify({
    mode: 'safe',
    timestamp: new Date().toISOString(),
    model: 'opencode-go/deepseek-v4-flash'
  }, null, 2);
  writeFileSync(modeFile, modeInfo, 'utf-8');

  // ---- Check + install Handy if missing ----
  log(CYAN, '  Checking Handy voice input...');
  await ensureHandy();

  // ---- Ensure Handy portable flag ----
  if (isWin && existsSync(HandyBin)) {
    const portableFlag = join(rootDir, 'handy-voice', 'Handy', 'portable');
    if (!existsSync(portableFlag)) {
      writeFileSync(portableFlag, '', 'utf-8');
    }
  }

  // ---- Start Handy (if not already running) ----
  const handyProcName = isWin ? 'handy' : 'Handy';
  if (!isProcessRunning(handyProcName)) {
    if (existsSync(HandyBin)) {
      log(CYAN, '  Starting Handy voice input...');
      if (isMac) {
        const handyApp = join(rootDir, 'handy-voice', 'Handy.app');
        if (existsSync(handyApp)) {
          spawn('open', [handyApp], { detached: true, stdio: 'ignore' }).unref();
        } else {
          const proc = spawn(HandyBin, [], { detached: true, stdio: 'ignore' });
          proc.unref();
        }
      } else {
        const proc = spawn(HandyBin, [], { detached: true, stdio: 'ignore', windowsHide: true });
        proc.unref();
      }
    } else {
      log(DARK_YELLOW, '  Handy not found (optional). Voice input disabled.');
    }
  } else {
    log(DARK_GREEN, '  Handy already running');
  }

  console.log('');
  console.log('  Starting OpenCode in safe mode...');
  console.log('  Current config saved to data/backups/ with timestamp.');
  console.log("  When you're done fixing, exit normally and launch normally.");
  console.log('');
  console.log('  NOTE: Safe mode is a diagnostic shell. Fix the actual issue in:');
  console.log('    - The normal template: config/opencode-normal.json (config problems)');
  console.log('    - Engine files: glitch-memorycore/ (prompt/skill problems)');
  console.log('    - Agent files: .opencode/agents/ (agent definition problems)');
  console.log('    - Your git branch (if switching branches fixes the issue)');
  console.log('');

  try {
    execFileSync(openCodeBin, [], { stdio: 'inherit', cwd: rootDir });
  } catch (err) {
    if (err.status === null) {
      console.error(`  OpenCode exited with error: ${err.message}`);
    }
  }

  console.log('');
  log(MAGENTA, 'Safe mode ended.');
}

main().catch(e => {
  log(RED, `  Fatal error: ${e.message || e}`);
  process.exit(1);
});
