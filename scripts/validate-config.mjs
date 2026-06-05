#!/usr/bin/env node

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { platform } from 'os';

const args = process.argv.slice(2);
const pathIndex = args.indexOf('--path');
const customPath = pathIndex !== -1 && pathIndex + 1 < args.length ? args[pathIndex + 1] : null;
const quiet = args.includes('--quiet');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function logInfo(msg) { if (!quiet) console.log(`${CYAN}${msg}${RESET}`); }
function logOk(msg) { if (!quiet) console.log(`  ${GREEN}${msg}${RESET}`); }
function logFail(msg) { if (!quiet) console.log(`  ${RED}${msg}${RESET}`); }

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = customPath ? dirname(resolve(customPath)) : resolve(SCRIPT_DIR, '..');
const configPath = customPath ? resolve(customPath) : join(ROOT_DIR, 'opencode.json');

if (!existsSync(configPath)) {
  console.error(`${RED}ERROR: File not found: ${configPath}${RESET}`);
  process.exit(1);
}

let exitCode = 0;
const errors = [];

logInfo(`==> Validating: ${configPath}`);
let config;
try {
  let raw = readFileSync(configPath, 'utf-8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  config = JSON.parse(raw);
  logOk('[OK] Valid JSON');
} catch (err) {
  errors.push(`JSON syntax error: ${err.message}`);
  logFail(`[FAIL] ${errors[errors.length - 1]}`);
  process.exit(1);
}

if (config.instructions) {
  const missing = [];
  for (const file of config.instructions) {
    const fullPath = join(ROOT_DIR, file);
    if (!existsSync(fullPath)) {
      missing.push(file);
    }
  }
  if (missing.length > 0) {
    const msg = `Missing instruction files: ${missing.join(', ')}`;
    errors.push(msg);
    logFail(`[FAIL] ${msg}`);
    exitCode = 1;
  } else {
    logOk('[OK] All instruction files exist');
  }
}

if (config.agent) {
  const agentNames = [];
  for (const [name, agentConfig] of Object.entries(config.agent)) {
    agentNames.push(name);

    if (!agentConfig.model) {
      const msg = `Agent '${name}' has no model specified`;
      errors.push(msg);
      logFail(`[FAIL] ${msg}`);
      exitCode = 1;
    }

    if (agentConfig.mode && !['primary', 'subagent'].includes(agentConfig.mode)) {
      const msg = `Agent '${name}' has invalid mode '${agentConfig.mode}'`;
      errors.push(msg);
      logFail(`[FAIL] ${msg}`);
      exitCode = 1;
    }

    if (agentConfig.temperature != null && (agentConfig.temperature < 0 || agentConfig.temperature > 2)) {
      const msg = `Agent '${name}' has temperature out of range (0-2): ${agentConfig.temperature}`;
      errors.push(msg);
      logFail(`[FAIL] ${msg}`);
      exitCode = 1;
    }
  }

  const counts = {};
  for (const name of agentNames) {
    counts[name] = (counts[name] || 0) + 1;
  }
  for (const [name, count] of Object.entries(counts)) {
    if (count > 1) {
      const msg = `Duplicate agent name: '${name}'`;
      errors.push(msg);
      logFail(`[FAIL] ${msg}`);
      exitCode = 1;
    }
  }

  if (errors.length === 0 && !quiet) {
    logOk(`[OK] Agents: ${agentNames.length} configured, all valid`);
  }
}

const scriptsDir = join(ROOT_DIR, 'scripts');
const psScripts = ['launch.ps1', 'launch-safe.ps1', 'launch-free.ps1', 'serve-glitch.ps1', 'validate-config.ps1'];

for (const script of psScripts) {
  const scriptPath = join(scriptsDir, script);
  if (!existsSync(scriptPath)) continue;

  const bytes = readFileSync(scriptPath);
  const hasNonAscii = bytes.some(b => b > 0x7F);

  if (hasNonAscii) {
    logFail(`[FAIL] ${script} has non-ASCII characters (will break PowerShell 5.1)`);
    exitCode = 1;
  } else if (!quiet) {
    logOk(`[OK] ${script} is pure ASCII`);
  }
}

if (existsSync(scriptsDir)) {
  const mjsFiles = readdirSync(scriptsDir).filter(f => f.endsWith('.mjs') && f !== 'validate-config.mjs');
  for (const file of mjsFiles) {
    const filePath = join(scriptsDir, file);
    const bytes = readFileSync(filePath);
    const hasNonAscii = bytes.some(b => b > 0x7F);

    if (hasNonAscii) {
      logFail(`[FAIL] ${file} has non-ASCII characters`);
      exitCode = 1;
    } else if (!quiet) {
      logOk(`[OK] ${file} is pure ASCII`);
    }
  }
}

const requiredKeys = ['agent'];
for (const key of requiredKeys) {
  if (!(key in config)) {
    const msg = `Missing required key: '${key}'`;
    errors.push(msg);
    logFail(`[FAIL] ${msg}`);
    exitCode = 1;
  }
}

if (exitCode === 0) {
  if (!quiet) console.log(`\n${GREEN}[PASS] Config validation PASSED${RESET}`);
} else {
  if (!quiet) {
    console.log(`\n${RED}[FAIL] Config validation FAILED - ${errors.length} error(s)${RESET}`);
    const isWin = platform() === 'win32';
    const safeModeMsg = isWin
      ? '  Run launch-glitch-safe.bat to enter safe mode and fix issues.'
      : '  Run node scripts/launch-safe.mjs to enter safe mode and fix issues.';
    console.log(`${YELLOW}${safeModeMsg}${RESET}`);
  }
}

process.exit(exitCode);
