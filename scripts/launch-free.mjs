#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync, renameSync, appendFileSync, rmSync, createWriteStream, unlinkSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawn } from 'child_process';
import { createInterface } from 'readline';
import { get as httpsGet } from 'https';
import { tmpdir } from 'os';

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
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function pwsh(args, opts = {}) {
  if (!POWERSHELL) return { success: false, stdout: '', status: -1, error: 'No PowerShell on this platform' };
  return run(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], opts);
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
      { ID: 'nvidia/z-ai/glm-5.1', Name: 'GLM-5.1', Tag: 'default' },
      { ID: 'nvidia/qwen/qwen3-coder-480b-a35b-instruct', Name: 'Qwen3-Coder 480B', Tag: '' },
      { ID: 'nvidia/minimaxai/minimax-m2.7', Name: 'MiniMax M2.7', Tag: '' },
      { ID: 'nvidia/stepfun-ai/step-3.7-flash', Name: 'Step 3.7 Flash', Tag: '' },
      { ID: 'nvidia/mistralai/mistral-large-3-675b-instruct-2512', Name: 'Mistral Large 3', Tag: '' }
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
    if (pref && pref.model) return pref.model; // old single-model format → primary used for vision
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
2. All agents use free models — there are NO paid fallback models available.
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
| Code (1-5 files, standard logic) | @general | ${primaryId} (${primaryName}) |
| Codebase research | @explore | ${primaryId} (${primaryName}) |
| Architecture / planning | @plan | ${primaryId} (${primaryName}) |
| Code scaffolding | @build | ${primaryId} (${primaryName}) |
${same ? '' : `| Image / visual analysis | @vision | ${visionId} (${visionName}) |`}

No premium agents (@coder, @reviewer, @general-paid, @build-paid) are available in free mode.`;
}

const HELP_TEXT = `
  Glitch AI - Free Mode (cross-platform)

  Usage: node scripts/launch-free.mjs [options]

  Options:
    --pick              Force interactive model picker (ignore saved preference)
    --help              Show this help

  Environment:
    GLITCH_FREE_MODEL          Set PRIMARY free model ID (for @general, @explore, @plan, @build)
    GLITCH_FREE_VISION_MODEL   Set VISION free model ID (for @vision agent only; default = primary)

  Priority: env var > --pick flag > saved preference > interactive menu
  `;

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(HELP_TEXT);
  process.exit(0);
}

async function main() {
  log(GREEN, '');
  log(GREEN, ' Glitch Free Mode');
  log(GREEN, '');

  // ---- Validate opencode binary ----
  if (!existsSync(OpenCodeBin)) {
    log(RED, ' OpenCode not found. Run bootstrap first.');
    process.exit(1);
  }

  // ---- Run check-models.ps1 silently to refresh cache (Win only) ----
  if (POWERSHELL) {
    const checkModelsScript = join(ROOT_DIR, 'scripts', 'check-models.ps1');
    if (existsSync(checkModelsScript)) {
      try {
        pwsh(['-File', checkModelsScript, '-CheckOnly', '-Silent'], { timeout: 30000, stdio: 'ignore' });
      } catch {}
    }
  }

  // ---- Load model groups (live cache > fallback) ----
  const modelGroups = getModelGroups();

  // ---- Build flat lookup table ----
  const allModels = {};
  for (const group of modelGroups) {
    for (const m of group.Models) {
      allModels[m.ID] = { Name: m.Name, Group: group.Name, Tag: m.Tag };
    }
  }

  // ---- Determine models (priority: env var > --pick flag > menu with defaults) ----
  const forcePick = args.includes('--pick');
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

  // ═══════════════════════════════════════════
  // PRIMARY MODEL (for @general, @explore, @plan, @build)
  // Priority: GLITCH_FREE_MODEL env var > --pick flag > saved preference > interactive menu
  // ═══════════════════════════════════════════

  if (process.env.GLITCH_FREE_MODEL) {
    primaryModel = process.env.GLITCH_FREE_MODEL;
    log(CYAN, ` Primary model from env var: ${primaryModel}`);
  } else if (forcePick) {
    primaryModel = null; // force interactive
  } else {
    const saved = getPreference();
    if (saved && allModels[saved]) {
      primaryModel = saved;
      log(CYAN, ` Primary model from saved preference: ${primaryModel} (${allModels[primaryModel].Name})`);
    }
  }

  if (!primaryModel) {
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

  // ═══════════════════════════════════════════
  // VISION MODEL (for @vision agent only)
  // Priority: GLITCH_FREE_VISION_MODEL env var > interactive prompt (default = primary model)
  // ═══════════════════════════════════════════

  if (process.env.GLITCH_FREE_VISION_MODEL) {
    visionModel = process.env.GLITCH_FREE_VISION_MODEL;
    log(CYAN, ` Vision model from env var: ${visionModel}`);
  }

  if (!visionModel) {
    const savedVision = getVisionPreference();
    const visionDefault = (savedVision && allModels[savedVision]) ? savedVision : primaryModel;

    log('');
    log(DARK_GRAY, ' ── Vision Model (for @vision agent only) ──');
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

  // ---- Generate runtime config from template ----
  log(CYAN, '  Generating free mode config...');

  const templateText = readFileSync(TemplatePath, 'utf-8');
  let withModels = templateText.replace(/__MODEL__/g, primaryModel);
  withModels = withModels.replace(/__VISION_MODEL__/g, visionModel);
  const configObj = JSON.parse(withModels);

  // Set the free mode prompt directly on the parsed object (avoids string escaping)
  configObj.agent.glitch.prompt = buildFreePrompt(primaryModel, primaryName, visionModel, visionName);

  // Validate and write
  const finalJson = JSON.stringify(configObj, null, 2);
  try {
    JSON.parse(finalJson);
    log(DARK_GREEN, '  Free mode config is valid JSON');
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

  // ---- Initialize submodules if needed ----
  if (!existsSync(join(ROOT_DIR, 'glitch-memorycore', 'prompt-rules.md'))) {
    log(YELLOW, ' Initializing glitch-memorycore...');
    try {
      run(GIT_BIN, ['submodule', 'update', '--init', '--recursive'], { cwd: ROOT_DIR, timeout: 60000 });
    } catch {
      log(RED, ' Could not initialize submodules');
    }
  }

  // ---- Check dependency updates & offer interactive update ----
  if (POWERSHELL) {
    log(CYAN, '  Checking dependency updates...');
    const checkUpdatesScript = join(ROOT_DIR, 'scripts', 'check-updates.ps1');
    if (existsSync(checkUpdatesScript)) {
      try {
        pwsh(['-File', checkUpdatesScript, '-CheckOnly'], { timeout: 60000, stdio: 'inherit' });

        const statusFile = join(ROOT_DIR, 'data', 'update-status.json');
        if (existsSync(statusFile)) {
          const status = readJson(statusFile);
          if (status && status.updates_available > 0) {
            const updateItems = (status.items || []).filter(i => i.update_available);

            log('');
            log(YELLOW, '  ===== Updates Available =====');
            updateItems.forEach((item, i) => {
              log(CYAN, `  [${i + 1}] ${item.name}`);
              log(DARK_YELLOW, `      ${item.current} -> ${item.latest}`);
            });
            log('');
            log(WHITE, "  Enter numbers to select (e.g. '1,3'),");
            log(WHITE, "  press Enter to apply all, or type 's' to skip:");
            const selection = await askQuestion('  > ');

            if (selection.trim().toLowerCase() === 's') {
              log(DARK_YELLOW, '  Skipping updates.');
            } else {
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
                pwsh(['-Command', `& '${checkUpdatesScript.replace(/'/g, "''")}' -Update -Filter @(${filterExpr})`], { stdio: 'inherit', timeout: 120000 });
              } else {
                log(CYAN, '  Applying all updates...');
                pwsh(['-File', checkUpdatesScript, '-Update'], { stdio: 'inherit', timeout: 120000 });
              }
              log(GREEN, '  Updates complete.');
            }
          } else {
            log(DARK_GREEN, '  All dependencies up-to-date');
          }
        }
      } catch {
        log(DARK_YELLOW, '  Update check skipped (non-critical)');
      }
    }
  } else {
    log(DARK_GRAY, '  Dependency update check skipped (Windows-only PS1 scripts)');
  }

  // ---- Check for new models ----
  if (POWERSHELL) {
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

  // ---- Sync user memory data from private repo ----
  if (existsSync(join(UserDir, '.git'))) {
    try {
      run(GIT_BIN, ['fetch', 'origin', 'main'], { cwd: UserDir, timeout: 15000 });
      const behind = run(GIT_BIN, ['rev-list', '--count', 'HEAD..origin/main'], { cwd: UserDir, timeout: 10000 });

      if (behind.success && /^\d+$/.test(behind.stdout)) {
        const behindInt = parseInt(behind.stdout, 10);
        if (behindInt > 0) {
          const dirty = run(GIT_BIN, ['status', '--porcelain'], { cwd: UserDir, timeout: 5000 });
          const dirtyCount = dirty.success && dirty.stdout
            ? dirty.stdout.split('\n').filter(l => l.trim().length > 0).length
            : 0;

          if (dirtyCount === 0) {
            log(CYAN, `  Syncing user data (${behindInt} commit(s) behind)...`);
            const pullRes = run(GIT_BIN, ['pull', 'origin', 'main'], { cwd: UserDir, stdio: 'inherit', timeout: 30000 });
            if (pullRes.success) log(GREEN, '  User data synced');
          } else {
            log(YELLOW, `  User data: ${behindInt} commit(s) behind, but working tree has ${dirtyCount} dirty file(s)`);
            log(YELLOW, "  Run 'node scripts/sync-user.ps1 -Pull' manually or commit changes first.");
          }
        }
      }
    } catch (e) {
      log(DARK_YELLOW, `  User data sync skipped (non-critical): ${e.message || e}`);
    }
  }

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
            log(CYAN, '  Done.');
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
          logUpdate(`npm install reported failure -- stdout: ${installResult.stdout}, stderr: ${installResult.stderr}`);
          try { rmSync(updateDir, { recursive: true, force: true }); } catch {}
          logUpdate('=== opencode update check finished (failed) ===');
        }
      } else {
        logUpdate('autoSafe=false -- major version change, skipping auto-update');
      }
    } else {
      logUpdate('no update needed');
    }
  } catch (e) {
    log(YELLOW, `  WARNING: Binary sync failed: ${e.message || e}`);
    logUpdate(`UNCAUGHT EXCEPTION: ${e.message}`);
    logUpdate(`stack: ${e.stack}`);
  }

  // ---- TUI config: user/tui.json -> OPENCODE_TUI_CONFIG ----
  const TuiConfigPath = join(ROOT_DIR, 'user', 'tui.json');
  if (existsSync(TuiConfigPath)) {
    process.env.OPENCODE_TUI_CONFIG = TuiConfigPath;
    log(DARK_GREEN, '  TUI config loaded');
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

  // ---- Launch OpenCode ----
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

  try {
    const result = run(OpenCodeBin, [], { cwd: ROOT_DIR, stdio: 'inherit', timeout: 0 });
    if (!result.success && result.status !== null) {
      log(RED, ` OpenCode exited with error (code ${result.status})`);
    }
  } catch (e) {
    log(RED, ` OpenCode exited with error: ${e.message || e}`);
  }

  log('');
  log(GREEN, 'Free mode ended.');
}

main().catch(e => {
  log(RED, `  Fatal error: ${e.message || e}`);
  process.exit(1);
});
