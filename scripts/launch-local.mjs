#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync, createWriteStream, unlinkSync, rmSync, appendFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawn } from 'child_process';
import { createInterface } from 'readline';
import { get as httpsGet } from 'https';
import { tmpdir } from 'os';
import { checkRepoUpdates, checkUserRepoUpdates } from './lib/git-sync.mjs';

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
const TemplatePath = join(ROOT_DIR, 'config', 'opencode-local.json');
const BackupDir = join(ROOT_DIR, 'data', 'backups');
const ModeFile = join(BackupDir, '.last-mode');
const UserDir = join(ROOT_DIR, 'user');

const NPM_BIN = isWin ? 'npm.cmd' : 'npm';
const GIT_BIN = 'git';
const POWERSHELL = isWin ? 'powershell.exe' : null;

const UpdateLogPath = join(ROOT_DIR, 'data', 'opencode-update.log');

function logUpdate(msg) {
  try {
    const n = new Date();
    const ts = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')} ${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`;
    appendFileSync(UpdateLogPath, `[${ts}] ${msg}\n`, 'utf-8');
  } catch {}
}

// ---- Prepend bundled Node to PATH if available ----
const BundledNodeDir = join(ROOT_DIR, 'data', 'node');
const BundledNodeBin = join(BundledNodeDir, isWin ? 'node.exe' : 'node');
if (existsSync(BundledNodeBin)) {
  process.env.PATH = (isWin ? ';' : ':') + BundledNodeDir + process.env.PATH;
}

const DEFAULT_LOCAL_MODEL = 'google/gemma-4-12b';

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

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function pwsh(args, opts = {}) {
  if (!POWERSHELL) return { success: false, stdout: '', status: -1, error: 'No PowerShell on this platform' };
  return run(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], opts);
}

// ---- Sync glitch-ai repo from remote (branch-aware, shared module) ----
// Uses scripts/lib/git-sync.mjs — handles any branch, prompts interactively
// Replaces the old syncMainRepo() that only worked on 'main'

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
        autoStashes.forEach(s => log(YELLOW, `  📦 ${s}`));
        log(YELLOW, `  Run \`git stash pop\` to restore when ready.`);
        log('');
      }
    }
    return;
  }

  log(YELLOW, '');
  log(YELLOW, `  ⚠ Currently on branch '${current}', not 'main'`);
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
        log(YELLOW, '  ⚠ Working tree has uncommitted changes after checkout.');
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

function buildLocalPrompt(modelId, modelName) {
  return `You are Glitch running in LOCAL MODE. All agents are served by a local LLM (LM Studio).

## Local Mode Rules
1. You have FULL permissions same capabilities as normal mode.
2. ALL agents use the local model "${modelId}" (${modelName}).
3. No external API calls are made -- everything runs through LM Studio at 192.168.86.139:1234.
4. Local models are slower than cloud models but completely private and free.
5. The agents defined in .opencode/agents/ (coder, reviewer, vision, ui-designer, testing, etc.) are configured for paid cloud models -- do NOT dispatch to them.
6. Stick to the 5 local agents below. If the local model is not responding, tell the user to check their LM Studio instance and make sure the model is loaded.
7. Tell the user which model is active on session start so they know what to expect.

## Agent Selection (All Local)
| Task Type | Agent | Model |
|-----------|-------|-------|
| Bash, file ops, simple edits | @general | ${modelId} |
| Code (1-5 files, standard logic) | @general | ${modelId} |
| Codebase research | @explore | ${modelId} |
| Architecture / planning | @plan | ${modelId} |
| Code scaffolding | @build | ${modelId} |

## ⚡ Dispatch-First Mandate (Immutable)
Glitch's job is coordination. The first action for every code task is DISPATCH, not execution.

YOUR FIRST RESPONSE to any code task MUST include a task() dispatch call to the appropriate sub-agent - at the same time as creating the todowrite.

- I may NOT use \`edit\`/\`write\`/\`bash\` for code work UNLESS a sub-agent was dispatched first and failed
- Dispatch at todowrite time — send sub-agents in parallel while creating the task list
- Fallback chain: @general (local) → direct execution (last resort, none paid available)
- Direct work (no dispatch needed): memory writes (R12), git, planning, reading, questions
- If caught violating: stop, log FAILURE to scratchpad, dispatch correctly`;
}

const args = process.argv.slice(2);
const isServe = args.includes('--serve');
if (args.includes('--help')) {
  console.log(`
  Glitch AI - Local Mode (cross-platform)

  Usage: node scripts/launch-local.mjs [options]

  Options:
    --model <id>        Set local model ID (overrides GLITCH_LOCAL_MODEL)
    --serve             Launch in server (web) mode instead of TUI
    --help              Show this help

  Environment:
    GLITCH_LOCAL_MODEL  Set local model ID (default: ${DEFAULT_LOCAL_MODEL})

  All agents run through LM Studio at http://192.168.86.139:1234/v1.
  `);
  process.exit(0);
}

async function main() {
  // ---- Branch check (runs first) ----
  await checkAndSwitchToMain();
  log(GREEN, '');
  log(GREEN, ' Glitch AI - Local Mode');
  log(GREEN, '');

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
  await checkRepoUpdates({ cwd: ROOT_DIR, interactive: true, allowBranchSwitch: true });

  // ---- Sync user data repo (separate nested git repo) ----
  const userRepoDir = join(ROOT_DIR, 'user');
  if (existsSync(join(userRepoDir, '.git'))) {
    await checkUserRepoUpdates({ cwd: userRepoDir, interactive: true });
  }

  // ---- Auto-install Handy if missing ----
  log(CYAN, '  Checking Handy voice input...');
  await ensureHandy();

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
    log(RED, '  ERROR: Local mode template not found at config/opencode-local.json');
    process.exit(1);
  }

  // ---- Determine model (env var > --model flag > default) ----
  let localModel = DEFAULT_LOCAL_MODEL;
  let modelSource = 'default';

  const flagIdx = args.indexOf('--model');
  if (flagIdx !== -1 && flagIdx < args.length - 1) {
    localModel = args[flagIdx + 1];
    modelSource = '--model flag';
  } else if (process.env.GLITCH_LOCAL_MODEL) {
    localModel = process.env.GLITCH_LOCAL_MODEL;
    modelSource = 'env var';
  }

  const modelNameParts = localModel.split('/');
  const modelName = modelNameParts[modelNameParts.length - 1].replace(/-/g, ' ');

  log(CYAN, `  Model: ${localModel} (via ${modelSource})`);
  log(CYAN, `  Provider: LM Studio (http://192.168.86.139:1234/v1)`);

  // ---- User Profile Detection ----
  let UserName = process.env.GLITCH_USER || null;
  let userFound = false;

  if (UserName) {
    const subdirPath = join(ROOT_DIR, 'user', UserName);
    if (existsSync(join(subdirPath, 'main-memory.md'))) {
      userFound = true;
      log(CYAN, `  User profile: ${UserName}`);
    } else if (existsSync(join(ROOT_DIR, 'user', 'main-memory.md'))) {
      UserName = '';
      userFound = true;
      log(CYAN, '  User profile: (flat -- user/main-memory.md)');
    } else {
      log(YELLOW, `  WARNING: User '${UserName}' specified but no profile found at user/${UserName}`);
      log(YELLOW, `  Run: node setup.mjs --user ${UserName}`);
      UserName = null;
    }
  }

  if (!userFound) {
    const userBase = join(ROOT_DIR, 'user');
    if (existsSync(join(userBase, 'main-memory.md'))) {
      UserName = '';
      userFound = true;
      log(CYAN, '  User profile: (flat -- user/main-memory.md)');
    } else if (existsSync(userBase)) {
      const { readdirSync, statSync } = await import('fs');
      let profiles;
      try {
        const entries = readdirSync(userBase, { withFileTypes: true });
        profiles = entries
          .filter(e => e.isDirectory())
          .map(e => e.name)
          .filter(name => existsSync(join(userBase, name, 'main-memory.md')));
      } catch {
        profiles = [];
      }

      if (profiles.length === 1) {
        UserName = profiles[0];
        userFound = true;
        log(CYAN, `  User profile: ${UserName}`);
      } else if (profiles.length > 1) {
        log(YELLOW, '  Multiple user profiles found:');
        profiles.forEach((name, i) => {
          log(CYAN, `    [${i + 1}] ${name}`);
        });
        log(DARK_GRAY, '  Set $env:GLITCH_USER=<name> to auto-select.');
        UserName = profiles[0];
        userFound = true;
        log(CYAN, `  Using: ${UserName}`);
      }
    }
  }

  if (!userFound) {
    log(YELLOW, '  No user profile found.');
    log(CYAN, '  Starting with engine defaults (no user profile loaded).');
  }

  // ---- TUI config: user/tui.json -> OPENCODE_TUI_CONFIG ----
  const TuiConfigPath = join(ROOT_DIR, 'user', 'tui.json');
  if (existsSync(TuiConfigPath)) {
    process.env.OPENCODE_TUI_CONFIG = TuiConfigPath;
    log(DARK_GREEN, '  TUI config loaded');
  }

  // ---- Generate runtime config from template ----
  log(CYAN, '  Generating local mode config from template...');

  let templateText = readFileSync(TemplatePath, 'utf-8');
  if (templateText.charCodeAt(0) === 0xFEFF) templateText = templateText.slice(1);
  const withModel = templateText.replace(/__MODEL__/g, localModel);
  let configObj;
  try {
    configObj = JSON.parse(withModel);
  } catch (e) {
    log(RED, `  ERROR: Template is invalid JSON after model replacement!`);
    log(RED, `  ${e.message}`);
    process.exit(1);
  }

  // Set the local mode prompt directly on the parsed object
  configObj.agent.glitch.prompt = buildLocalPrompt(localModel, modelName);

  // Build instructions list (engine + user)
  const engineInstructions = [
    'glitch-memorycore/prompt-rules.md',
    'glitch-memorycore/CLAUDE.md',
    'glitch-memorycore/master-memory.md',
    'glitch-memorycore/core/identity.md',
    'glitch-memorycore/plugins/glitch-skills/skills-registry.md'
  ];

  let userInstructions = [];
  if (UserName && UserName !== '') {
    userInstructions = [
      `user/${UserName}/main-memory.md`,
      `user/${UserName}/current-session.md`,
      `user/${UserName}/reminders.md`,
      `user/${UserName}/session-dashboard.md`
    ];
  } else if (existsSync(join(ROOT_DIR, 'user', 'main-memory.md'))) {
    userInstructions = [
      'user/main-memory.md',
      'user/current-session.md',
      'user/reminders.md',
      'user/session-dashboard.md'
    ];
  }

  const allInstructions = [...engineInstructions, ...userInstructions];
  const instrJson = allInstructions.map(s => `    "${s}"`).join(',\n');
  const instrBlock = `"instructions": [\n${instrJson}\n  ]`;

  // Serialize the modified config object back to JSON, then replace instructions
  let runtimeJson = JSON.stringify(configObj, null, 2);
  runtimeJson = runtimeJson.replace(/"[Ii]nstructions"\s*:\s*\[[^\]]*\]/, instrBlock);

  try {
    JSON.parse(runtimeJson);
    writeFileSync(ConfigPath, runtimeJson, 'utf-8');
    log(DARK_GREEN, `  Config written (${allInstructions.length} instruction files)`);
  } catch (e) {
    log(RED, `  ERROR: Generated config is invalid JSON!`);
    log(RED, `  ${e.message}`);
    process.exit(1);
  }

  // ---- Write mode marker ----
  const modeInfo = JSON.stringify({
    mode: 'local',
    timestamp: new Date().toISOString(),
    model: localModel
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
  if (isWin) {
    try {
      const checkModelsScript = join(ROOT_DIR, 'scripts', 'check-models.ps1');
      if (existsSync(checkModelsScript)) {
        pwsh(['-File', checkModelsScript, '-CheckOnly'], { timeout: 60000, stdio: 'inherit' });

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
  // Uses temp dir (no admin needed) -- avoids npm install -g permissions issue
  try {
    logUpdate('=== opencode update check started ===');
    const currentLocal = run(OpenCodeBin, ['--version'], { timeout: 10000 });
    const currentVer = currentLocal.success ? currentLocal.stdout : 'unknown';
    logUpdate(`local binary version: ${currentVer} (success=${currentLocal.success})`);

    const npmView = run(NPM_BIN, ['view', 'opencode-ai', 'version'], { timeout: 15000 });
    const latestVer = npmView.success ? npmView.stdout : 'unknown';
    logUpdate(`npm latest version: ${latestVer} (success=${npmView.success})`);

    const needsUpdate = currentVer !== 'unknown' && latestVer !== 'unknown' && currentVer !== latestVer;
    logUpdate(`needsUpdate=${needsUpdate}`);

    if (needsUpdate) {
      const cvParts = currentVer.split('.');
      const lvParts = latestVer.split('.');
      const autoSafe = cvParts[0] === lvParts[0];
      logUpdate(`autoSafe=${autoSafe} (major versions: ${cvParts[0]} vs ${lvParts[0]})`);

      if (autoSafe) {
        log(CYAN, `  Updating opencode (${currentVer} -> ${latestVer})...`);
        const updateDir = join(tmpdir(), 'glitch-oc-update');
        logUpdate(`temp dir: ${updateDir}`);

        // Clean any previous attempt
        if (existsSync(updateDir)) rmSync(updateDir, { recursive: true, force: true });
        mkdirSync(updateDir, { recursive: true });

        logUpdate('starting npm install...');
        const installResult = run(NPM_BIN, ['install', 'opencode-ai@latest', '--no-save', '--prefix', updateDir], { timeout: 60000 });
        logUpdate(`npm install complete: success=${installResult.success}, stdout=${installResult.stdout}, stderr=${installResult.stderr}`);

        const newBin = join(updateDir, 'node_modules', 'opencode-ai', 'bin', OPENCODE_BIN_NAME);
        const newBinExists = existsSync(newBin);
        logUpdate(`new binary exists at ${newBin}: ${newBinExists}`);

        if (installResult.success && newBinExists) {
          // Rename old binary aside (works on Windows even while in use),
          // then copy new binary in place
          const oldBin = OpenCodeBin + '.old';
          try { if (existsSync(oldBin)) unlinkSync(oldBin); } catch {}
          try {
            logUpdate(`renaming ${OpenCodeBin} -> ${oldBin}`);
            renameSync(OpenCodeBin, oldBin);
            logUpdate(`copying ${newBin} -> ${OpenCodeBin}`);
            copyFileSync(newBin, OpenCodeBin);
            // Clean up old binary (no longer needed)
            try { unlinkSync(oldBin); logUpdate('old binary cleaned up'); } catch {}
            const updatedVer = run(OpenCodeBin, ['--version'], { timeout: 5000 });
            logUpdate(`update complete, version now: ${updatedVer.success ? updatedVer.stdout : 'unknown'}`);
            log(GREEN, '  Done.');
          } catch (e) {
            log(YELLOW, `  Update failed: ${e.message}`);
            logUpdate(`copy failed: ${e.message}`);
            // Try to restore old binary
            try { if (existsSync(oldBin)) { renameSync(oldBin, OpenCodeBin); logUpdate('restored old binary'); } } catch {}
          }

          // Clean up temp
          try { rmSync(updateDir, { recursive: true, force: true }); } catch {}
          logUpdate('=== opencode update check finished ===');
        } else {
          log(YELLOW, '  Update failed (npm install returned non-zero).');
          logUpdate(`npm install reported failure — stdout: ${installResult.stdout}, stderr: ${installResult.stderr}`);
          try { rmSync(updateDir, { recursive: true, force: true }); } catch {}
          logUpdate('=== opencode update check finished (failed) ===');
        }
      } else {
        logUpdate(`autoSafe=false — major version change, skipping auto-update`);
      }
    } else {
      logUpdate('no update needed');
    }
  } catch (e) {
    log(YELLOW, `  WARNING: Binary sync failed: ${e.message || e}`);
    logUpdate(`UNCAUGHT EXCEPTION: ${e.message}`);
    logUpdate(`stack: ${e.stack}`);
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

  // ---- Display model info ----
  log('');
  log(CYAN, ' Starting OpenCode in local mode...');
  log(GREEN, ` Model: ${localModel} via LM Studio (192.168.86.139:1234)`);
  log(DARK_GRAY, ' Make sure LM Studio is running and the model is loaded.');
  log('');

  if (isServe) {
    // Server (web) mode
    const { launchServer } = await import('./lib/server-mode.mjs');
    await launchServer({ OpenCodeBin, ROOT_DIR, HandyBin });
  } else {
    // TUI mode
    try {
      const result = run(OpenCodeBin, [], { cwd: ROOT_DIR, stdio: 'inherit', timeout: 0 });
      if (!result.success && result.status !== null) {
        log(RED, ` OpenCode exited with error (code ${result.status})`);
      }
    } catch (e) {
      log(RED, ` OpenCode exited with error: ${e.message || e}`);
    }

    log('');
    log(GREEN, 'Local mode ended.');
  }
}

main().catch(e => {
  log(RED, `  Fatal error: ${e.message || e}`);
  process.exit(1);
});
