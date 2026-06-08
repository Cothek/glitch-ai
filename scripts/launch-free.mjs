#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCRIPT_DIR = __dirname;
const ROOT_DIR = resolve(SCRIPT_DIR, '..');
const isWin = process.platform === 'win32';

const OPENCODE_BIN_NAME = isWin ? 'opencode.exe' : 'opencode';
const OpenCodeBin = join(ROOT_DIR, 'opencode', OPENCODE_BIN_NAME);
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

function log(color, msg) {
  console.log(`${color}${msg}${RESET}`);
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
    return (pref && pref.model) ? pref.model : null;
  } catch {
    return null;
  }
}

function setPreference(modelId, modelName) {
  const dir = dirname(PrefFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(PrefFile, JSON.stringify({
    model: modelId,
    name: modelName,
    set_at: new Date().toISOString()
  }, null, 2), 'utf-8');
}

// --- Build free mode prompt text ---
function buildFreePrompt(modelId, modelName) {
  return `You are Glitch running in FREE MODE. All agents are using the free model "${modelId}" (${modelName}).

## Free Mode Rules
1. You have FULL permissions same capabilities as normal mode.
2. ALL agents use "${modelId}" there are NO paid fallback models available.
3. Premium features are generally UNAVAILABLE in OpenCode Zen free models, but some NVIDIA free endpoint models may support image/vision analysis and stronger coding capability depends on the specific model.
4. If the free model exhausts its quota, close this session and relaunch with a different model:
- Set \`$env:GLITCH_FREE_MODEL\` to one of the valid model IDs (opencode/..., nvidia/..., or openrouter/...)
- Or run node scripts/launch-free.mjs to pick a new model
- Then run node scripts/launch-free.mjs --pick again
5. Tell the user which model is active on session start so they know what to expect.
6. NVIDIA models require NVIDIA provider to be connected via /connect in the TUI first.

## Agent Selection (All Free)
| Task Type | Agent | Model |
|-----------|-------|-------|
| Bash, file ops, simple edits | @general | ${modelId} |
| Code (1-5 files, standard logic) | @general | ${modelId} |
| Codebase research | @explore | ${modelId} |
| Architecture / planning | @plan | ${modelId} |
| Code scaffolding | @build | ${modelId} |

No premium agents (@coder, @vision, @reviewer, @general-paid, @build-paid) are available in free mode.`;
}

const HELP_TEXT = `
  Glitch AI - Free Mode (cross-platform)

  Usage: node scripts/launch-free.mjs [options]

  Options:
    --pick              Force interactive model picker (ignore saved preference)
    --help              Show this help

  Environment:
    GLITCH_FREE_MODEL   Set free model ID directly (overrides all)

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

  // ---- Determine model (priority: env var > --pick flag > menu with default) ----
  const forcePick = args.includes('--pick');
  let freeModel = null;

  // 1. Environment variable overrides everything (no menu)
  if (process.env.GLITCH_FREE_MODEL) {
    freeModel = process.env.GLITCH_FREE_MODEL;
    log(CYAN, ` Model from env var: ${freeModel}`);
  }

  // 2. If --pick flag, force interactive menu (ignore saved preference)
  if (forcePick && !process.env.GLITCH_FREE_MODEL) {
    freeModel = null;
  }

  // 3. If no model yet, show interactive menu (with saved preference as default)
  if (!freeModel) {
    const saved = getPreference();
    const hasDefault = saved && allModels[saved];

    log('');
    log(GREEN, ' Glitch Free Mode -- Model Picker');
    if (hasDefault) {
      log(CYAN, ` Current: ${saved} (${allModels[saved].Name})`);
      log(DARK_GRAY, ' Press Enter to keep current, or pick a number:');
    } else {
      log(DARK_GRAY, ' No saved preference. Pick a model:');
    }
    log('');

    const choices = [];
    let idx = 1;
    for (const group of modelGroups) {
      log(YELLOW, ` ${group.Name}`);
      for (const m of group.Models) {
        const marker = m.ID === saved ? ' *' : '';
        const tagStr = m.Tag ? ` (${m.Tag})` : '';
        const nameColor = m.ID === saved ? GREEN : WHITE;
        log(nameColor, `   [${idx}] ${m.Name}${tagStr}${marker}`);
        log(DARK_GRAY, `       ${m.ID}`);
        choices.push(m);
        idx++;
      }
      log('');
    }

    const selection = await askQuestion(`Pick a model (1-${choices.length}, or Enter for current): `);

    if (!selection.trim() && hasDefault) {
      freeModel = saved;
      log('');
      log(GREEN, ` Keeping current: ${freeModel} (${allModels[freeModel].Name})`);
    } else {
      const num = parseInt(selection.trim(), 10);
      if (!isNaN(num) && num >= 1 && num <= choices.length) {
        freeModel = choices[num - 1].ID;
        setPreference(freeModel, allModels[freeModel].Name);
        log('');
        log(GREEN, ` Saved preference: ${freeModel} (${allModels[freeModel].Name})`);
      } else {
        log('');
        log(RED, ' Invalid selection. Exiting.');
        process.exit(1);
      }
    }
  }

  // ---- Validate model ----
  if (!allModels[freeModel]) {
    log('');
    log(RED, ` ERROR: Unknown free model '${freeModel}'`);
    log(YELLOW, ' Valid models:');
    for (const id of Object.keys(allModels).sort()) {
      log(YELLOW, `   ${id} - ${allModels[id].Name}`);
    }
    log('');
    log(CYAN, ' Set GLITCH_FREE_MODEL, run with --pick, or use switch-model.ps1');
    process.exit(1);
  }

  const modelName = allModels[freeModel].Name;

  log('');
  log(GREEN, ` Glitch Free Mode`);
  log(CYAN, ` Model: ${freeModel} (${modelName})`);
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
  const withModel = templateText.replace(/__MODEL__/g, freeModel);
  const configObj = JSON.parse(withModel);

  // Set the free mode prompt directly on the parsed object (avoids string escaping)
  configObj.agent.glitch.prompt = buildFreePrompt(freeModel, modelName);

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
    model: freeModel
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
        pwsh(['-File', checkUpdatesScript, '-CheckOnly'], { timeout: 60000, stdio: 'ignore' });

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
        pwsh(['-File', checkModelsScript, '-CheckOnly'], { timeout: 60000, stdio: 'ignore' });

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
  try {
    const globalVerCmd = OPENCODE_BIN_NAME === 'opencode.exe' ? 'opencode.cmd' : 'opencode';
    const globalVer = run(globalVerCmd, ['--version'], { timeout: 10000 });
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
        const updatedVer = run(globalVerCmd, ['--version'], { timeout: 10000 });
        log(GREEN, `  Done. Version: ${updatedVer.success ? updatedVer.stdout : currentGlobal}`);
      }
    }

    // Sync local binary from updated global install
    const npmRoot = run(NPM_BIN, ['root', '-g'], { timeout: 10000 });
    if (npmRoot.success) {
      const globalBin = join(npmRoot.stdout.trim(), 'opencode-ai', 'bin', OPENCODE_BIN_NAME);
      if (existsSync(globalBin) && existsSync(OpenCodeBin)) {
        const gv = run(globalBin, ['--version'], { timeout: 5000 });
        const lv = run(OpenCodeBin, ['--version'], { timeout: 5000 });
        if (gv.success && lv.success && lv.stdout.trim() !== gv.stdout.trim()) {
          log(CYAN, `  Syncing local opencode binary (${lv.stdout.trim()} -> ${gv.stdout.trim()})...`);
          copyFileSync(globalBin, OpenCodeBin);
          log(GREEN, '  Done.');
        }
      }
    }
  } catch (e) {
    log(YELLOW, `  WARNING: Binary sync failed: ${e.message || e}`);
  }

  // ---- Launch OpenCode ----
  log('');
  log(CYAN, ' Starting OpenCode in free mode...');
  log(GREEN, ` Model: ${freeModel} (${modelName})`);
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
