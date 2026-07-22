#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, unlinkSync, createWriteStream } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawn } from 'child_process';
import { createInterface } from 'readline';
import { get as httpsGet } from 'https';
import { checkRepoUpdates, checkUserRepoUpdates, handleRestartOnUpdate } from './lib/git-sync.mjs';
import { detectUserProfile, buildUserInstructions } from './lib/user-profile.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCRIPT_DIR = __dirname;
const ROOT_DIR = resolve(SCRIPT_DIR, '..');
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

const OPENCODE_BIN_NAME = isWin ? 'opencode.exe' : 'opencode';
const OpenCodeBin = join(ROOT_DIR, 'opencode', OPENCODE_BIN_NAME);

const HANDY_VERSION = '0.8.3';
const HandyBin = isWin
  ? join(ROOT_DIR, 'handy-voice', 'Handy', 'handy.exe')
  : isMac
    ? join(ROOT_DIR, 'handy-voice', 'Handy.app', 'Contents', 'MacOS', 'Handy')
    : join(ROOT_DIR, 'handy-voice', 'Handy.AppImage');
const ConfigPath = join(ROOT_DIR, 'opencode.json');
const TemplatePath = join(ROOT_DIR, 'config', 'opencode-normal.json');
const BackupDir = join(ROOT_DIR, 'data', 'backups');
const ModeFile = join(BackupDir, '.last-mode');
const UserDir = join(ROOT_DIR, 'user');
const FixPathsMjs = join(ROOT_DIR, 'scripts', 'fix-paths.mjs');

// ---- Prepend bundled Node to PATH if available ----
const BundledNodeDir = join(ROOT_DIR, 'data', 'node');
const BundledNodeBin = join(BundledNodeDir, isWin ? 'node.exe' : 'node');
if (existsSync(BundledNodeBin)) {
  process.env.PATH = BundledNodeDir + (isWin ? ';' : ':') + process.env.PATH;
}


const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DARK_GREEN = '\x1b[32;2m';
const DARK_YELLOW = '\x1b[33;2m';
const DARK_GRAY = '\x1b[90m';
const WHITE = '\x1b[37m';
const RESET = '\x1b[0m';

function log(color, msg) {
  if (msg === undefined) {
    console.log(color);
  } else {
    console.log(`${color}${msg}${RESET}`);
  }
}

function timestamp() {
  const n = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${n.getFullYear()}${p(n.getMonth()+1)}${p(n.getDate())}-${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}`;
}

function run(cmd, args, opts = {}) {
  try {
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

function readJson(path) {
  try {
    let content = readFileSync(path, 'utf-8');
    // Strip UTF-8 BOM (PowerShell Out-File writes BOM even with -Encoding utf8)
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }
    return JSON.parse(content);
  } catch {
    return null;
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
  // Skip branch check on restart (seamless restart, no user input)
  if (process.argv.includes('--restart')) {
    log(DARK_GREEN, '  Restart mode -- skipping branch check');
    return;
  }

  const branch = run(GIT_BIN, ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT_DIR, timeout: 5000 });
  if (!branch.success) return;
  const current = branch.stdout.trim();
  if (current === 'main') {
    // Check for stashed changes from a previous auto-stash
    const stashList = run(GIT_BIN, ['stash', 'list'], { cwd: ROOT_DIR, timeout: 5000 });
    if (stashList.success) {
      const autoStashes = stashList.stdout.split('\n').filter(l => l.includes('glitch-auto-stash:'));
      if (autoStashes.length > 0) {
        log(YELLOW, '');
        autoStashes.forEach(s => log(YELLOW, `  [box] ${s}`));
        log(YELLOW, `  Run \`git stash pop\` to restore when ready.`);
        log('');
      }
    }
    return;
  }

  log(YELLOW, '');
  log(YELLOW, `  !! Currently on branch '${current}', not 'main'`);
  log(YELLOW, '  Glitch is designed to run from the main branch for stability.');
  log(WHITE, '  [Y/n] Switch to main now (recommended)');
  let choice = await askQuestion('  > ');

  // Validate input
  const raw = (choice ?? '').trim().toLowerCase();
  let wantsSwitch = true;
  if (raw === 'n' || raw === 'no') {
    wantsSwitch = false;
  } else if (raw !== '' && raw !== 'y' && raw !== 'yes') {
    log(YELLOW, '  Type y (or press Enter) to switch, or n to stay on current branch.');
    choice = await askQuestion('  > ');
    wantsSwitch = (choice ?? '').trim().toLowerCase() !== 'n' && (choice ?? '').trim().toLowerCase() !== 'no';
  }

  if (wantsSwitch) {
    log(CYAN, '  Switching to main...');

    // Check for local changes that would block checkout
    const status = run(GIT_BIN, ['status', '--porcelain'], { cwd: ROOT_DIR, timeout: 5000 });
    const isDirty = status.success && status.stdout.trim().length > 0;
    if (isDirty) {
      log(YELLOW, '  Local changes detected, stashing before switch...');
      const stashMsg = `glitch-auto-stash: ${current}`;
      const stash = run(GIT_BIN, ['stash', 'push', '-m', stashMsg], { cwd: ROOT_DIR, timeout: 15000 });
      if (stash.success) {
        log(GREEN, `  Changes stashed. Run \`git stash pop\` when back on '${current}' to restore.`);
      } else {
        log(RED, `  Failed to stash: ${stash.stderr || stash.error}`);
        log(YELLOW, '  Continuing on current branch...');
        log('');
        return;
      }
    }

    const checkout = run(GIT_BIN, ['checkout', 'main'], { cwd: ROOT_DIR, timeout: 30000 });
    if (checkout.success) {
      log(GREEN, '  Switched to main');
      // Verify clean tree after checkout
      const postStatus = run(GIT_BIN, ['status', '--porcelain'], { cwd: ROOT_DIR, timeout: 5000 });
      if (postStatus.success && postStatus.stdout.trim().length > 0) {
        log(YELLOW, '  !! Working tree has uncommitted changes after checkout.');
      }
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

  const handyVoiceDir = join(ROOT_DIR, 'handy-voice');
  if (!existsSync(handyVoiceDir)) mkdirSync(handyVoiceDir, { recursive: true });

  try {
    if (isWin) {
      log(YELLOW, '  On Windows, run .\\scripts\\bootstrap.ps1 to install Handy.');
      return false;
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

      if (existsSync(HandyBin)) {
        log(GREEN, '  Handy installed!');
        return true;
      }
    } else if (isLinux) {
      const arch = process.arch === 'arm64' ? 'aarch64' : 'amd64';
      const url = `https://github.com/cjpais/Handy/releases/download/v${HANDY_VERSION}/Handy_${HANDY_VERSION}_${arch}.AppImage`;
      const appImagePath = join(handyVoiceDir, 'Handy.AppImage');

      log(CYAN, `  Downloading Handy v${HANDY_VERSION} for Linux (${arch})...`);
      await downloadFile(url, appImagePath);

      log(CYAN, '  Making executable...');
      const chmod = run('chmod', ['+x', appImagePath], { timeout: 5000 });
      if (!chmod.success) throw new Error('chmod failed: ' + (chmod.stderr || chmod.error));

      if (existsSync(HandyBin)) {
        log(GREEN, '  Handy installed!');
        return true;
      }
    }
  } catch (e) {
    log(RED, `  ERROR downloading Handy: ${e.message || e}`);
  }

  return false;
}

const NPM_BIN = isWin ? 'npm.cmd' : 'npm';
const GIT_BIN = 'git';
const POWERSHELL = isWin ? 'powershell.exe' : null;

function pwsh(args, opts = {}) {
  if (!POWERSHELL) return { success: false, stdout: '', status: -1, error: 'No PowerShell on this platform' };
  return run(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], opts);
}

// ---- Silent repo sync for server mode (non-interactive, best-effort only) ----
// Uses scripts/lib/git-sync.mjs -- branch-aware, but in non-interactive mode
// only auto-pulls on 'main' to avoid unexpected changes on feature branches
// Replaces the old syncMainRepoSilent() and syncUserRepoSilent()


// ---- Load .env if present ----
function loadEnv() {
  const envFile = join(ROOT_DIR, '.env');
  if (existsSync(envFile)) {
    const text = readFileSync(envFile, 'utf-8');
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
      if (match) {
        let val = match[2].replace(/^["']|["']$/g, '');
        process.env[match[1].trim()] = val;
      }
    }
    log(GREEN, '  Loaded .env config');
  }
}


// ==========================================================
//                          MAIN
// ==========================================================

async function main() {
  // ---- Branch check (runs first) ----
  await checkAndSwitchToMain();

  log(MAGENTA, '');
  log(MAGENTA, ' Glitch AI - Server Mode');
  log(MAGENTA, '');

  // ---- Load .env ----
  loadEnv();

  // ---- Auto-bootstrap: download OpenCode if missing ----
  if (!existsSync(OpenCodeBin)) {
    log(YELLOW, '  OpenCode not found. Running bootstrap to download...');
    if (isWin) {
      const bootstrapScript = join(ROOT_DIR, 'scripts', 'bootstrap.ps1');
      if (existsSync(bootstrapScript)) {
        const result = pwsh(['-File', bootstrapScript], { stdio: 'inherit', timeout: 120000 });
        if (!result.success) {
          log(RED, '  ERROR: Bootstrap failed: ' + (result.error));
          log(YELLOW, '  Try running manually: .\\scripts\\bootstrap.ps1');
          process.exit(1);
        }
      } else {
        log(RED, '  ERROR: bootstrap.ps1 not found.');
        process.exit(1);
      }
    } else {
      log(YELLOW, '  On Unix/macOS, please install opencode manually: npm install -g opencode-ai');
      log(YELLOW, '  Then copy the binary to opencode/opencode in the project root.');
      process.exit(1);
    }
    if (!existsSync(OpenCodeBin)) {
      log(RED, '  ERROR: Bootstrap finished but OpenCode still not found.');
      log(YELLOW, '  Try running manually: .\\scripts\\bootstrap.ps1');
      process.exit(1);
    }
    log(GREEN, '  OpenCode downloaded successfully.');
  }

  // ---- Self-heal: initialize git submodules if needed ----
  if (!existsSync(join(ROOT_DIR, 'glitch-memorycore', 'prompt-rules.md'))) {
    log(CYAN, '  Initializing glitch-memorycore submodule...');
    const result = run(GIT_BIN, ['submodule', 'update', '--init', '--recursive'], { cwd: ROOT_DIR, timeout: 60000 });
    if (result.success && existsSync(join(ROOT_DIR, 'glitch-memorycore', 'prompt-rules.md'))) {
      log(GREEN, '  Engine ready!');
    } else {
      log(YELLOW, '  WARNING: Could not load engine.');
      log(YELLOW, '  Run: git submodule update --init --recursive');
    }
  } else {
    log(DARK_GREEN, '  Engine found');
  }

  // ---- Sync glitch-ai repo from remote (silent, best-effort, branch-aware) ----
  const syncResult = await checkRepoUpdates({ cwd: ROOT_DIR, interactive: false, allowBranchSwitch: false });
  handleRestartOnUpdate(spawn, syncResult, ROOT_DIR);

  // ---- Sync user data repo (silent, best-effort) ----
  const userRepoDir = join(ROOT_DIR, 'user');
  if (existsSync(join(userRepoDir, '.git'))) {
    await checkUserRepoUpdates({ cwd: userRepoDir, interactive: false, quiet: true });
  }

  // ---- Auto-install Handy if missing ----
  log(CYAN, '  Checking Handy voice input...');
  await ensureHandy();

  // ---- Ensure security & tool binaries are present ----
  log(CYAN, '  Checking external tool dependencies...');
  try {
    const toolResult = run('node', [join(ROOT_DIR, 'scripts', 'ensure-tools.mjs'), '--json', '--check-only'], { timeout: 30000 });
    if (toolResult.success && toolResult.stdout) {
      const report = JSON.parse(toolResult.stdout);
      if (report.skipped && report.skipped.length > 0) {
        log(YELLOW, `  ${report.skipped.length} tools need installation. Installing...`);
        const installResult = run('node', [join(ROOT_DIR, 'scripts', 'ensure-tools.mjs'), '--json'], { timeout: 300000 });
        if (installResult.success && installResult.stdout) {
          const installReport = JSON.parse(installResult.stdout);
          if (installReport.installed.length > 0) {
            log(GREEN, `  Installed: ${installReport.installed.join(', ')}`);
          }
          if (installReport.failed.length > 0) {
            log(YELLOW, `  Failed: ${installReport.failed.join(', ')}`);
          }
        }
      } else {
        log(DARK_GREEN, `  All tools ready (${report.checked} checked)`);
      }
    }
  } catch (e) {
    log(DARK_YELLOW, '  Tool check skipped (non-critical)');
  }

  // ---- Normalize backslash paths ----
  log(CYAN, '  Normalizing backslash paths...');
  try {
    if (existsSync(FixPathsMjs)) {
      run('node', [FixPathsMjs], { timeout: 15000, stdio: 'ignore' });
    }
  } catch {
    log(DARK_YELLOW, '  Path normalization failed (non-critical)');
  }

  // ---- Timestamped backup (preserved, never overwritten) ----
  if (existsSync(ConfigPath)) {
    if (!existsSync(BackupDir)) mkdirSync(BackupDir, { recursive: true });
    const ts = timestamp();
    const backupFile = join(BackupDir, `opencode-${ts}.json`);
    copyFileSync(ConfigPath, backupFile);
    log(DARK_GRAY, `  Previous config backed up -> data\\backups\\opencode-${ts}.json`);
  }

  // ---- Check template exists ----
  if (!existsSync(TemplatePath)) {
    log(RED, '  ERROR: Normal mode template not found at config/opencode-normal.json');
    log(YELLOW, '  Try running launch-safe to repair.');
    process.exit(1);
  }

  // ---- User Profile Detection ----
  const { userName: UserName, userFound } = detectUserProfile(ROOT_DIR, ['GLITCH_USER']);

  // ---- TUI config: user/tui.json -> OPENCODE_TUI_CONFIG ----
  const TuiConfigPath = join(ROOT_DIR, 'user', 'tui.json');
  if (existsSync(TuiConfigPath)) {
    process.env.OPENCODE_TUI_CONFIG = TuiConfigPath;
    log(DARK_GREEN, '  TUI config loaded');
  }

  // ---- Generate runtime config from template ----
  log(CYAN, '  Generating runtime config from template...');

  const templateText = readFileSync(TemplatePath, 'utf-8');

  const engineInstructions = [
    'glitch-memorycore/prompt-rules.md',
    'glitch-memorycore/CLAUDE.md',
    'glitch-memorycore/master-memory.md',
    'glitch-memorycore/core/identity.md',
    'glitch-memorycore/plugins/glitch-skills/skills-registry.md'
  ];

  let userInstructions = buildUserInstructions(ROOT_DIR, UserName);

  const allInstructions = [...engineInstructions, ...userInstructions];
  const instrJson = allInstructions.map(s => `    "${s}"`).join(',\n');
  const instrBlock = `"instructions": [\n${instrJson}\n  ]`;
  const runtimeJson = templateText.replace(/"[Ii]nstructions"\s*:\s*\[[^\]]*\]/, instrBlock);

  try {
    JSON.parse(runtimeJson);
    writeFileSync(ConfigPath, runtimeJson, 'utf-8');
    log(DARK_GREEN, `  Config written (${allInstructions.length} instruction files)`);
  } catch (e) {
    log(RED, '  ERROR: Generated config is invalid JSON!');
    log(RED, `  ${e.message}`);
    process.exit(1);
  }

  // ---- Write mode marker ----
  const modeInfo = JSON.stringify({
    mode: 'normal',
    timestamp: new Date().toISOString(),
    model: 'opencode-go/deepseek-v4-flash'
  }, null, 2);
  if (!existsSync(BackupDir)) mkdirSync(BackupDir, { recursive: true });
  writeFileSync(ModeFile, modeInfo, 'utf-8');

  // ---- Check dependency updates (shared module) ----
  try {
    const { checkUpdatesOnly } = await import('./check-updates.mjs');
    const status = await checkUpdatesOnly();
    if (status && status.updates_available > 0) {
      log(YELLOW, '  ' + status.updates_available + ' update(s) available');
      const updateItems = (status.items || []).filter(i => i.update_available);
      for (const item of updateItems) {
        log(DARK_YELLOW, '    ' + item.name + ': ' + item.current + ' -> ' + item.latest);
      }
      log(DARK_YELLOW, '  Run: .\\scripts\\check-updates.ps1 -Update');
    } else {
      log(DARK_GREEN, '  All dependencies up-to-date');
    }
  } catch (e) {
    log(DARK_YELLOW, '  Update check skipped (non-critical)');
  }

  // ---- Check for new models (Win only) ----
  if (isWin) {
    try {
      const checkModelsScript = join(ROOT_DIR, 'scripts', 'check-models.ps1');
      if (existsSync(checkModelsScript)) {
        pwsh(['-File', checkModelsScript, '-CheckOnly', '-SkipNvidiaFreeCheck'], { timeout: 60000, stdio: 'inherit' });
        const modelStatusFile = join(ROOT_DIR, 'data', 'model-update-status.json');
        if (existsSync(modelStatusFile)) {
          const modelStatus = readJson(modelStatusFile);
          if (modelStatus && modelStatus.new_models_count > 0) {
            log(YELLOW, `  ${modelStatus.new_models_count} new model(s) available`);
            if (modelStatus.new_models) {
              for (const nm of modelStatus.new_models) {
                log(GREEN, `    + ${nm.model}`);
              }
            }
            if (modelStatus.related_to_current_agents && modelStatus.related_to_current_agents.length > 0) {
              log(DARK_YELLOW, '  (some may be relevant to current agents -- check session brief)');
            }
          } else {
            log(DARK_GREEN, '  Models up-to-date');
          }
        }
      }
    } catch {
      log(DARK_YELLOW, '  Model check skipped (non-critical)');
    }
  }

  // ---- Sync user memory data from private repo (handled by checkUserRepoUpdates above) ----

  // ---- Auto-update opencode to latest (minor/patch) + sync local binary ----
  try {
    const globalVer = run(OPENCODE_BIN_NAME === 'opencode.exe' ? 'opencode.cmd' : 'opencode', ['--version'], { timeout: 10000 });
    const currentGlobal = globalVer.success ? globalVer.stdout : 'unknown';

    const npmView = run(NPM_BIN, ['view', 'opencode-ai', 'version'], { timeout: 15000 });
    const latestGlobal = npmView.success ? npmView.stdout : 'unknown';

    const globalNeedsUpdate = currentGlobal !== 'unknown' && latestGlobal !== 'unknown' && currentGlobal !== latestGlobal;

    if (globalNeedsUpdate) {
      const cvParts = currentGlobal.split('.');
      const lvParts = latestGlobal.split('.');
      const autoSafe = cvParts[0] === lvParts[0];

      if (autoSafe) {
        log(CYAN, `  Updating opencode (${currentGlobal} -> ${latestGlobal})...`);
        run(NPM_BIN, ['install', '-g', 'opencode-ai@latest'], { stdio: 'inherit', timeout: 60000 });
        const updatedVer = run(OPENCODE_BIN_NAME === 'opencode.exe' ? 'opencode.cmd' : 'opencode', ['--version'], { timeout: 10000 });
        log(GREEN, `  Done. Version: ${updatedVer.success ? updatedVer.stdout : currentGlobal}`);
      } else {
        log(YELLOW, '  \u26A0 OpenCode major version available: ' + currentGlobal + ' -> ' + latestGlobal);
        log(YELLOW, '  Run: npm install -g opencode-ai@latest');
      }
    }

    // Sync local binary from updated global install
    const npmRoot = run(NPM_BIN, ['root', '-g'], { timeout: 10000 });
    if (npmRoot.success) {
      const globalBin = join(npmRoot.stdout.trim(), 'opencode-ai', 'bin', OPENCODE_BIN_NAME);
      if (existsSync(globalBin) && existsSync(OpenCodeBin)) {
        const globalVersion = run(globalBin, ['--version'], { timeout: 5000 });
        const localVersion = run(OpenCodeBin, ['--version'], { timeout: 5000 });
        if (globalVersion.success && localVersion.success && localVersion.stdout.trim() !== globalVersion.stdout.trim()) {
          log(CYAN, `  Syncing local opencode binary (${localVersion.stdout.trim()} -> ${globalVersion.stdout.trim()})...`);
          copyFileSync(globalBin, OpenCodeBin);
          log(GREEN, '  Done.');
        }
      }
    }
  } catch (e) {
    log(YELLOW, `  WARNING: Binary sync failed: ${e.message || e}`);
  }

  // ---- Root directory audit (print warning if untracked artifacts found) ----
  try {
    const auditScript = join(SCRIPT_DIR, 'audit-root.mjs');
    if (existsSync(auditScript)) {
      const auditResult = run('node', [auditScript, '--check'], { timeout: 10000 });
      if (auditResult.success && auditResult.stdout) {
        const report = JSON.parse(auditResult.stdout);
        if (report.status === 'dirty') {
          log(YELLOW, `  WARNING: Root has ${report.count} untracked artifact(s). Run 'node scripts/audit-root.mjs' to review.`);
        }
      }
    }
  } catch {
    // intentionally silent — non-blocking startup warning
  }

  // ---- Ensure Handy portable flag ----
  if (isWin && existsSync(HandyBin)) {
    const portableFlag = join(ROOT_DIR, 'handy-voice', 'Handy', 'portable');
    if (!existsSync(portableFlag)) {
      writeFileSync(portableFlag, '', 'utf-8');
    }
  }

  // ---- Launch Server ----
  const { launchServer } = await import('./lib/server-mode.mjs');
  await launchServer({ OpenCodeBin, ROOT_DIR, HandyBin });

  // ---- Check for restart flag (seamless restart) ----
  const restartFlag = join(ROOT_DIR, 'data', '.restart-flag');
  if (existsSync(restartFlag)) {
    unlinkSync(restartFlag);
    log('');
    log(MAGENTA, '  Restarting Glitch...');
    log('');
    // Re-launch with same args + --restart flag
    const args = process.argv.slice(1);
    if (!args.includes('--restart')) args.push('--restart');
    const child = spawn(process.argv[0], args, {
      stdio: 'inherit',
      detached: true,
    });
    child.unref();
    process.exit(0);
  }
}

main().catch(e => {
  log(RED, `  Fatal error: ${e.message || e}`);
  process.exit(1);
});