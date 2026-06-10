#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCRIPT_DIR = __dirname;
const ROOT_DIR = resolve(SCRIPT_DIR, '..');
const isWin = process.platform === 'win32';

const OPENCODE_BIN_NAME = isWin ? 'opencode.exe' : 'opencode';
const OpenCodeBin = join(ROOT_DIR, 'opencode', OPENCODE_BIN_NAME);
const ConfigPath = join(ROOT_DIR, 'opencode.json');
const TemplatePath = join(ROOT_DIR, 'config', 'opencode-local.json');
const BackupDir = join(ROOT_DIR, 'data', 'backups');
const ModeFile = join(BackupDir, '.last-mode');
const UserDir = join(ROOT_DIR, 'user');

const NPM_BIN = isWin ? 'npm.cmd' : 'npm';
const GIT_BIN = 'git';
const POWERSHELL = isWin ? 'powershell.exe' : null;

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

- I may NOT use \`edit\`/\`write\`/\`bash\` for code work UNLESS a sub-agent was dispatched first and failed
- Dispatch at todowrite time — send sub-agents in parallel while creating the task list
- Fallback chain: @general (local) → direct execution (last resort, none paid available)
- Direct work (no dispatch needed): memory writes (R12), git, planning, reading, questions
- If caught violating: stop, log 🔧 FAILURE to scratchpad, dispatch correctly`;
}

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(`
  Glitch AI - Local Mode (cross-platform)

  Usage: node scripts/launch-local.mjs [options]

  Options:
    --model <id>        Set local model ID (overrides GLITCH_LOCAL_MODEL)
    --help              Show this help

  Environment:
    GLITCH_LOCAL_MODEL  Set local model ID (default: ${DEFAULT_LOCAL_MODEL})

  All agents run through LM Studio at http://192.168.86.139:1234/v1.
  `);
  process.exit(0);
}

function main() {
  log(GREEN, '');
  log(GREEN, ' Glitch AI - Local Mode');
  log(GREEN, '');

  // ---- Validate opencode binary ----
  if (!existsSync(OpenCodeBin)) {
    log(RED, ' OpenCode not found. Run bootstrap first.');
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

  log(CYAN, ` Model: ${localModel} (via ${modelSource})`);
  log(CYAN, ` Provider: LM Studio (http://192.168.86.139:1234/v1)`);
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
    log(RED, '  ERROR: Local mode template not found at config/opencode-local.json');
    log(YELLOW, '  Try running: git pull');
    process.exit(1);
  }

  // ---- Generate runtime config from template ----
  log(CYAN, '  Generating local mode config...');

  const templateText = readFileSync(TemplatePath, 'utf-8');
  const withModel = templateText.replace(/__MODEL__/g, localModel);
  const configObj = JSON.parse(withModel);

  // Set the local mode prompt directly on the parsed object (avoids string escaping)
  configObj.agent.glitch.prompt = buildLocalPrompt(localModel, modelName);

  // Validate and write
  const finalJson = JSON.stringify(configObj, null, 2);
  try {
    JSON.parse(finalJson);
    log(DARK_GREEN, '  Local mode config is valid JSON');
  } catch (e) {
    log(RED, `  ERROR: Generated config is invalid JSON!`);
    log(RED, `  ${e.message}`);
    process.exit(1);
  }

  writeFileSync(ConfigPath, finalJson, 'utf-8');

  // ---- Write mode marker ----
  if (!existsSync(BackupDir)) mkdirSync(BackupDir, { recursive: true });
  writeFileSync(ModeFile, JSON.stringify({
    mode: 'local',
    timestamp: new Date().toISOString(),
    model: localModel
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
            // Non-interactive in local mode -- just report available updates
            log('');
            log(DARK_GRAY, '  Run .\\scripts\\check-updates.ps1 -Update to apply.');
            log('');
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
  log(CYAN, ' Starting OpenCode in local mode...');
  log(GREEN, ` Model: ${localModel} via LM Studio (192.168.86.139:1234)`);
  log(DARK_GRAY, ' Make sure LM Studio is running and the model is loaded.');
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
  log(GREEN, 'Local mode ended.');
}

main().catch(e => {
  log(RED, `  Fatal error: ${e.message || e}`);
  process.exit(1);
});
