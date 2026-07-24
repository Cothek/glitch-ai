#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawn } from 'child_process';
import { platform } from 'os';
import { checkRepoUpdates, handleRestartOnUpdate } from './lib/git-sync.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const isWin = platform() === 'win32';

const ConfigPath = join(ROOT_DIR, 'opencode.json');
const BackupDir = join(ROOT_DIR, 'data', 'backups');
const ModeFile = join(BackupDir, '.last-mode');

const MODES = {
  normal: { name: 'Normal', description: 'Full featured mode with paid models and all agents', template: 'config/opencode-normal.json', launchScript: 'scripts/launch.mjs', color: '\x1b[35m', model: 'opencode-go/deepseek-v4-flash', hasPaidFallbacks: true, agents: ['glitch', 'glitch-omni', 'general', 'explore', 'plan', 'build', 'coder', 'ui-designer', 'reviewer', 'testing', 'vision', 'memory'] },
  free: { name: 'Free', description: 'Free models only (OpenCode Zen, NVIDIA, OpenRouter) - no paid fallbacks', template: 'config/opencode-free.json', launchScript: 'scripts/launch-free.mjs', color: '\x1b[32m', model: 'opencode/deepseek-v4-flash-free', hasPaidFallbacks: false, agents: ['glitch', 'general', 'explore', 'plan', 'build', 'vision', 'glitch-omni', 'memory'] },
  local: { name: 'Local', description: 'Local models via LM Studio (192.168.86.139:1234)', template: 'config/opencode-local.json', launchScript: 'scripts/launch-local.mjs', color: '\x1b[36m', model: 'google/gemma-4-12b', hasPaidFallbacks: false, agents: ['glitch', 'general', 'explore', 'plan', 'build', 'memory'] },
  safe: { name: 'Safe', description: 'Minimal config for troubleshooting - restores normal on exit', template: 'config/opencode-safe.json', launchScript: 'scripts/launch-safe.mjs', color: '\x1b[31m', model: 'opencode-go/deepseek-v4-flash', hasPaidFallbacks: false, agents: ['glitch'] }
};

const RESET = '\x1b[0m', CYAN = '\x1b[36m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', RED = '\x1b[31m', DARK_GRAY = '\x1b[90m', WHITE = '\x1b[37m', BOLD = '\x1b[1m';
function log(color, msg) { if (msg === undefined) console.log(color); else console.log(color + msg + RESET); }
function readJson(path) { try { let c = readFileSync(path, 'utf-8'); if (c.charCodeAt(0) === 0xFEFF) c = c.slice(1); return JSON.parse(c); } catch { return null; } }
function getCurrentMode() { if (!existsSync(ModeFile)) return null; try { return readJson(ModeFile)?.mode || null; } catch { return null; } }
function getCurrentConfig() { if (!existsSync(ConfigPath)) return null; try { return readJson(ConfigPath); } catch { return null; } }
function isOpenCodeRunning() { try { if (isWin) { const out = execFileSync('tasklist', ['/NH', '/FI', 'IMAGENAME eq opencode.exe'], { encoding: 'utf-8', timeout: 5000 }); return out.includes('opencode.exe'); } else { const out = execFileSync('pgrep', ['-f', 'opencode'], { encoding: 'utf-8', timeout: 3000 }); return out.trim().length > 0; } } catch { return false; } }
function getLaunchCommand(mode) { return { type: 'node', path: mode.launchScript }; }

function killOpenCode() {
  try {
    if (isWin) {
      execFileSync('taskkill', ['/F', '/IM', 'opencode.exe'], { timeout: 5000, stdio: 'ignore' });
    } else {
      execFileSync('pkill', ['-f', 'opencode'], { timeout: 3000, stdio: 'ignore' });
    }
    log(DARK_GRAY, '  Stopped previous OpenCode instance');
  } catch {
    // Process may not exist, that's fine
  }
}

function launchDetached(mode) {
  const launch = getLaunchCommand(mode);
  const fullPath = join(ROOT_DIR, launch.path);

  log(CYAN, '\n  Launching ' + mode.name + ' mode in new window...');

  if (isWin) {
    // Use Start-Process cmd.exe to create a completely new process tree (new window)
    // Use full path to node.exe to avoid PATH issues
    const nodeExe = 'C:\\Program Files\\nodejs\\node.exe';
    const cmd = 'cd /d "' + ROOT_DIR + '" && "' + nodeExe + '" ' + launch.path;
    const psCmd = 'Start-Process cmd.exe -WindowStyle Normal -ArgumentList "/k", "' + cmd.replace(/"/g, '""') + '"';
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCmd], { timeout: 5000, stdio: 'ignore' });
      log(GREEN, '\n  ' + BOLD + mode.name + ' mode launched in new window.' + RESET + GREEN);
      return true;
    } catch (e) {
      log(RED, '  Failed to launch: ' + e.message);
      return false;
    }
  } else {
    // On Unix/macOS, try various terminal launchers
    const termCmds = [
      ['gnome-terminal', '--', 'bash', '-c', 'cd ' + ROOT_DIR + ' && node ' + launch.path + '; exec bash'],
      ['xterm', '-e', 'bash', '-c', 'cd ' + ROOT_DIR + ' && node ' + launch.path + '; exec bash'],
      ['konsole', '-e', 'bash', '-c', 'cd ' + ROOT_DIR + ' && node ' + launch.path + '; exec bash'],
      ['osascript', '-e', 'tell app "Terminal" to do script "cd ' + ROOT_DIR + ' && node ' + launch.path + '"'],
      ['nohup', 'node', launch.path]
    ];

    for (const cmd of termCmds) {
      try {
        const child = spawn(cmd[0], cmd.slice(1), { cwd: ROOT_DIR, detached: true, stdio: 'ignore' });
        child.unref();
        log(GREEN, '\n  ' + BOLD + mode.name + ' mode launched.' + RESET + GREEN);
        return true;
      } catch {
        continue;
      }
    }
    log(RED, '  Could not launch - no suitable terminal found');
    return false;
  }
}

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
  const engineInstructions = ['glitch-memorycore/prompt-rules.md', 'glitch-memorycore/glitch.md', 'glitch-memorycore/master-memory.md', 'glitch-memorycore/core/identity.md', 'glitch-memorycore/plugins/glitch-skills/skills-registry.md'];
  let UserName = process.env.GLITCH_USER || null; let userFound = false; const UserDir = join(ROOT_DIR, 'user');
  if (UserName) { const subdirPath = join(UserDir, UserName); if (existsSync(join(subdirPath, 'main-memory.md'))) userFound = true; else if (existsSync(join(UserDir, 'main-memory.md'))) { UserName = ''; userFound = true; } else { log(YELLOW, '  WARNING: User ' + UserName + ' specified but no profile found'); UserName = null; } }
  if (!userFound) { if (existsSync(join(UserDir, 'main-memory.md'))) { UserName = ''; userFound = true; } else if (existsSync(UserDir)) { const { readdirSync } = await import('fs'); try { const entries = readdirSync(UserDir, { withFileTypes: true }); const profiles = entries.filter(e => e.isDirectory()).map(e => e.name).filter(name => existsSync(join(UserDir, name, 'main-memory.md'))); if (profiles.length === 1) { UserName = profiles[0]; userFound = true; } else if (profiles.length > 1) { UserName = profiles[0]; userFound = true; } } catch {} } }
  let userInstructions = []; if (UserName && UserName !== '') { userInstructions = ['user/' + UserName + '/main-memory.md', 'user/' + UserName + '/current-session.md', 'user/' + UserName + '/reminders.md', 'user/' + UserName + '/session-dashboard.md']; } else if (existsSync(join(ROOT_DIR, 'user', 'main-memory.md'))) { userInstructions = ['user/main-memory.md', 'user/current-session.md', 'user/reminders.md', 'user/session-dashboard.md']; }
  const allInstructions = [...engineInstructions, ...userInstructions]; const instrJson = allInstructions.map(s => '    "' + s + '"').join(',\n'); const instrBlock = '"instructions": [\n' + instrJson + '\n  ]'; const runtimeJson = templateText.replace(/"[Ii]nstructions"\s*:\s*\[[^\]]*\]/, instrBlock);
  try { JSON.parse(runtimeJson); return runtimeJson; } catch (e) { log(RED, '  ERROR: Generated config is invalid JSON: ' + e.message); return null; }
}

async function runLaunchScript(scriptPath) { const fullPath = join(ROOT_DIR, scriptPath); if (!existsSync(fullPath)) { log(RED, '  Launch script not found: ' + scriptPath); return { success: false }; } log(CYAN, '  Starting ' + scriptPath + '...'); console.log(''); try { execFileSync('node', [fullPath], { cwd: ROOT_DIR, stdio: 'inherit', timeout: 0 }); return { success: true }; } catch (e) { if (e.status !== null) log(RED, '  Launch script exited with code ' + e.status); else log(RED, '  Launch script error: ' + e.message); return { success: false }; } }

async function showStatus() { const currentMode = getCurrentMode(); const currentConfig = getCurrentConfig(); log(CYAN, '\n  Glitch Mode Status'); log(CYAN, '  =================='); log(''); if (currentMode) { const mode = MODES[currentMode]; log(mode.color, '  Current Mode: ' + mode.name + ' (' + currentMode + ')'); log(DARK_GRAY, '  Model: ' + mode.model); log(DARK_GRAY, '  Agents: ' + mode.agents.join(', ')); } else { log(YELLOW, '  Current Mode: Unknown (no mode marker found)'); } if (currentConfig) { const agentKeys = Object.keys(currentConfig.agent || {}); log(DARK_GRAY, '  Active Agents in Config: ' + agentKeys.join(', ')); if (currentConfig.agent?.glitch?.model) log(DARK_GRAY, '  Glitch Model: ' + currentConfig.agent.glitch.model); } try { const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf-8', timeout: 5000 }).toString().trim(); log(DARK_GRAY, '  Git Branch: ' + branch); } catch {} log(''); }

async function main() {
  // ---- Check for repo updates before switching modes ----
  const syncResult = await checkRepoUpdates({ cwd: ROOT_DIR, interactive: true, allowBranchSwitch: true });
  handleRestartOnUpdate(spawn, syncResult, ROOT_DIR);

  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log('\n  Glitch Launcher - Switch mode and launch in one command\n');
    console.log('  Usage: node scripts/glitch.mjs <mode>');
    console.log('\n  Modes:');
    console.log('    normal    Full featured with paid models (default)');
    console.log('    free      Free models only (OpenCode Zen, NVIDIA, OpenRouter)');
    console.log('    local     Local models via LM Studio');
    console.log('    safe      Minimal config for troubleshooting');
    console.log('\n  Examples:');
    console.log('    node scripts/glitch.mjs normal    # Switch to normal and launch');
    console.log('    node scripts/glitch.mjs free      # Switch to free and launch');
    console.log('    node scripts/glitch.mjs local     # Switch to local and launch');
    console.log('    node scripts/glitch.mjs safe      # Switch to safe and launch');
    console.log('\n  This script: switches config -> kills old OpenCode -> launches new mode in new window');
    process.exit(0);
  }

  const targetMode = args[0].toLowerCase();
  const mode = MODES[targetMode];

  if (!mode) {
    log(RED, '  Unknown mode: ' + targetMode);
    log(YELLOW, '  Available: ' + Object.keys(MODES).join(', '));
    process.exit(1);
  }

  const currentMode = getCurrentMode();
  if (currentMode === targetMode) {
    log(YELLOW, '  Already in ' + mode.name + ' mode. Restarting...');
  }

  // Step 1: Switch config
  if (!switchConfig(targetMode)) process.exit(1);

  // Step 2: Kill existing OpenCode
  log(CYAN, '\n  Stopping current Glitch session...');
  killOpenCode();

  // Small delay to ensure process is dead
  await new Promise(r => setTimeout(r, 1000));

  // Step 3: Launch new mode in detached process
  if (!launchDetached(mode)) process.exit(1);

  // Exit this script (the launched process continues independently in new window)
  log(DARK_GRAY, '\n  This window can be closed. Glitch is now running in ' + mode.name + ' mode.');
  process.exit(0);
}

async function switchConfig(targetMode) {
  const mode = MODES[targetMode];
  if (!mode) { log(RED, '  Unknown mode: ' + targetMode); return false; }

  const templatePath = join(ROOT_DIR, mode.template);
  if (!existsSync(templatePath)) { log(RED, '  Template not found: ' + mode.template); return false; }

  log(mode.color, '\n  Switching to ' + mode.name + ' mode...');

  if (existsSync(ConfigPath)) {
    if (!existsSync(BackupDir)) mkdirSync(BackupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFile = join(BackupDir, 'opencode-' + ts + '.json');
    copyFileSync(ConfigPath, backupFile);
    log(DARK_GRAY, '  Backed up config -> data/backups/opencode-' + ts + '.json');
  }

  let templateText = readFileSync(templatePath, 'utf-8');
  if (templateText.charCodeAt(0) === 0xFEFF) templateText = templateText.slice(1);

  if (targetMode === 'safe') {
    copyFileSync(templatePath, ConfigPath);
    log(GREEN, '  Safe mode config loaded.');
  } else if (targetMode === 'normal') {
    const runtimeJson = await generateNormalConfig(templateText);
    if (!runtimeJson) return false;
    writeFileSync(ConfigPath, runtimeJson, 'utf-8');
    log(GREEN, '  Normal mode config generated.');
  } else {
    copyFileSync(templatePath, ConfigPath);
    log(GREEN, '  ' + mode.name + ' mode config loaded (model selection at launch).');
  }

  if (!existsSync(BackupDir)) mkdirSync(BackupDir, { recursive: true });
  writeFileSync(ModeFile, JSON.stringify({ mode: targetMode, timestamp: new Date().toISOString(), model: mode.model }, null, 2), 'utf-8');
  return true;
}

main().catch(e => { log(RED, '  Fatal error: ' + (e.message || e)); process.exit(1); });
