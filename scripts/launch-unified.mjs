#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawn } from 'child_process';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCRIPT_DIR = __dirname;
const ROOT_DIR = resolve(SCRIPT_DIR, '..');
const isWin = process.platform === 'win32';

const PrefFile = join(ROOT_DIR, 'user', 'launch-preference.json');
const ModeFile = join(ROOT_DIR, 'data', 'backups', '.last-mode');

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

function getSavedMode() {
  const pref = readJson(PrefFile);
  if (pref && pref.last_mode) return pref.last_mode;
  return null;
}

function saveMode(mode) {
  const dir = dirname(PrefFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(PrefFile, JSON.stringify({ last_mode: mode, saved_at: new Date().toISOString() }, null, 2), 'utf-8');
}

const MODES = [
  { id: 'normal', name: 'Normal Mode', desc: 'Full Glitch with paid models (default)', color: MAGENTA, script: 'launch.mjs' },
  { id: 'free', name: 'Free Mode', desc: 'All agents use free models only', color: GREEN, script: 'launch-free.mjs' },
  { id: 'safe', name: 'Safe Mode', desc: 'Minimal config for fixing broken setup', color: YELLOW, script: 'launch-safe.mjs' },
  { id: 'serve', name: 'Server Mode', desc: 'Web server with Cloudflare Tunnel', color: CYAN, script: 'serve.mjs' },
  { id: 'local', name: 'Local Mode', desc: 'All agents via LM Studio (local LLM)', color: DARK_GREEN, script: 'launch-local.mjs' },
];

async function showMenu(savedMode) {
  log(MAGENTA, '');
  log(MAGENTA, ' Glitch AI - Unified Launcher');
  log(MAGENTA, '');
  
  if (savedMode) {
    const saved = MODES.find(m => m.id === savedMode);
    if (saved) {
      log(CYAN, ` Last used: ${saved.name} (${saved.id})`);
      log(DARK_GRAY, ' Press Enter to use again, or pick a number:');
      log('');
    }
  }

  MODES.forEach((mode, i) => {
    const marker = savedMode === mode.id ? ' *' : '';
    log(mode.color, `  [${i + 1}] ${mode.name}${marker}`);
    log(DARK_GRAY, `       ${mode.desc}`);
    log('');
  });

  const max = MODES.length;
  const prompt = savedMode 
    ? `Pick mode (1-${max}, or Enter for ${savedMode}): `
    : `Pick mode (1-${max}): `;
  
  const selection = await askQuestion(prompt);
  return selection.trim();
}

function runScript(scriptName) {
  const scriptPath = join(SCRIPT_DIR, scriptName);
  if (!existsSync(scriptPath)) {
    log(RED, `  ERROR: Script not found: ${scriptPath}`);
    process.exit(1);
  }
  
  log(CYAN, `  Starting ${scriptName}...`);
  log('');
  
  try {
    const result = execFileSync('node', [scriptPath], {
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
    --help, -h     Show this help
    --mode <id>    Skip menu, launch specific mode directly
                   (normal, free, safe, serve, local)
    --reset        Clear saved preference and show menu

  The launcher remembers your last choice. Next time, just press Enter.
    `);
    process.exit(0);
  }

  if (args.includes('--reset')) {
    if (existsSync(PrefFile)) {
      writeFileSync(PrefFile, JSON.stringify({ last_mode: null, saved_at: new Date().toISOString() }, null, 2), 'utf-8');
      log(GREEN, '  Saved preference cleared.');
    }
  }

  let modeId = null;
  const modeArg = args.find(a => a === '--mode');
  if (modeArg) {
    const idx = args.indexOf('--mode');
    if (idx < args.length - 1) {
      modeId = args[idx + 1];
    }
  }

  if (!modeId) {
    const savedMode = getSavedMode();
    const selection = await showMenu(savedMode);
    
    if (!selection && savedMode) {
      modeId = savedMode;
    } else {
      const num = parseInt(selection, 10);
      if (!isNaN(num) && num >= 1 && num <= MODES.length) {
        modeId = MODES[num - 1].id;
      } else {
        log(RED, ' Invalid selection. Exiting.');
        process.exit(1);
      }
    }
  }

  const mode = MODES.find(m => m.id === modeId);
  if (!mode) {
    log(RED, ` Unknown mode: ${modeId}`);
    log(YELLOW, ' Valid modes: normal, free, safe, serve, local');
    process.exit(1);
  }

  saveMode(modeId);
  log(GREEN, ` Launching ${mode.name}...`);
  log('');

  runScript(mode.script);
}

main().catch(e => {
  log(RED, ` Fatal error: ${e.message || e}`);
  process.exit(1);
});