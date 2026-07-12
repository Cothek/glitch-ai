#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync, renameSync, appendFileSync, rmSync, createWriteStream, unlinkSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawn } from 'child_process';
import { createInterface } from 'readline';
import { get as httpsGet } from 'https';
import { tmpdir } from 'os';
import { checkRepoUpdates, checkUserRepoUpdates, handleRestartOnUpdate } from './lib/git-sync.mjs';
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
const TemplatePath = join(ROOT_DIR, 'config', 'opencode-free.json');
const BackupDir = join(ROOT_DIR, 'data', 'backups');
const ModeFile = join(BackupDir, '.last-mode');
const PrefFile = join(ROOT_DIR, 'user', 'free-model-preference.json');
const FreeModelsFile = join(ROOT_DIR, 'data', 'free-models.json');
const UserDir = join(ROOT_DIR, 'user');

const NPM_BIN = isWin ? 'npm.cmd' : 'npm';
const GIT_BIN = 'git';
const POWERSHELL = isWin ? 'powershell.exe' : null;

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

function pwsh(args, opts = {}) {
  if (!POWERSHELL) return { success: false, stdout: '', status: -1, error: 'No PowerShell on this platform' };
  return run(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], opts);
}

// ---- Glitch utilities (shared across launch scripts) ----
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

      log(CYAN, `  Downloading Handy v${HANDY_VERSION} for Linux (${arch})....`);
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
    return false;
  }

  if (existsSync(HandyBin)) {
    log(GREEN, '  Handy installed!');
    return true;
  }
  return false;
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
        autoStashes.forEach(s => log(YELLOW, `  [stash] ${s}`));
        log(YELLOW, `  Run \`git stash pop\` to restore when ready.`);
        log('');
      }
    }
    return;
  }

  log(YELLOW, '');
  log(YELLOW, `  ΓÜá Currently on branch '${current}', not 'main'`);
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
      log(YELLOW, '  Or run: git stash push -m "wip" && node scripts/launch-free.mjs');
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

// ---- Sync glitch-ai repo from remote (branch-aware, shared module) ----
// Uses scripts/lib/git-sync.mjs - handles any branch, prompts interactively
// Replaces the old syncMainRepo() that only worked on 'main'

// --- Hardcoded fallback model groups (used when free-models.json is missing/stale) ---
const FallbackModelGroups = [
  {
    Name: 'OpenCode Zen (free tier)',
    Models: [
      { ID: 'opencode/deepseek-v4-flash-free', Name: 'DeepSeek V4 Flash', Tag: '' },
      { ID: 'opencode/qwen3.6-plus-free', Name: 'Qwen 3.6 Plus', Tag: '' },
      { ID: 'opencode/mimo-v2.5-free', Name: 'Mimo v2.5', Tag: '' },
      { ID: 'opencode/minimax-m3-free', Name: 'MiniMax M3', Tag: '' },
      { ID: 'opencode/nemotron-3-super-free', Name: 'Nemotron 3 Super', Tag: '' },
      { ID: 'opencode/big-pickle', Name: 'Big Pickle', Tag: '' }
    ]
  },
  {
    Name: 'NVIDIA (free endpoint, requires /connect)',
    Models: [
      // No static fallback models - the live list from check-models.ps1 is always used.
      // If NVIDIA isn't connected, this section stays empty and the user gets a message.
    ]
  },
  {
    Name: 'OpenRouter (free models, requires /connect)',
    Models: [
      { ID: 'openrouter/moonshotai/kimi-k2.6:free', Name: 'Kimi K2.6', Tag: '' },
      { ID: 'openrouter/qwen/qwen3-coder:free', Name: 'Qwen3 Coder', Tag: '' },
      { ID: 'openrouter/meta-llama/llama-3.3-70b-instruct:free', Name: 'Llama 3.3 70B', Tag: '' },
      { ID: 'openrouter/google/gemma-4-31b-it:free', Name: 'Gemma 4 31B', Tag: '' },
      { ID: 'openrouter/openai/gpt-oss-120b:free', Name: 'GPT-OSS 120B', Tag: '' },
      { ID: 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free', Name: 'Nemotron 3 Ultra', Tag: '' },
      { ID: 'openrouter/qwen/qwen3-next-80b-a3b-instruct:free', Name: 'Qwen3 Next 80B', Tag: '' },
      { ID: 'openrouter/nousresearch/hermes-3-llama-3.1-405b:free', Name: 'Hermes 3 405B', Tag: '' }
    ]
  }
];

// --- Load model groups from free-models.json (live cache) or fallback ---
function getModelGroups() {
  if (!existsSync(FreeModelsFile)) return FallbackModelGroups;

  try {
    const data = readJson(FreeModelsFile);
    if (!data || !data.providers || !Array.isArray(data.providers)) return FallbackModelGroups;

    if (data.generated_at) {
      const genTime = new Date(data.generated_at);
      const age = (Date.now() - genTime.getTime()) / (1000 * 60 * 60 * 24);
      if (age > 7) {
        log(YELLOW, ` [WARN] free-models.json is ${Math.floor(age)} days old. Run check-models.ps1 to refresh.`);
      }
    }

    const groups = [];
    for (const provider of data.providers) {
      if (!provider.models || provider.models.length === 0) continue;
      groups.push({
        Name: provider.name,
        Models: provider.models.map(m => ({
          ID: m.id,
          Name: m.name,
          Tag: m.id === 'nvidia/z-ai/glm-5.1' ? 'default' : ''
        }))
      });
    }

    if (groups.length > 0) return groups;
  } catch {
    log(YELLOW, ' [WARN] Could not parse free-models.json, using fallback list.');
  }

  return FallbackModelGroups;
}

// --- Preference helpers ---
function getPreference() {
  if (!existsSync(PrefFile)) return null;
  try {
    const pref = readJson(PrefFile);
    // Backward compat: old format had single 'model' field
    if (pref && pref.primary_model) return pref.primary_model;
    if (pref && pref.model) return pref.model; // old single-model format
    return null;
  } catch {
    return null;
  }
}

function getVisionPreference() {
  if (!existsSync(PrefFile)) return null;
  try {
    const pref = readJson(PrefFile);
    // Backward compat: old format had single 'model' field (vision = same as primary)
    if (pref && pref.vision_model) return pref.vision_model;
    if (pref && pref.model) return pref.model; // old single-model format -> primary used for vision
    return null;
  } catch {
    return null;
  }
}

function setPreference(primaryId, primaryName, visionId, visionName) {
  const dir = dirname(PrefFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(PrefFile, JSON.stringify({
    primary_model: primaryId,
    primary_name: primaryName,
    vision_model: visionId,
    vision_name: visionName,
    set_at: new Date().toISOString()
  }, null, 2), 'utf-8');
}

function showModelMenu(modelGroups, allModels, savedId, promptLabel) {
  const choices = [];
  let idx = 1;
  for (const group of modelGroups) {
    log(YELLOW, ` ${group.Name}`);
    for (const m of group.Models) {
      const marker = m.ID === savedId ? ' *' : '';
      const tagStr = m.Tag ? ` (${m.Tag})` : '';
      const nameColor = m.ID === savedId ? GREEN : WHITE;
      log(nameColor, `   [${idx}] ${m.Name}${tagStr}${marker}`);
      log(DARK_GRAY, `       ${m.ID}`);
      choices.push(m);
      idx++;
    }
    log('');
  }
  return choices;
}

// --- Build free mode prompt text ---
function buildFreePrompt(primaryId, primaryName, visionId, visionName) {
  const same = primaryId === visionId;
  const visionStr = same ? primaryId : visionId;
  const visionNameStr = same ? primaryName : visionName;
  return `You are Glitch running in FREE MODE. All agents use free models.

## Free Mode Rules
1. You have FULL permissions same capabilities as normal mode.
2. All agents use free models - there are NO paid fallback models available.
3. Premium features are generally UNAVAILABLE in OpenCode Zen free models, but some NVIDIA free endpoint models may support image/vision analysis and stronger coding capability depends on the specific model.
4. If a free model exhausts its quota, close this session and relaunch with a different model:
   - Set \`$env:GLITCH_FREE_MODEL\` for the primary model, or \`$env:GLITCH_FREE_VISION_MODEL\` for the vision model
   - Valid model IDs: opencode/..., nvidia/..., or openrouter/...
   - Or run \`node scripts/launch-free.mjs\` to pick new models
   - Then run \`node scripts/launch-free.mjs --pick\` again
5. Tell the user which models are active on session start so they know what to expect.
6. NVIDIA models require NVIDIA provider to be connected via /connect in the TUI first.

## Agent Selection (All Free)
| Task Type | Agent | Model |
|-----------|-------|-------|
| Bash, file ops, simple edits | @general | ${primaryId} (${primaryName}) |
| Code (1-5 files, standard logic) | @coder | ${primaryId} (${primaryName}) |
| Complex code (5+ files, auth, architecture) | @coder | ${primaryId} (${primaryName}) |
| Codebase research | @explore | ${primaryId} (${primaryName}) |
| Architecture / planning | @plan | ${primaryId} (${primaryName}) |
| Code scaffolding | @build | ${primaryId} (${primaryName}) |
| UI/design system work | @ui-designer | ${primaryId} (${primaryName}) |
| Code review / quality gate | @reviewer | ${primaryId} (${primaryName}) |
| Test writing / TDD | @testing | ${primaryId} (${primaryName}) |
${same ? '' : `| Image / visual analysis | @vision | ${visionId} (${visionName}) |`}

## Available Glitch Variants in Free Mode
- **Glitch (default)**: Delegates first, executes directly only as last resort. Uses @general, @explore, @plan, @build, @coder, @ui-designer, @reviewer, @testing, @vision sub-agents.
- **Glitch Omni**: Does everything itself -- no delegation. Executes code, writes files, runs bash directly. Use @glitch-omni to invoke.

## ⚡ Dispatch-First Mandate (Immutable)
Glitch's job is coordination. The first action for every code task is DISPATCH, not execution.

YOUR FIRST RESPONSE to any code task MUST include a task() dispatch call to the appropriate sub-agent - at the same time as creating the todowrite.

- I may NOT use \`edit\`/\`write\`/\`bash\` for code work UNLESS a sub-agent was dispatched first and failed
- Dispatch at todowrite time - send sub-agents in parallel while creating the task list
- Fallback chain: free agent -> direct execution (last resort - no paid fallbacks in free mode)
- Direct work (no dispatch needed): planning, reading, investigation, questions, config edits (R15)
- If caught violating: stop immediately, log FAILURE to scratchpad, dispatch correctly`;
}

const HELP_TEXT = `
  Glitch AI - Free Mode (cross-platform)

  Usage: node scripts/launch-free.mjs [options]

  Options:
    --help              Show this help
    --serve             Launch in server (web) mode instead of TUI

  Both model pickers (primary + vision) always appear in interactive mode.
  Saved preferences are shown as the default - press Enter to keep them.

  Set either model via environment variable to skip its picker entirely.

  Environment:
    GLITCH_FREE_MODEL          Set PRIMARY free model ID (for @general, @explore, @plan, @build)
    GLITCH_FREE_VISION_MODEL   Set VISION free model ID (for @vision agent only; default = primary)
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

  log(GREEN, '');
  log(GREEN, ' Glitch Free Mode');
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

  // ---- Initialize submodules if needed ----
  if (!existsSync(join(ROOT_DIR, 'glitch-memorycore', 'prompt-rules.md'))) {
    log(CYAN, '  Initializing glitch-memorycore submodule...');
    try {
      run(GIT_BIN, ['submodule', 'update', '--init', '--recursive'], { cwd: ROOT_DIR, timeout: 60000 });
    } catch {
      log(RED, '  Could not initialize submodules');
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

  // ---- Fetch available free models (visible, before model picker) ----
  log(CYAN, '  Fetching available free models...');
  if (POWERSHELL) {
    const checkModelsScript = join(ROOT_DIR, 'scripts', 'check-models.ps1');
    if (existsSync(checkModelsScript)) {
      try {
        // Show raw PS1 output (no -Silent, stdio: inherit) so user sees any errors
        pwsh(['-File', checkModelsScript, '-CheckOnly'], { timeout: 60000, stdio: 'inherit' });
      } catch {
        log(DARK_YELLOW, '  Model fetch script failed');
      }
    }
  } else {
    log(DARK_YELLOW, '  Live model fetch requires Windows');
  }

  // ---- Load model groups (live cache > fallback) ----
  const modelGroups = getModelGroups();

  // ---- Check if NVIDIA models are available (user needs /connect) ----
  const nvidiaGroup = modelGroups.find(g => g.Name && g.Name.includes('NVIDIA'));
  if (!nvidiaGroup || !nvidiaGroup.Models || nvidiaGroup.Models.length === 0) {
    log(DARK_YELLOW, '  NVIDIA: (no models available - run /connect nvidia in OpenCode TUI)');
  }

  // ---- Build flat lookup table ----
  const allModels = {};
  for (const group of modelGroups) {
    for (const m of group.Models) {
      allModels[m.ID] = { Name: m.Name, Group: group.Name, Tag: m.Tag };
    }
  }

  // ---- Determine models (env var > interactive menu with saved defaults) ----
  let primaryModel = null;
  let visionModel = null;

  // Helper: pick a single model interactively
  async function pickSingleModel(label, savedId, isVision) {
    log('');
    log(GREEN, ` ${label}`);
    const hasDefault = savedId && allModels[savedId];
    if (hasDefault) {
      log(CYAN, ` Current: ${savedId} (${allModels[savedId].Name})`);
      log(DARK_GRAY, ' Press Enter to keep current, or pick a number:');
    } else {
      log(DARK_GRAY, ' No saved preference. Pick a model:');
    }
    log('');

    const choices = showModelMenu(modelGroups, allModels, savedId);

    const selection = await askQuestion(`Pick a model (1-${choices.length}, or Enter for current): `);

    if (!selection.trim() && hasDefault) {
      log('');
      log(GREEN, ` Keeping current: ${savedId} (${allModels[savedId].Name})`);
      return savedId;
    }

    const num = parseInt(selection.trim(), 10);
    if (!isNaN(num) && num >= 1 && num <= choices.length) {
      const picked = choices[num - 1].ID;
      log('');
      log(GREEN, ` Selected: ${picked} (${allModels[picked].Name})`);
      return picked;
    }

    log('');
    log(RED, ' Invalid selection. Exiting.');
    process.exit(1);
  }

  // ---------------------------------------------------------------------
  // PRIMARY MODEL (for @general, @explore, @plan, @build)
  // Env var skips the picker; otherwise show interactive menu (saved preference = default)
  // ---------------------------------------------------------------------

  if (process.env.GLITCH_FREE_MODEL) {
    primaryModel = process.env.GLITCH_FREE_MODEL;
    log(CYAN, ` Primary model from env var: ${primaryModel}`);
  } else {
    // Show picker every time - saved preference marks the default with *
    primaryModel = await pickSingleModel('Primary Model (for @general, @explore, @plan, @build)', getPreference(), false);
  }

  // ---- Validate primary model ----
  if (!allModels[primaryModel]) {
    log('');
    log(RED, ` ERROR: Unknown primary model '${primaryModel}'`);
    log(YELLOW, ' Valid models:');
    for (const id of Object.keys(allModels).sort()) {
      log(YELLOW, `   ${id} - ${allModels[id].Name}`);
    }
    log('');
    process.exit(1);
  }

  const primaryName = allModels[primaryModel].Name;

  // ---------------------------------------------------------------------
  // VISION MODEL (for @vision agent only)
  // Priority: GLITCH_FREE_VISION_MODEL env var > interactive prompt (default = primary model)
  // ---------------------------------------------------------------------

  if (process.env.GLITCH_FREE_VISION_MODEL) {
    visionModel = process.env.GLITCH_FREE_VISION_MODEL;
    log(CYAN, ` Vision model from env var: ${visionModel}`);
  }

  if (!visionModel) {
    const savedVision = getVisionPreference();
    const visionDefault = (savedVision && allModels[savedVision]) ? savedVision : primaryModel;

    log('');
    log(DARK_GRAY, ' -- Vision Model (for @vision agent only) --');
    log(DARK_GRAY, ' Press Enter to use primary model for vision, or pick a separate model.');
    log(DARK_GRAY, ` Default: ${visionDefault} (${allModels[visionDefault].Name})`);
    log('');

    const visionChoices = showModelMenu(modelGroups, allModels, visionDefault);
    const visionSelection = await askQuestion(`Pick vision model (1-${visionChoices.length}, or Enter for default): `);

    if (!visionSelection.trim()) {
      visionModel = visionDefault;
      log('');
      log(GREEN, ` Using ${visionModel === primaryModel ? 'primary' : 'saved vision'} model for @vision: ${visionModel} (${allModels[visionModel].Name})`);
    } else {
      const num = parseInt(visionSelection.trim(), 10);
      if (!isNaN(num) && num >= 1 && num <= visionChoices.length) {
        visionModel = visionChoices[num - 1].ID;
        log('');
        log(GREEN, ` Vision model selected: ${visionModel} (${allModels[visionModel].Name})`);
      } else {
        log('');
        log(RED, ' Invalid selection. Using primary model for vision.');
        visionModel = primaryModel;
      }
    }
  }

  // ---- Validate vision model ----
  if (!allModels[visionModel]) {
    log(YELLOW, ` Unknown vision model '${visionModel}', falling back to primary model.`);
    visionModel = primaryModel;
  }

  const visionName = allModels[visionModel].Name;

  // ---- Save both preferences ----
  setPreference(primaryModel, primaryName, visionModel, visionName);

  log('');
  log(GREEN, ` Glitch Free Mode`);
  log(CYAN, ` Primary: ${primaryModel} (${primaryName})`);
  log(CYAN, ` Vision:  ${visionModel} (${visionName})`);
  log('');

  // ---- Backup previous config (timestamped, never overwritten) ----
  if (existsSync(ConfigPath)) {
    if (!existsSync(BackupDir)) mkdirSync(BackupDir, { recursive: true });
    const ts = timestamp();
    const backupFile = join(BackupDir, `opencode-${ts}.json`);
    copyFileSync(ConfigPath, backupFile);
    log(DARK_GRAY, `  Previous config backed up -> data\\backups\\opencode-${ts}.json`);
  }

  // ---- Check template exists ----
  if (!existsSync(TemplatePath)) {
    log(RED, '  ERROR: Free mode template not found at config/opencode-free.json');
    process.exit(1);
  }

  // ---- User Profile Detection ----
  let UserName = process.env.GLITCH_FREE_USER || process.env.GLITCH_USER || null;
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
      const { readdirSync } = await import('fs');
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
        log(DARK_GRAY, '  Set $env:GLITCH_USER=<name> or $env:GLITCH_FREE_USER=<name> to auto-select.');
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

  // ---- Model ID normalization (prevents double prefix / backslash issues) ----
  
  function normalizeModelId(modelId) {
    if (!modelId) return modelId;
    // 1. Strip leading/trailing slashes and whitespace
    let normalized = modelId.trim().replace(/^\/+|\/+$/g, '');
    // 2. Replace any backslashes with forward slashes (Windows env var issue)
    normalized = normalized.replace(/\\/g, '/');
    // 3. Fix double nvidia/nvidia/ prefix (historical bug in check-models.ps1)
    normalized = normalized.replace(/^nvidia\/nvidia\//, 'nvidia/');
    // 4. Ensure NVIDIA models have exactly one nvidia/ prefix
    if (normalized.startsWith('nvidia/') && !normalized.startsWith('nvidia/nvidia/')) {
      // Already correct
    } else if (normalized.startsWith('nvidia/')) {
      // Double prefix already handled above
    } else if (!normalized.includes('/') && !normalized.startsWith('opencode/') && !normalized.startsWith('openrouter/')) {
      // Bare model name without provider prefix - assume NVIDIA if it looks like a NVIDIA model
      // This is a fallback, normally model IDs should always have provider prefix
    }
    return normalized;
  }

  // Normalize both model IDs before use
  primaryModel = normalizeModelId(primaryModel);
  visionModel = normalizeModelId(visionModel);

  // ---- Generate runtime config from template ----
  log(CYAN, '  Generating free mode config...');

  const templateText = readFileSync(TemplatePath, 'utf-8');

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
  let withModels = templateText.replace(/__MODEL__/g, primaryModel);
  withModels = withModels.replace(/__VISION_MODEL__/g, visionModel);
  const runtimeJson = withModels.replace(/"[Ii]nstructions"\s*:\s*\[[^\]]*\]/, instrBlock);
  const configObj = JSON.parse(runtimeJson);

  // Set the free mode prompt directly on the parsed object (avoids string escaping)
  configObj.agent.glitch.prompt = buildFreePrompt(primaryModel, primaryName, visionModel, visionName);

  // Inject shared providers (NVIDIA, LM Studio) from config/providers.json
  injectProviders(configObj);

  // Validate and write
  const finalJson = JSON.stringify(configObj, null, 2);
  try {
    JSON.parse(finalJson);
    log(DARK_GREEN, `  Config written (${allInstructions.length} instruction files)`);
  } catch (e) {
    log(RED, `  ERROR: Generated config is invalid JSON!`);
    log(RED, `  ${e.message}`);
    process.exit(1);
  }

  writeFileSync(ConfigPath, finalJson, 'utf-8');

  // ---- Write mode marker ----
  if (!existsSync(BackupDir)) mkdirSync(BackupDir, { recursive: true });
  writeFileSync(ModeFile, JSON.stringify({
    mode: 'free',
    timestamp: new Date().toISOString(),
    primary_model: primaryModel,
    vision_model: visionModel
  }, null, 2), 'utf-8');

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
  await checkAndPromptUpdates({ skipIfNoPowerShell: !POWERSHELL });

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

  // ---- Check + install Handy if missing ----
  log(CYAN, '  Checking Handy voice input...');
  await ensureHandy();

  // ---- Ensure Handy portable flag ----
  if (isWin && existsSync(HandyBin)) {
    const portableFlag = join(ROOT_DIR, 'handy-voice', 'Handy', 'portable');
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
  log(CYAN, ' Starting OpenCode in free mode...');
  log(GREEN, ` Primary: ${primaryModel} (${primaryName})`);
  if (primaryModel !== visionModel) {
    log(GREEN, ` Vision:  ${visionModel} (${visionName})`);
  } else {
    log(DARK_GREEN, ` Vision:  same as primary`);
  }
  log(DARK_GRAY, ' Switch models: node scripts/switch-model.mjs  |  Relaunch with: node scripts/launch-free.mjs --pick');
  log('');

  // ---- Backup paid agent files (-paid.md) during free mode (no paid fallbacks available) ----
  const AgentsDir = join(ROOT_DIR, '.opencode', 'agents');
  const AgentsBackupDir = join(tmpdir(), 'glitch-free-agents');

  function backupPaidAgentFiles() {
    try {
      if (!existsSync(AgentsDir)) return;
      if (existsSync(AgentsBackupDir)) rmSync(AgentsBackupDir, { recursive: true, force: true });
      mkdirSync(AgentsBackupDir, { recursive: true });
      const files = readdirSync(AgentsDir).filter(f => f.endsWith('-paid.md'));
      for (const f of files) {
        copyFileSync(join(AgentsDir, f), join(AgentsBackupDir, f));
        unlinkSync(join(AgentsDir, f));
      }
      if (files.length > 0) {
        log(DARK_GRAY, `  Backed up ${files.length} paid agent file(s) (not available in free mode)`);
      }
    } catch (e) {
      log(YELLOW, `  WARNING: Could not backup paid agent files: ${e.message}`);
    }
  }

  function restorePaidAgentFiles() {
    try {
      if (!existsSync(AgentsBackupDir)) return;
      if (!existsSync(AgentsDir)) mkdirSync(AgentsDir, { recursive: true });
      const files = readdirSync(AgentsBackupDir).filter(f => f.endsWith('-paid.md'));
      for (const f of files) {
        copyFileSync(join(AgentsBackupDir, f), join(AgentsDir, f));
      }
      rmSync(AgentsBackupDir, { recursive: true, force: true });
      if (files.length > 0) {
        log(DARK_GRAY, `  Restored ${files.length} paid agent file(s)`);
      }
    } catch (e) {
      log(YELLOW, `  WARNING: Could not restore paid agent files: ${e.message}`);
    }
  }

  backupPaidAgentFiles();

  if (isServe) {
    // Server (web) mode
    const { launchServer } = await import('./lib/server-mode.mjs');
    await launchServer({ OpenCodeBin, ROOT_DIR, HandyBin });
    restorePaidAgentFiles();
    log('');
    log(GREEN, 'Free mode ended.');
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

    // ---- Restore paid agent files ----
    restorePaidAgentFiles();

    log('');
    log(GREEN, 'Free mode ended.');
  }
}

main().catch(e => {
  log(RED, `  Fatal error: ${e.message || e}`);
  process.exit(1);
});