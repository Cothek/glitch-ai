#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync, unlinkSync, renameSync, appendFileSync, createWriteStream, rmSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawn } from 'child_process';
import { createInterface } from 'readline';
import { get as httpsGet } from 'https';
import { tmpdir } from 'os';
import { checkRepoUpdates, checkUserRepoUpdates, handleRestartOnUpdate } from './lib/git-sync.mjs';
import { detectUserProfile, buildUserInstructions } from './lib/user-profile.mjs';
import { injectProviders } from './lib/inject-providers.mjs';

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

// ---- Prepend bundled Node to PATH if available ----
const BundledNodeDir = join(ROOT_DIR, 'data', 'node');
const BundledNodeBin = join(BundledNodeDir, isWin ? 'node.exe' : 'node');
if (existsSync(BundledNodeBin)) {
  process.env.PATH = BundledNodeDir + (isWin ? ';' : ':') + process.env.PATH;
}

  // ---- Detect zip download (no git repo) ----
  if (!existsSync(join(ROOT_DIR, '.git'))) {
    log(DARK_YELLOW, '  Running from zip snapshot -- git features unavailable (auto-update, branch switching)');
  }

function log(color, msg) {
  if (msg === undefined) {
    console.log(color);
  } else {
    console.log(`${color}${msg}${RESET}`);
  }
}

const UpdateLogPath = join(ROOT_DIR, 'data', 'opencode-update.log');

function logUpdate(msg) {
  try {
    const n = new Date();
    const ts = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')} ${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`;
    appendFileSync(UpdateLogPath, `[${ts}] ${msg}\n`, 'utf-8');
  } catch {}
}

function timestamp() {
  const n = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${n.getFullYear()}${p(n.getMonth()+1)}${p(n.getDate())}-${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}`;
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

function askQuestion(query) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
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
      log(CYAN, '  Running bootstrap to install Handy...');
      const bootstrapScript = join(ROOT_DIR, 'scripts', 'bootstrap.ps1');
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
      if (existsSync(HandyBin)) {
        log(GREEN, '  Handy installed!');
        return true;
      }
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

// ---- Sync glitch-ai repo from remote (branch-aware, shared module) ----
// Uses scripts/lib/git-sync.mjs -- handles any branch, prompts interactively
// Replaces the old syncMainRepo() that only worked on 'main'
//
// Old functions removed in favor of shared module calls in main():
//   - syncMainRepo()  -> checkRepoUpdates({ cwd: ROOT_DIR, interactive: true, allowBranchSwitch: true })
//   - syncUserRepo()  -> checkUserRepoUpdates({ cwd: join(ROOT_DIR, 'user'), interactive: true })

// ---- Branch check: warn if not on main and offer to switch ----
async function checkAndSwitchToMain() {
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
        autoStashes.forEach(s => log(YELLOW, `  [stash] ${s}`));
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
      log(YELLOW, '');
      log(YELLOW, '  Cannot switch branches: working tree has uncommitted changes.');
      log(YELLOW, `  Commit or stash them first, then re-launch from main.`);
      log(YELLOW, '');
      log(YELLOW, '  Or run: git stash push -m "wip" && node scripts/launch.mjs');
      log('');
      return;
    }

    const checkout = run(GIT_BIN, ['checkout', 'main'], { cwd: ROOT_DIR, timeout: 30000 });
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

const HELP_TEXT = `
  Glitch AI - Normal Mode (cross-platform)

  Usage: node scripts/launch.mjs [options]

  Options:
    --help              Show this help
    --serve             Launch in server (web) mode instead of TUI

  Environment:
    GLITCH_USER         Set user profile name explicitly
  `;

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(HELP_TEXT);
  process.exit(0);
}

const isServe = args.includes('--serve');

async function main() {
  // ---- Branch check (runs first) ----
  await checkAndSwitchToMain();
  log(MAGENTA, '');
  log(MAGENTA, ' Glitch AI - Normal Mode');
  log(MAGENTA, '');

  // ---- Auto-bootstrap: download OpenCode if missing ----
  if (!existsSync(OpenCodeBin)) {
    log(YELLOW, '  OpenCode not found. Running bootstrap to download...');
    if (isWin) {
      const bootstrapScript = join(ROOT_DIR, 'scripts', 'bootstrap.ps1');
      if (existsSync(bootstrapScript)) {
        const result = pwsh(['-File', bootstrapScript], { stdio: 'inherit', timeout: 120000 });
        if (!result.success) {
          log(RED, `  ERROR: Bootstrap failed: ${result.error}`);
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

  // ---- Sync glitch-ai repo from remote (branch-aware, shared module) ----
  const syncResult = await checkRepoUpdates({ cwd: ROOT_DIR, interactive: true, allowBranchSwitch: true });
  handleRestartOnUpdate(spawn, syncResult, ROOT_DIR);

  // ---- Sync user data repo (separate nested git repo) ----
  const userRepoDir = join(ROOT_DIR, 'user');
  if (existsSync(join(userRepoDir, '.git'))) {
    await checkUserRepoUpdates({ cwd: userRepoDir, interactive: true });
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

  // ---- Timestamped backup (preserved, never overwritten) ----
  if (existsSync(ConfigPath)) {
    if (!existsSync(BackupDir)) {
      mkdirSync(BackupDir, { recursive: true });
    }
    const ts = timestamp();
    const backupFile = join(BackupDir, `opencode-${ts}.json`);
    copyFileSync(ConfigPath, backupFile);
    log(DARK_GRAY, `  Previous config backed up -> data\\backups\\opencode-${ts}.json`);
  }

  // ---- Check template exists ----
  if (!existsSync(TemplatePath)) {
    log(RED, '  ERROR: Normal mode template not found at config/opencode-normal.json');
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

  let templateText = readFileSync(TemplatePath, 'utf-8');
  if (templateText.charCodeAt(0) === 0xFEFF) templateText = templateText.slice(1);

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
    let configObj = JSON.parse(runtimeJson);
    injectProviders(configObj);
    const finalJson = JSON.stringify(configObj, null, 2);
    writeFileSync(ConfigPath, finalJson, 'utf-8');
    log(DARK_GREEN, `  Config written (${allInstructions.length} instruction files)`);
  } catch (e) {
    log(RED, `  ERROR: Generated config is invalid JSON!`);
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

  // ---- Ensure Handy portable flag ----
  if (isWin && existsSync(HandyBin)) {
    const portableFlag = join(ROOT_DIR, 'handy-voice', 'Handy', 'portable');
    if (!existsSync(portableFlag)) {
      writeFileSync(portableFlag, '', 'utf-8');
    }
  }

  // ---- Normalize backslash paths ----
  try {
    if (isWin) {
      const fixPs1 = join(ROOT_DIR, 'scripts', 'fix-paths.ps1');
      if (existsSync(fixPs1)) pwsh(['-File', fixPs1], { timeout: 15000, stdio: 'ignore' });
    } else {
      const fixMjs = join(ROOT_DIR, 'scripts', 'fix-paths.mjs');
      if (existsSync(fixMjs)) run('node', [fixMjs], { timeout: 15000, stdio: 'ignore' });
    }
  } catch {
    // non-critical
  }

  // ---- Check dependency updates (shared module) ----
  const { checkAndPromptUpdates } = await import('./check-updates.mjs');
  await checkAndPromptUpdates({ skipIfNoPowerShell: !isWin });

  // ---- Check for new models (Win only) ----
  let hasNewModels = false;
  if (isWin) {
    try {
      const checkModelsScript = join(ROOT_DIR, 'scripts', 'check-models.ps1');
      if (existsSync(checkModelsScript)) {
        pwsh(['-File', checkModelsScript, '-CheckOnly', '-SkipNvidiaFreeCheck'], { timeout: 60000, stdio: 'inherit' });

        const modelStatusFile = join(ROOT_DIR, 'data', 'model-update-status.json');
        if (existsSync(modelStatusFile)) {
          const modelStatus = readJson(modelStatusFile);
          if (modelStatus && modelStatus.new_models_count > 0) {
            hasNewModels = true;
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

  // ---- Show agent model dashboard ----
  try {
    if (existsSync(ConfigPath)) {
      const config = readJson(ConfigPath);
      if (config && config.agent) {
        const agents = Object.entries(config.agent);
        // Group: primary first, then free sub-agents, then paid sub-agents
        const primary = agents.filter(([n]) => n === 'glitch');
        const freeSub = agents.filter(([n]) => n !== 'glitch' && !n.endsWith('-paid'));
        const paidSub = agents.filter(([n]) => n.endsWith('-paid'));
        const ordered = [...primary, ...freeSub, ...paidSub];

        const rows = ordered.map(([name, def]) => {
          const model = def.model || '(none)';
          const tier = model.includes('-free') || model.startsWith('nvidia/') ? 'free' :
                       model.startsWith('opencode-go/') ? 'paid' : 'free';
          return { name, model, tier };
        });

        const maxNameLen = Math.max(...rows.map(r => r.name.length), 6);
        const maxModelLen = Math.max(...rows.map(r => r.model.length), 6);
        const separator = '─'.repeat(maxNameLen + maxModelLen + 22);

        log(DARK_GRAY, `  ${separator}`);
        log(DARK_GRAY, `  Agent${' '.repeat(maxNameLen - 5)}  Model${' '.repeat(Math.max(0, maxModelLen - 5))}  Tier`);
        log(DARK_GRAY, `  ${separator}`);
        for (const r of rows) {
          const namePad = r.name.padEnd(maxNameLen);
          const modelPad = r.model.padEnd(maxModelLen);
          const tierColor = r.tier === 'free' ? DARK_GREEN : DARK_YELLOW;
          log(DARK_GRAY, `  @${namePad}  ${modelPad}  ${tierColor}${r.tier}${DARK_GRAY}`);
        }
        log(DARK_GRAY, `  ${separator}`);
      }
    }
  } catch {
    // non-critical
  }

  // ---- Resolve model assignments (Win only; only prompt when new models available) ----
  if (isWin) {
    try {
      const resolverScript = join(ROOT_DIR, 'scripts', 'resolve-models.mjs');
      if (existsSync(resolverScript) && existsSync(join(ROOT_DIR, 'data', 'model-registry.json'))) {
        // Always run resolver silently (keeps model-assignment.json current)
        run('node', [resolverScript], { timeout: 30000, stdio: 'ignore' });

        if (hasNewModels) {
          // Only show output and prompt when genuinely new models are available
          const assignmentFile = join(ROOT_DIR, 'data', 'model-assignment.json');
          if (existsSync(assignmentFile)) {
            const assignment = readJson(assignmentFile);
            if (assignment && assignment.has_changes) {
              log(YELLOW, `  ${assignment.changes.length} model assignment change(s) possible with new models`);
              for (const c of assignment.changes) {
                log(DARK_GRAY, `    @${c.agent}: ${c.old_model || '(none)'} -> ${c.new_model}`);
              }

              // Check preference file for autonomy choice
              const prefFile = join(ROOT_DIR, 'data', 'model-resolver-preference.json');
              let autoApply = false;
              if (existsSync(prefFile)) {
                const pref = readJson(prefFile);
                if (pref && pref.autonomous) {
                  autoApply = true;
                }
              } else {
                // No preference yet — ask the user once
                log(DARK_GRAY, '');
                log(CYAN, '  [Model Budget System]');
                log(DARK_YELLOW, '  New models available that may improve agent performance.');
                const rl = createInterface({ input: process.stdin, output: process.stdout });
                const answer = await new Promise(resolve => {
                  rl.question(DARK_YELLOW + '  Apply automatically? (Y/n): ' + RESET, resolve);
                });
                rl.close();
                const trimmed = answer.trim().toLowerCase();
                if (trimmed === '' || trimmed === 'y' || trimmed === 'yes') {
                  autoApply = true;
                }
                // Save preference for next time
                writeFileSync(prefFile, JSON.stringify({
                  autonomous: autoApply,
                  timestamp: new Date().toISOString()
                }, null, 2), 'utf-8');
              }

              if (autoApply) {
                log(DARK_GRAY, '  Applying model assignments...');
                run('node', [resolverScript, '--apply'], { timeout: 15000 });
                log(GREEN, '  Model assignments applied.');
                log(DARK_YELLOW, '  Restart opencode to activate.');
              } else {
                log(DARK_GRAY, '  Skipping — use `node scripts/resolve-models.mjs --apply` to apply later');
              }
            }
          }
        }
      }
    } catch {
      log(DARK_YELLOW, '  Model assignment resolution skipped (non-critical)');
    }
  }

  // ---- Sync user memory data from private repo (handled by checkUserRepoUpdates above) ----

// ---- Auto-update opencode to latest (minor/patch) + sync local binary ----
  // Uses global npm install, then syncs local binary from global install
  try {
    const globalVer = run(NPM_BIN === 'npm.cmd' ? 'npm.cmd' : 'npm', ['--version'], { timeout: 5000 });
    if (!globalVer.success) {
      log(DARK_YELLOW, '  npm not available, skipping opencode update check');
    } else {
      const currentGlobal = run(OPENCODE_BIN_NAME === 'opencode.exe' ? 'opencode.cmd' : 'opencode', ['--version'], { timeout: 10000 });
      const currentVer = currentGlobal.success ? currentGlobal.stdout : 'unknown';

      const npmView = run(NPM_BIN, ['view', 'opencode-ai', 'version'], { timeout: 15000 });
      const latestVer = npmView.success ? npmView.stdout : 'unknown';

      const needsUpdate = currentVer !== 'unknown' && latestVer !== 'unknown' && currentVer !== latestVer;

      if (needsUpdate) {
        const cvParts = currentVer.split('.');
        const lvParts = latestVer.split('.');
        const autoSafe = cvParts[0] === lvParts[0];

        if (autoSafe) {
          log(CYAN, '  Updating opencode (' + currentVer + ' -> ' + latestVer + ')...');
          run(NPM_BIN, ['install', '-g', 'opencode-ai@latest'], { stdio: 'inherit', timeout: 60000 });
          const updatedVer = run(OPENCODE_BIN_NAME === 'opencode.exe' ? 'opencode.cmd' : 'opencode', ['--version'], { timeout: 10000 });
          log(GREEN, '  Done. Version: ' + (updatedVer.success ? updatedVer.stdout : currentVer));

          // Sync local binary from updated global install
          const npmRoot = run(NPM_BIN, ['root', '-g'], { timeout: 10000 });
          if (npmRoot.success) {
            const globalBin = join(npmRoot.stdout.trim(), 'opencode-ai', 'bin', OPENCODE_BIN_NAME);
            if (existsSync(globalBin) && existsSync(OpenCodeBin)) {
              const globalVersion = run(globalBin, ['--version'], { timeout: 5000 });
              const localVersion = run(OpenCodeBin, ['--version'], { timeout: 5000 });
              if (globalVersion.success && localVersion.success && localVersion.stdout.trim() !== globalVersion.stdout.trim()) {
                log(CYAN, '  Syncing local opencode binary (' + localVersion.stdout.trim() + ' -> ' + globalVersion.stdout.trim() + ')...');
                copyFileSync(globalBin, OpenCodeBin);
                log(GREEN, '  Done.');
              }
            }
          }
        } else {
          log(YELLOW, '  \u26A0 OpenCode major version available: ' + currentVer + ' -> ' + latestVer);
          log(YELLOW, '  Run: npm install -g opencode-ai@latest');
        }
      }
    }
  } catch (e) {
    log(YELLOW, '  WARNING: Binary sync failed: ' + (e.message || e));
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

  // ---- Start Handy (if not already running) ----
  const handyProcName = isWin ? 'handy' : 'Handy';
  if (!isProcessRunning(handyProcName)) {
    if (existsSync(HandyBin)) {
      log(CYAN, '  Starting Handy voice input...');
      if (isMac) {
        const handyApp = join(ROOT_DIR, 'handy-voice', 'Handy.app');
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
      await new Promise(r => setTimeout(r, 1000));
    } else {
      log(DARK_YELLOW, '  Handy not found (optional). Voice input disabled.');
    }
  } else {
    log(DARK_GREEN, '  Handy already running');
  }

  // ---- Launch ----
  if (isServe) {
    // Server (web) mode
    const { launchServer } = await import('./lib/server-mode.mjs');
    await launchServer({ OpenCodeBin, ROOT_DIR, HandyBin });
  } else {
    // TUI mode
    log(CYAN, '  Starting OpenCode...');
    console.log('');

    try {
      const result = run(OpenCodeBin, [], { cwd: ROOT_DIR, stdio: 'inherit', timeout: 0 });
      if (!result.success && result.status !== null) {
        log(RED, `  OpenCode exited with error (code ${result.status})`);
      }
    } catch (e) {
      log(RED, `  OpenCode exited with error: ${e.message || e}`);
    }

    console.log('');
    log(MAGENTA, 'Glitch session ended.');
  }
}

main().catch(e => {
  log(RED, `  Fatal error: ${e.message || e}`);
  process.exit(1);
});