#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCRIPT_DIR = __dirname;
const ROOT_DIR = resolve(SCRIPT_DIR, '..');

const PrefFile = join(ROOT_DIR, 'user', 'launch-preference.json');

const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DARK_GREEN = '\x1b[32;2m';
const DARK_GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

function log(color, msg) {
  if (msg === undefined) {
    console.log(color);
  } else {
    console.log(`${color}${msg}${RESET}`);
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
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function writeJson(path, data) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

function normalizeMode(mode) {
  if (!mode) return null;
  mode = mode.toLowerCase().trim();

  // Old server mode -> normal-paid
  if (mode === 'serve' || mode === 'server') return 'normal-paid';

  // Already in combined format
  if (mode.includes('-')) {
    const parts = mode.split('-');
    if (parts.length !== 2) return null;
    const [delivery, modelTier] = parts;
    if (DELIVERIES.some(d => d.id === delivery) && MODELS.some(m => m.id === modelTier)) {
      return mode;
    }
    return null;
  }

  // Old single-word mode IDs -> normal-{mode}
  if (MODELS.some(m => m.id === mode)) {
    return `normal-${mode}`;
  }

  return null;
}

function getSavedMode() {
  const pref = readJson(PrefFile);
  if (pref && pref.last_mode) return normalizeMode(pref.last_mode);
  return null;
}

function saveMode(mode) {
  writeJson(PrefFile, { last_mode: mode, saved_at: new Date().toISOString() });
}

const DELIVERIES = [
  { id: 'normal', name: 'Normal Mode', desc: 'terminal interface' },
  { id: 'web', name: 'Web Mode', desc: 'web server' },
];

const MODELS = [
  { id: 'paid', name: 'Paid', desc: 'recommended' },
  { id: 'free', name: 'Free', desc: 'all agents use free models only' },
  { id: 'local', name: 'Local', desc: 'all agents via LM Studio (local LLM)' },
  { id: 'safe', name: 'Safe', desc: 'minimal config for fixing broken setup' },
];

const SCRIPT_MAP = {
  'normal-paid': { script: 'launch.mjs', args: [] },
  'normal-free': { script: 'launch-free.mjs', args: [] },
  'normal-local': { script: 'launch-local.mjs', args: [] },
  'normal-safe': { script: 'launch-safe.mjs', args: [] },
  'web-paid': { script: 'launch.mjs', args: ['--serve'] },
  'web-free': { script: 'launch-free.mjs', args: ['--serve'] },
  'web-local': { script: 'launch-local.mjs', args: ['--serve'] },
  'web-safe': { script: 'launch-safe.mjs', args: ['--serve'] },
};

function getModeLabel(combinedKey) {
  const [deliveryId, modelId] = combinedKey.split('-');
  const delivery = DELIVERIES.find(d => d.id === deliveryId);
  const model = MODELS.find(m => m.id === modelId);
  if (!delivery || !model) return combinedKey;
  return `${delivery.name} + ${model.name}`;
}

async function showDeliveryMenu(savedDeliveryId) {
  log(MAGENTA, '');
  log(MAGENTA, ' Glitch AI - Unified Launcher');
  log(MAGENTA, '');

  if (savedDeliveryId) {
    const saved = DELIVERIES.find(d => d.id === savedDeliveryId);
    if (saved) {
      log(CYAN, ` Last delivery: ${saved.name}`);
      log(DARK_GRAY, ' Press Enter to keep it, or pick a different delivery:');
      log('');
    }
  }

  DELIVERIES.forEach((delivery, i) => {
    const marker = delivery.id === savedDeliveryId ? ' *' : '';
    log(CYAN, `  [${i + 1}] ${delivery.name}${marker}`);
    log(DARK_GRAY, `       ${delivery.desc}`);
    log('');
  });

  const prompt = savedDeliveryId
    ? `Delivery (1-${DELIVERIES.length}, Enter for saved): `
    : `Delivery (1-${DELIVERIES.length}): `;

  const selection = await askQuestion(prompt);
  return selection.trim();
}

async function showModelMenu(savedModelId) {
  log(MAGENTA, '');
  log(MAGENTA, ' Select Model Tier');
  log(MAGENTA, '');

  if (savedModelId) {
    const saved = MODELS.find(m => m.id === savedModelId);
    if (saved) {
      log(CYAN, ` Last model: ${saved.name}${saved.id === 'paid' ? ' (recommended)' : ''}`);
      log(DARK_GRAY, ' Press Enter to keep it, or pick a different model:');
      log('');
    }
  }

  MODELS.forEach((model, i) => {
    const marker = model.id === savedModelId ? ' *' : '';
    const rec = model.id === 'paid' ? ' (recommended)' : '';
    log(GREEN, `  [${i + 1}] ${model.name}${rec}${marker}`);
    log(DARK_GRAY, `       ${model.desc}`);
    log('');
  });

  const prompt = savedModelId
    ? `Model tier (1-${MODELS.length}, Enter for saved): `
    : `Model tier (1-${MODELS.length}): `;

  const selection = await askQuestion(prompt);
  return selection.trim();
}

function runScript(scriptName, extraArgs = []) {
  const scriptPath = join(SCRIPT_DIR, scriptName);
  if (!existsSync(scriptPath)) {
    log(RED, `  ERROR: Script not found: ${scriptPath}`);
    process.exit(1);
  }

  const argStr = extraArgs.length ? ` ${extraArgs.join(' ')}` : '';
  log(CYAN, `  Starting ${scriptName}${argStr}...`);
  log('');

  try {
    execFileSync('node', [scriptPath, ...extraArgs], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      timeout: 0
    });
    return { success: true };
  } catch (e) {
    if (e.status !== null) {
      log(RED, `  Script exited with code ${e.status}`);
    } else {
      log(RED, `  Script error: ${e.message || e}`);
    }
    return { success: false, error: e };
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
  Glitch AI - Unified Launcher

  Usage: node scripts/launch-unified.mjs [options]

  Options:
    --help, -h       Show this help
    --mode <key>     Skip menu, launch specific mode directly
                     Combined format: <delivery>-<tier>  (e.g. normal-paid, web-free)
                     Old format: <tier>                 (assumes normal delivery)
                     Tiers: paid, free, local, safe
    --reset          Clear saved preference and show menu

  The launcher remembers your last choice. Next time, just press Enter.
    `);
    process.exit(0);
  }

  if (args.includes('--reset')) {
    if (existsSync(PrefFile)) {
      writeJson(PrefFile, { last_mode: null, saved_at: new Date().toISOString() });
      log(GREEN, '  Saved preference cleared.');
    }
  }

  let modeId = null;
  const modeIdx = args.indexOf('--mode');
  if (modeIdx !== -1 && modeIdx < args.length - 1) {
    modeId = normalizeMode(args[modeIdx + 1]);
  }

  if (!modeId) {
    // Parse saved preference into delivery + model parts
    const savedMode = getSavedMode();
    let savedDelivery = null;
    let savedModel = null;
    if (savedMode) {
      const parts = savedMode.split('-');
      if (parts.length === 2) {
        savedDelivery = parts[0];
        savedModel = parts[1];
      }
    }

    // Level 1: Delivery mode
    const delSelection = await showDeliveryMenu(savedDelivery);
    let deliveryId;
    if (!delSelection && savedDelivery) {
      deliveryId = savedDelivery;
    } else {
      const num = parseInt(delSelection, 10);
      if (!isNaN(num) && num >= 1 && num <= DELIVERIES.length) {
        deliveryId = DELIVERIES[num - 1].id;
      } else {
        log(RED, ' Invalid delivery selection. Exiting.');
        process.exit(1);
      }
    }

    // Level 2: Model tier (use saved model only if delivery didn't change)
    const modelDefault = deliveryId === savedDelivery ? savedModel : null;
    const modelSelection = await showModelMenu(modelDefault);
    let modelId;
    if (!modelSelection && modelDefault) {
      modelId = modelDefault;
    } else {
      const num = parseInt(modelSelection, 10);
      if (!isNaN(num) && num >= 1 && num <= MODELS.length) {
        modelId = MODELS[num - 1].id;
      } else {
        log(RED, ' Invalid model selection. Exiting.');
        process.exit(1);
      }
    }

    modeId = `${deliveryId}-${modelId}`;
  }

  if (!modeId) {
    log(RED, ' No mode selected. Exiting.');
    process.exit(1);
  }

  const config = SCRIPT_MAP[modeId];
  if (!config) {
    log(RED, ` Unknown mode: ${modeId}`);
    log(YELLOW, ' Valid format: <delivery>-<tier> (e.g. normal-paid, web-free)');
    process.exit(1);
  }

  saveMode(modeId);
  log(GREEN, ` Launching ${getModeLabel(modeId)}...`);
  log('');

  runScript(config.script, config.args);
}

main().catch(e => {
  log(RED, ` Fatal error: ${e.message || e}`);
  process.exit(1);
});
