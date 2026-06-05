#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawn } from 'child_process';
import net from 'net';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCRIPT_DIR = __dirname;
const ROOT_DIR = resolve(SCRIPT_DIR, '..');
const isWin = process.platform === 'win32';

const OPENCODE_BIN_NAME = isWin ? 'opencode.exe' : 'opencode';
const OpenCodeBin = join(ROOT_DIR, 'opencode', OPENCODE_BIN_NAME);
const CLOUDFLARED_BIN_NAME = isWin ? 'cloudflared.exe' : 'cloudflared';
const CloudflaredBin = join(ROOT_DIR, CLOUDFLARED_BIN_NAME);
const CloudflaredConfig = join(ROOT_DIR, 'config', 'cloudflared-config.yml');
const HandyBin = join(ROOT_DIR, 'handy-voice', 'Handy', 'handy.exe');
const ConfigPath = join(ROOT_DIR, 'opencode.json');
const TemplatePath = join(ROOT_DIR, 'config', 'opencode-normal.json');
const BackupDir = join(ROOT_DIR, 'data', 'backups');
const ModeFile = join(BackupDir, '.last-mode');
const UserDir = join(ROOT_DIR, 'user');
const PwFile = join(ROOT_DIR, '.server-password');
const AuthProxyPath = join(ROOT_DIR, 'plugins', 'auth-proxy.mjs');
const FixPathsMjs = join(ROOT_DIR, 'scripts', 'fix-paths.mjs');

const TARGET_PORT = 4102;
const AUTH_PROXY_PORT = 4100;

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

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

const NPM_BIN = isWin ? 'npm.cmd' : 'npm';
const GIT_BIN = 'git';
const POWERSHELL = isWin ? 'powershell.exe' : null;

function pwsh(args, opts = {}) {
  if (!POWERSHELL) return { success: false, stdout: '', status: -1, error: 'No PowerShell on this platform' };
  return run(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], opts);
}

function isProcessRunning(name) {
  if (!isWin) return false;
  try {
    const out = execFileSync('tasklist', ['/NH', '/FI', `IMAGENAME eq ${name}.exe`], { encoding: 'utf-8', timeout: 5000 });
    return out.includes(`${name}.exe`);
  } catch {
    return false;
  }
}

// ---- Load .env if present ----
function loadEnv() {
  const envFile = join(ROOT_DIR, '.env');
  if (existsSync(envFile)) {
    const text = readFileSync(envFile, 'utf-8');
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
      if (match) {
        let val = match[2].replace(/^["']|["']$/g, '');
        process.env[match[1].trim()] = val;
      }
    }
    log(GREEN, '  Loaded .env config');
  }
}

// ---- Port check (zombie socket prevention) ----
function checkPort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(true);
    });
    socket.connect(port, '127.0.0.1');
  });
}

// ---- Password ACL management ----
function setPasswordAcl(filePath) {
  try {
    if (isWin) {
      const username = process.env.USERNAME || 'opencode';
      run('icacls', [filePath, '/inheritance:r', '/grant', `${username}:R`], { stdio: 'ignore', timeout: 5000 });
    } else {
      run('chmod', ['600', filePath], { stdio: 'ignore', timeout: 5000 });
    }
  } catch {}
}

// ---- Background process tracking ----
const backgroundProcesses = [];
let fixerInterval = null;

function trackProcess(proc) {
  backgroundProcesses.push(proc);
  return proc;
}

function cleanup() {
  for (const proc of backgroundProcesses) {
    try {
      if (!proc.killed) proc.kill();
    } catch {}
  }
  backgroundProcesses.length = 0;
  if (fixerInterval) {
    clearInterval(fixerInterval);
    fixerInterval = null;
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

// ==========================================================
//                          MAIN
// ==========================================================

async function main() {
  log(MAGENTA, '');
  log(MAGENTA, ' Glitch AI - Server Mode');
  log(MAGENTA, '');

  // ---- Load .env ----
  loadEnv();

  // ---- Check prerequisites ----
  if (!existsSync(OpenCodeBin)) {
    log(RED, '  OpenCode not found. Run bootstrap.ps1 first.');
    process.exit(1);
  }

  // ---- Self-heal: initialize git submodules if needed ----
  if (!existsSync(join(ROOT_DIR, 'glitch-memorycore', 'prompt-rules.md'))) {
    log(CYAN, '  Initializing glitch-memorycore submodule...');
    const result = run(GIT_BIN, ['submodule', 'update', '--init', '--recursive'], { cwd: ROOT_DIR, timeout: 60000 });
    if (result.success && existsSync(join(ROOT_DIR, 'glitch-memorycore', 'prompt-rules.md'))) {
      log(GREEN, '  Engine ready!');
    } else {
      log(YELLOW, '  WARNING: Could not load engine.');
      log(YELLOW, '  Run: git submodule update --init --recursive');
    }
  } else {
    log(DARK_GREEN, '  Engine found');
  }

  // ---- Normalize backslash paths (startup) ----
  try {
    if (existsSync(FixPathsMjs)) {
      run('node', [FixPathsMjs], { timeout: 15000, stdio: 'ignore' });
    }
  } catch {}

  // ---- Port check (zombie socket prevention) ----
  const portFree = await checkPort(TARGET_PORT);
  if (!portFree) {
    log(RED, `  ERROR: Port ${TARGET_PORT} is in use (likely orphan TCP socket from previous crash).`);
    if (isWin) {
      log(YELLOW, '  Fix: Run PowerShell as Admin and execute: net stop winnat; net start winnat');
    } else {
      log(YELLOW, `  Fix: lsof -i :${TARGET_PORT} -t | xargs kill`);
    }
    process.exit(1);
  }
  log(CYAN, `  Port ${TARGET_PORT} is free`);

  // ---- Timestamped backup (preserved, never overwritten) ----
  if (existsSync(ConfigPath)) {
    if (!existsSync(BackupDir)) mkdirSync(BackupDir, { recursive: true });
    const ts = timestamp();
    const backupFile = join(BackupDir, `opencode-${ts}.json`);
    copyFileSync(ConfigPath, backupFile);
    log(DARK_GRAY, `  Previous config backed up -> data\\backups\\opencode-${ts}.json`);
  }

  // ---- Check template exists ----
  if (!existsSync(TemplatePath)) {
    log(RED, '  ERROR: Normal mode template not found at config/opencode-normal.json');
    log(YELLOW, '  Try running launch-safe to repair.');
    process.exit(1);
  }

  // ---- User Profile Detection ----
  let UserName = process.env.GLITCH_USER || null;
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
      log(YELLOW, '  Run: node setup.mjs --user <name>');
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
        profiles.forEach((name) => {
          log(CYAN, `    ${name}`);
        });
        log(DARK_GRAY, '  Set GLITCH_USER env var to auto-select.');
        UserName = profiles[0];
        userFound = true;
        log(CYAN, `  Using: ${UserName}`);
      }
    }
  }

  if (!userFound) {
    log(YELLOW, '  No user profile found.');
    log(CYAN, '  Starting with engine defaults.');
  }

  // ---- Generate runtime config from template ----
  log(CYAN, '  Generating runtime config from template...');

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
  const runtimeJson = templateText.replace(/"[Ii]nstructions"\s*:\s*\[[^\]]*\]/, instrBlock);

  try {
    JSON.parse(runtimeJson);
    writeFileSync(ConfigPath, runtimeJson, 'utf-8');
    log(DARK_GREEN, `  Config written (${allInstructions.length} instruction files)`);
  } catch (e) {
    log(RED, '  ERROR: Generated config is invalid JSON!');
    log(RED, `  ${e.message}`);
    process.exit(1);
  }

  // ---- Write mode marker ----
  const modeInfo = JSON.stringify({
    mode: 'normal',
    timestamp: new Date().toISOString(),
    model: 'opencode-go/deepseek-v4-flash'
  }, null, 2);
  if (!existsSync(BackupDir)) mkdirSync(BackupDir, { recursive: true });
  writeFileSync(ModeFile, modeInfo, 'utf-8');

  // ---- Check dependency updates (Win only) ----
  if (isWin) {
    log(CYAN, '  Checking dependency updates...');
    const checkUpdatesScript = join(ROOT_DIR, 'scripts', 'check-updates.ps1');
    if (existsSync(checkUpdatesScript)) {
      try {
        pwsh(['-File', checkUpdatesScript, '-CheckOnly'], { timeout: 60000, stdio: 'ignore' });
        const statusFile = join(ROOT_DIR, 'data', 'update-status.json');
        if (existsSync(statusFile)) {
          const status = readJson(statusFile);
          if (status && status.updates_available > 0) {
            log(YELLOW, `  ${status.updates_available} update(s) available -- run check-updates.ps1 -Update`);
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

  // ---- Check for new models (Win only) ----
  if (isWin) {
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
            run(GIT_BIN, ['pull', 'origin', 'main'], { cwd: UserDir, stdio: 'inherit', timeout: 30000 });
            log(GREEN, '  User data synced');
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
    const globalVer = run(OPENCODE_BIN_NAME === 'opencode.exe' ? 'opencode.cmd' : 'opencode', ['--version'], { timeout: 10000 });
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
        const updatedVer = run(OPENCODE_BIN_NAME === 'opencode.exe' ? 'opencode.cmd' : 'opencode', ['--version'], { timeout: 10000 });
        log(GREEN, `  Done. Version: ${updatedVer.success ? updatedVer.stdout : currentGlobal}`);
      }
    }

    // Sync local binary from updated global install
    const npmRoot = run(NPM_BIN, ['root', '-g'], { timeout: 10000 });
    if (npmRoot.success) {
      const globalBin = join(npmRoot.stdout.trim(), 'opencode-ai', 'bin', OPENCODE_BIN_NAME);
      if (existsSync(globalBin) && existsSync(OpenCodeBin)) {
        const globalVersion = run(globalBin, ['--version'], { timeout: 5000 });
        const localVersion = run(OpenCodeBin, ['--version'], { timeout: 5000 });
        if (globalVersion.success && localVersion.success && localVersion.stdout.trim() !== globalVersion.stdout.trim()) {
          log(CYAN, `  Syncing local opencode binary (${localVersion.stdout.trim()} -> ${globalVersion.stdout.trim()})...`);
          copyFileSync(globalBin, OpenCodeBin);
          log(GREEN, '  Done.');
        }
      }
    }
  } catch (e) {
    log(YELLOW, `  WARNING: Binary sync failed: ${e.message || e}`);
  }

  // ---- Ensure Handy portable flag ----
  if (isWin && existsSync(HandyBin)) {
    const portableFlag = join(ROOT_DIR, 'handy-voice', 'Handy', 'portable');
    if (!existsSync(portableFlag)) {
      writeFileSync(portableFlag, '', 'utf-8');
    }
  }

  // ---- Cloudflare Tunnel status check ----
  let cloudflareOk = false;
  const cloudflareDomain = process.env.GLITCH_DOMAIN;

  if (existsSync(CloudflaredBin)) {
    if (existsSync(CloudflaredConfig)) {
      cloudflareOk = true;
      if (cloudflareDomain) {
        log(GREEN, `  Cloudflare Tunnel: ${cloudflareDomain}`);
      } else {
        log(GREEN, '  Cloudflare Tunnel: configured');
      }
    } else {
      log(YELLOW, '  Cloudflare Tunnel: not configured. Run setup-tunnel.ps1 first.');
    }
  } else {
    log(YELLOW, `  Cloudflare Tunnel: ${CLOUDFLARED_BIN_NAME} not found`);
  }

  // ---- Password management (before auth proxy) ----
  let pw = process.env.OPENCODE_SERVER_PASSWORD;
  if (!pw) {
    if (!existsSync(PwFile)) {
      pw = crypto.randomBytes(16).toString('hex');
      writeFileSync(PwFile, pw, 'utf-8');
    } else {
      pw = readFileSync(PwFile, 'utf-8').trim();
    }
    setPasswordAcl(PwFile);
    process.env.OPENCODE_SERVER_PASSWORD = pw;
  }

  const authToken = Buffer.from(`opencode:${pw}`).toString('base64');

  // ---- Project-pinned URL (SPA decodes base64url slug) ----
  const projectDir = process.env.GLITCH_PROJECT_DIR || ROOT_DIR;
  const dirSlug = Buffer.from(projectDir, 'utf-8').toString('base64url');

  // ---- Start Cloudflare Tunnel ----
  if (cloudflareOk) {
    log(CYAN, '  Starting Cloudflare Tunnel...');
    const cfProc = spawn(CloudflaredBin, ['tunnel', '--config', CloudflaredConfig, 'run'], {
      stdio: 'ignore',
      windowsHide: true
    });
    cfProc.on('error', () => { cloudflareOk = false; });
    cfProc.unref();
    trackProcess(cfProc);
    await new Promise(r => setTimeout(r, 2000));
    if (cloudflareDomain) {
      log(GREEN, `  Tunnel running: https://${cloudflareDomain}`);
    }
  }

  // ---- Start Handy (Win only) ----
  if (isWin) {
    if (!isProcessRunning('handy')) {
      if (existsSync(HandyBin)) {
        log(CYAN, '  Starting Handy voice input...');
        const proc = spawn(HandyBin, [], { detached: true, stdio: 'ignore', windowsHide: true });
        proc.unref();
        await new Promise(r => setTimeout(r, 1000));
      } else {
        log(DARK_YELLOW, '  Handy not found (optional). Voice input disabled.');
      }
    } else {
      log(DARK_GREEN, '  Handy already running');
    }
  }

  // ---- Start Auth Proxy ----
  log(CYAN, `  Starting auth proxy (port ${AUTH_PROXY_PORT} -> ${TARGET_PORT})...`);
  try {
    const authProxyProc = spawn('node', [AuthProxyPath, String(AUTH_PROXY_PORT), `http://localhost:${TARGET_PORT}`], {
      stdio: 'ignore',
      windowsHide: true
    });
    authProxyProc.on('error', (err) => {
      log(YELLOW, `  Auth proxy failed to start: ${err.message}`);
    });
    authProxyProc.unref();
    trackProcess(authProxyProc);
    await new Promise(r => setTimeout(r, 1000));
  } catch (e) {
    log(YELLOW, `  Auth proxy start failed: ${e.message}`);
  }

  // ---- Display URLs ----
  log('');
  log(YELLOW, `  Server password: ${pw}`);
  log(YELLOW, '  Username: opencode');
  if (cloudflareDomain) {
    log(GREEN, `  Web access URL: https://${cloudflareDomain}/${dirSlug}/?auth_token=${authToken}`);
  }
  log(GREEN, `  Local URL: http://localhost:${TARGET_PORT}`);
  log('');

  // ---- Periodic path fixer (runs every 5 min) ----
  if (existsSync(FixPathsMjs)) {
    fixerInterval = setInterval(() => {
      run('node', [FixPathsMjs], { timeout: 15000, stdio: 'ignore' });
    }, 300000);
    fixerInterval.unref();
    log(CYAN, '  Path fixer running (every 5 min)');
  }

  // ---- Launch OpenCode Web (blocking) ----
  log(CYAN, '  Launching OpenCode Web...');
  console.log('');

  try {
    run(OpenCodeBin, ['web', '--port', String(TARGET_PORT), '--hostname', '0.0.0.0'], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      timeout: 0
    });
  } catch (e) {
    log(RED, `  OpenCode exited with error: ${e.message || e}`);
  }

  // ---- Cleanup happens here (via finally equivalent through process.on) ----
  log('');
  log(MAGENTA, 'Glitch server session ended.');
}

main().catch(e => {
  log(RED, `  Fatal error: ${e.message || e}`);
  process.exit(1);
});
