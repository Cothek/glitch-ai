#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { createInterface } from 'readline';
import { platform } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const isWin = platform() === 'win32';

const ConfigPath = join(ROOT_DIR, 'opencode.json');
const BackupDir = join(ROOT_DIR, 'data', 'backups');
const ModeFile = join(BackupDir, '.last-mode');

const MODES = {
  normal: { name: 'Normal', description: 'Full featured mode with paid models and all agents', template: 'config/opencode-normal.json', launchScript: 'scripts/launch.mjs', color: '\x1b[35m', model: 'opencode-go/deepseek-v4-flash', hasPaidFallbacks: true, agents: ['glitch', 'general', 'explore', 'plan', 'build', 'coder', 'ui-designer', 'reviewer', 'testing', 'vision'] },
  free: { name: 'Free', description: 'Free models only (OpenCode Zen, NVIDIA, OpenRouter) - no paid fallbacks', template: 'config/opencode-free.json', launchScript: 'scripts/launch-free.mjs', color: '\x1b[32m', model: 'opencode/deepseek-v4-flash-free', hasPaidFallbacks: false, agents: ['glitch', 'general', 'explore', 'plan', 'build', 'vision', 'glitch-omni'] },
  local: { name: 'Local', description: 'Local models via LM Studio (192.168.86.139:1234)', template: 'config/opencode-local.json', launchScript: 'scripts/launch-local.mjs', color: '\x1b[36m', model: 'google/gemma-4-12b', hasPaidFallbacks: false, agents: ['glitch', 'general', 'explore', 'plan', 'build'] },
  safe: { name: 'Safe', description: 'Minimal config for troubleshooting - restores normal on exit', template: 'config/opencode-safe.json', launchScript: 'scripts/launch-safe.mjs', color: '\x1b[31m', model: 'opencode-go/deepseek-v4-flash', hasPaidFallbacks: false, agents: ['glitch'] }
};

const RESET = '\x1b[0m', CYAN = '\x1b[36m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', RED = '\x1b[31m', DARK_GRAY = '\x1b[90m', WHITE = '\x1b[37m', BOLD = '\x1b[1m';
function log(color, msg) { if (msg === undefined) console.log(color); else console.log(color + msg + RESET); }
function readJson(path) { try { let c = readFileSync(path, 'utf-8'); if (c.charCodeAt(0) === 0xFEFF) c = c.slice(1); return JSON.parse(c); } catch { return null; } }
function getCurrentMode() { if (!existsSync(ModeFile)) return null; try { return readJson(ModeFile)?.mode || null; } catch { return null; } }
function getCurrentConfig() { if (!existsSync(ConfigPath)) return null; try { return readJson(ConfigPath); } catch { return null; } }
function isOpenCodeRunning() { try { if (isWin) { const out = execFileSync('tasklist', ['/NH', '/FI', 'IMAGENAME eq opencode.exe'], { encoding: 'utf-8', timeout: 5000 }); return out.includes('opencode.exe'); } else { const out = execFileSync('pgrep', ['-f', 'opencode'], { encoding: 'utf-8', timeout: 3000 }); return out.trim().length > 0; } } catch { return false; } }
function getLaunchCommand(mode) { return 'node ' + mode.launchScript; }
async function askQuestion(query) { return new Promise(r => { const rl = createInterface({ input: process.stdin, output: process.stdout }); rl.question(query, a => { rl.close(); r(a); }); }); }
function showModeMenu(currentMode) { log(CYAN, '\n  Available Modes:'); log(''); let idx = 1; for (const [key, mode] of Object.entries(MODES)) { const marker = key === currentMode ? ' *' : ''; log(mode.color, '   [' + idx + '] ' + mode.name + marker); log(DARK_GRAY, '       ' + mode.description); log(DARK_GRAY, '       Model: ' + mode.model); log(DARK_GRAY, '       Agents: ' + mode.agents.join(', ')); log(''); idx++; } }

async function switchMode(targetMode, options = {}) {
  const mode = MODES[targetMode];
  if (!mode) { log(RED, '  Unknown mode: ' + targetMode); log(YELLOW, '  Available: ' + Object.keys(MODES).join(', ')); return { success: false }; }
  const currentMode = getCurrentMode();
  if (currentMode === targetMode && !options.force) { log(YELLOW, '  Already in ' + mode.name + ' mode. Use --force to re-apply.'); return { success: true, alreadyActive: true }; }
  const templatePath = join(ROOT_DIR, mode.template);
  if (!existsSync(templatePath)) { log(RED, '  Template not found: ' + mode.template); return { success: false }; }
  log(mode.color, '\n  Switching to ' + mode.name + ' mode...');
  if (existsSync(ConfigPath)) { if (!existsSync(BackupDir)) mkdirSync(BackupDir, { recursive: true }); const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); const backupFile = join(BackupDir, 'opencode-' + ts + '.json'); copyFileSync(ConfigPath, backupFile); log(DARK_GRAY, '  Backed up current config -> data/backups/opencode-' + ts + '.json'); }
  let templateText = readFileSync(templatePath, 'utf-8'); if (templateText.charCodeAt(0) === 0xFEFF) templateText = templateText.slice(1);
  let runtimeJson; let needsInteractivePicker = false;
  if (targetMode === 'free') { needsInteractivePicker = true; log(YELLOW, '  Free mode requires model selection.'); }
  else if (targetMode === 'local') { needsInteractivePicker = true; log(YELLOW, '  Local mode requires model selection.'); }
  else if (targetMode === 'safe') { copyFileSync(templatePath, ConfigPath); log(GREEN, '  Safe mode config loaded.'); }
  else { runtimeJson = await generateNormalConfig(templateText); if (!runtimeJson) return { success: false }; writeFileSync(ConfigPath, runtimeJson, 'utf-8'); log(GREEN, '  Normal mode config generated.'); }
  if (!existsSync(BackupDir)) mkdirSync(BackupDir, { recursive: true }); writeFileSync(ModeFile, JSON.stringify({ mode: targetMode, timestamp: new Date().toISOString(), model: mode.model }, null, 2), 'utf-8');
  log(GREEN, '\n  ' + BOLD + 'Switched to ' + mode.name + ' mode.' + RESET + GREEN);
  const launchCmd = getLaunchCommand(mode);
  if (needsInteractivePicker) { log(YELLOW, '  This mode requires interactive model selection.'); log(CYAN, '  To complete the switch, run:'); log(WHITE, '    ' + launchCmd); log(''); log(DARK_GRAY, '  (This will launch the interactive picker, then start Glitch in ' + mode.name + ' mode)'); return { success: true, needsLaunch: true, launchCommand: launchCmd, mode }; }
  if (options.launch) { log(CYAN, '  Launching ' + mode.name + ' mode...'); console.log(''); return await runLaunchScript(mode.launchScript); }
  log(CYAN, '  To start Glitch in ' + mode.name + ' mode, run:'); log(WHITE, '    ' + launchCmd); log('');
  if (isOpenCodeRunning()) { log(YELLOW, '  ' + BOLD + 'Note:' + RESET + YELLOW + ' OpenCode appears to be running.'); log(YELLOW, '  You need to exit the current session first (Ctrl+C or type "exit"),'); log(YELLOW, '  then run the launch command above.'); }
  return { success: true, needsLaunch: false, launchCommand: launchCmd, mode };
}

async function generateNormalConfig(templateText) {
  const engineInstructions = ['glitch-memorycore/prompt-rules.md', 'glitch-memorycore/CLAUDE.md', 'glitch-memorycore/master-memory.md', 'glitch-memorycore/core/identity.md', 'glitch-memorycore/plugins/glitch-skills/skills-registry.md'];
  let UserName = process.env.GLITCH_USER || null; let userFound = false; const UserDir = join(ROOT_DIR, 'user');
  if (UserName) { const subdirPath = join(UserDir, UserName); if (existsSync(join(subdirPath, 'main-memory.md'))) userFound = true; else if (existsSync(join(UserDir, 'main-memory.md'))) { UserName = ''; userFound = true; } else { log(YELLOW, '  WARNING: User ' + UserName + ' specified but no profile found'); UserName = null; } }
  if (!userFound) { if (existsSync(join(UserDir, 'main-memory.md'))) { UserName = ''; userFound = true; } else if (existsSync(UserDir)) { const { readdirSync } = await import('fs'); try { const entries = readdirSync(UserDir, { withFileTypes: true }); const profiles = entries.filter(e => e.isDirectory()).map(e => e.name).filter(name => existsSync(join(UserDir, name, 'main-memory.md'))); if (profiles.length === 1) { UserName = profiles[0]; userFound = true; } else if (profiles.length > 1) { UserName = profiles[0]; userFound = true; } } catch {} } }
  let userInstructions = []; if (UserName && UserName !== '') { userInstructions = ['user/' + UserName + '/main-memory.md', 'user/' + UserName + '/current-session.md', 'user/' + UserName + '/reminders.md', 'user/' + UserName + '/session-dashboard.md']; } else if (existsSync(join(ROOT_DIR, 'user', 'main-memory.md'))) { userInstructions = ['user/main-memory.md', 'user/current-session.md', 'user/reminders.md', 'user/session-dashboard.md']; }
  const allInstructions = [...engineInstructions, ...userInstructions]; const instrJson = allInstructions.map(s => '    "' + s + '"').join(',\n'); const instrBlock = '"instructions": [\n' + instrJson + '\n  ]'; const runtimeJson = templateText.replace(/"[Ii]nstructions"\s*:\s*\[[^\]]*\]/, instrBlock);
  try { JSON.parse(runtimeJson); return runtimeJson; } catch (e) { log(RED, '  ERROR: Generated config is invalid JSON: ' + e.message); return null; }
}

async function runLaunchScript(scriptPath) { const fullPath = join(ROOT_DIR, scriptPath); if (!existsSync(fullPath)) { log(RED, '  Launch script not found: ' + scriptPath); return { success: false }; } log(CYAN, '  Starting ' + scriptPath + '...'); console.log(''); try { execFileSync('node', [fullPath], { cwd: ROOT_DIR, stdio: 'inherit', timeout: 0 }); return { success: true }; } catch (e) { if (e.status !== null) log(RED, '  Launch script exited with code ' + e.status); else log(RED, '  Launch script error: ' + e.message); return { success: false }; } }

async function showStatus() { const currentMode = getCurrentMode(); const currentConfig = getCurrentConfig(); log(CYAN, '\n  Glitch Mode Status'); log(CYAN, '  =================='); log(''); if (currentMode) { const mode = MODES[currentMode]; log(mode.color, '  Current Mode: ' + mode.name + ' (' + currentMode + ')'); log(DARK_GRAY, '  Model: ' + mode.model); log(DARK_GRAY, '  Agents: ' + mode.agents.join(', ')); } else { log(YELLOW, '  Current Mode: Unknown (no mode marker found)'); } if (currentConfig) { const agentKeys = Object.keys(currentConfig.agent || {}); log(DARK_GRAY, '  Active Agents in Config: ' + agentKeys.join(', ')); if (currentConfig.agent?.glitch?.model) log(DARK_GRAY, '  Glitch Model: ' + currentConfig.agent.glitch.model); } try { const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf-8', timeout: 5000 }).toString().trim(); log(DARK_GRAY, '  Git Branch: ' + branch); } catch {} log(''); }

async function main() { const args = process.argv.slice(2); if (args.includes('--help') || args.includes('-h')) { console.log('\n  Glitch Mode Switcher\n\n  Usage: node scripts/switch-mode.mjs [mode] [options]\n\n  Modes:\n    normal    Full featured with paid models (default)\n    free      Free models only (OpenCode Zen, NVIDIA, OpenRouter)\n    local     Local models via LM Studio\n    safe      Minimal config for troubleshooting\n\n  Options:\n    --status, -s     Show current mode status\n    --force, -f      Force re-apply current mode\n    --launch, -l     Switch mode AND launch immediately (normal/safe only)\n    --help, -h       Show this help\n\n  Examples:\n    node scripts/switch-mode.mjs           # Interactive mode selection\n    node scripts/switch-mode.mjs free      # Switch to free mode\n    node scripts/switch-mode.mjs --status  # Show current mode\n    node scripts/switch-mode.mjs normal -f # Force re-apply normal mode\n    node scripts/switch-mode.mjs normal -l # Switch to normal and launch\n  '); process.exit(0); }
  if (args.includes('--status') || args.includes('-s')) { await showStatus(); process.exit(0); }
  const force = args.includes('--force') || args.includes('-f'); const launch = args.includes('--launch') || args.includes('-l'); const targetMode = args[0];
  if (!targetMode) { const currentMode = getCurrentMode(); showModeMenu(currentMode); log(WHITE, '  Enter mode number or name (or press Enter to cancel):'); const choice = await askQuestion('  > '); if (!choice.trim()) { log(DARK_GRAY, '  Cancelled.'); process.exit(0); } const num = parseInt(choice.trim(), 10); const modeKeys = Object.keys(MODES); let selectedMode; if (!isNaN(num) && num >= 1 && num <= modeKeys.length) selectedMode = modeKeys[num - 1]; else if (MODES[choice.trim().toLowerCase()]) selectedMode = choice.trim().toLowerCase(); else { log(RED, '  Invalid selection: ' + choice); process.exit(1); } await switchMode(selectedMode, { force, launch }); } else { await switchMode(targetMode.toLowerCase(), { force, launch }); } }
main().catch(e => { log(RED, '  Fatal error: ' + (e.message || e)); process.exit(1); });