#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, copyFileSync, mkdirSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { platform } from 'os';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(scriptDir);
const openCodeBin = join(rootDir, 'opencode', platform() === 'win32' ? 'opencode.exe' : 'opencode');
const configPath = join(rootDir, 'opencode.json');
const templatePath = join(rootDir, 'config', 'opencode-safe.json');
const backupDir = join(rootDir, 'data', 'backups');
const modeFile = join(backupDir, '.last-mode');

console.log('');
console.log(' Glitch AI - Safe Mode');
console.log('');

if (!existsSync(openCodeBin)) {
  console.error(' OpenCode not found. Run bootstrap.ps1 first.');
  process.exit(1);
}

if (existsSync(configPath)) {
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const backupFile = join(backupDir, `opencode-${ts}.json`);
  copyFileSync(configPath, backupFile);
  console.log(`  Previous config backed up -> data/backups/opencode-${ts}.json`);
}

if (!existsSync(templatePath)) {
  console.error('  ERROR: Safe mode template not found at config/opencode-safe.json');
  console.error('  Try cloning the repo again or restoring from backup.');
  process.exit(1);
}

console.log('  Loading safe mode config...');
copyFileSync(templatePath, configPath);
console.log('  Safe mode config loaded.');

const modeInfo = JSON.stringify({
  mode: 'safe',
  timestamp: new Date().toISOString(),
  model: 'opencode-go/deepseek-v4-flash'
}, null, 2);
writeFileSync(modeFile, modeInfo, 'utf-8');

console.log('');
console.log('  Starting OpenCode in safe mode...');
console.log('  Current config saved to data/backups/ with timestamp.');
console.log("  When you're done fixing, exit normally and launch normally.");
console.log('');
console.log('  NOTE: Safe mode is a diagnostic shell. Fix the actual issue in:');
console.log('    - The normal template: config/opencode-normal.json (config problems)');
console.log('    - Engine files: glitch-memorycore/ (prompt/skill problems)');
console.log('    - Agent files: .opencode/agents/ (agent definition problems)');
console.log('    - Your git branch (if switching branches fixes the issue)');
console.log('');

try {
  execFileSync(openCodeBin, [], { stdio: 'inherit', cwd: rootDir });
} catch (err) {
  if (err.status === null) {
    console.error(`  OpenCode exited with error: ${err.message}`);
  }
}

console.log('');
console.log('Safe mode ended.');
