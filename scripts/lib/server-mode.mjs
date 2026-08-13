#!/usr/bin/env node

/**
 * Shared server-mode module for Glitch AI
 * Handles all server-specific setup: port check, Cloudflare tunnel,
 * password management, auth proxy, URL display, path fixer, and OpenCode web launch.
 * Used by all launch scripts when --serve flag is passed.
 */

import { existsSync, writeFileSync, readFileSync, copyFileSync, unlinkSync, statSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execFileSync, spawn } from 'child_process';
import { createInterface } from 'readline';
import net from 'net';
import crypto from 'crypto';

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

function run(cmd, args, opts = {}) {
  try {
    if (process.platform === 'win32' && (cmd.endsWith('.cmd') || cmd.endsWith('.bat'))) {
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
    let content = readFileSync(path, 'utf-8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function promptUser(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function timestamp() {
  const n = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${n.getFullYear()}${p(n.getMonth()+1)}${p(n.getDate())}-${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}`;
}

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(true); });
    socket.connect(port, '127.0.0.1');
  });
}

function setPasswordAcl(filePath) {
  try {
    if (process.platform === 'win32') {
      const username = process.env.USERNAME || 'opencode';
      run('icacls', [filePath, '/inheritance:r', '/grant', `${username}:R`], { stdio: 'ignore', timeout: 5000 });
    } else {
      run('chmod', ['600', filePath], { stdio: 'ignore', timeout: 5000 });
    }
  } catch {}
}

function isProcessRunning(name) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/NH', '/FI', `IMAGENAME eq ${name}.exe`], { encoding: 'utf-8', timeout: 5000 });
      return out.includes(`${name}.exe`);
    } else if (process.platform === 'darwin') {
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

// ---- Background process tracking ----
const backgroundProcesses = [];
let fixerInterval = null;

function trackProcess(proc) {
  backgroundProcesses.push(proc);
  return proc;
}

function cleanup() {
  for (const proc of backgroundProcesses) {
    try { if (!proc.killed) proc.kill(); } catch {}
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

// ---- Sessions API (port 4191) ----
// Exposes /sessions and /tokens endpoints reading from the opencode DB.
// See scripts/opencode-sessions-api.mjs for the server implementation.
const SESSIONS_API_PORT = 4191;

async function startSessionsApi(ROOT_DIR) {
  const isWin = process.platform === 'win32';
  const dataDir = join(ROOT_DIR, 'data');
  const scriptPath = join(ROOT_DIR, 'scripts', 'opencode-sessions-api.mjs');
  const pidFilePath = join(dataDir, 'sessions-api.pid');

  if (!existsSync(scriptPath)) {
    log(DARK_YELLOW, `  Sessions API: script not found at ${scriptPath}`);
    return;
  }

  // Skip if port already in use (service already running)
  const portFree = await checkPort(SESSIONS_API_PORT);
  if (!portFree) {
    log(DARK_GREEN, `  Sessions API: already running on port ${SESSIONS_API_PORT}`);
    return;
  }

  try {
    if (!existsSync(dataDir)) { mkdirSync(dataDir, { recursive: true }); }

    const args = [scriptPath, '--port', String(SESSIONS_API_PORT)];
    const proc = spawn('node', args, {
      cwd: ROOT_DIR,
      stdio: 'ignore',
      windowsHide: true,
      detached: !isWin,
    });

    proc.on('error', (err) => {
      log(YELLOW, `  Sessions API failed to start: ${err.message}`);
    });

    proc.unref();
    trackProcess(proc);

    try {
      writeFileSync(pidFilePath, String(proc.pid), 'utf-8');
    } catch {}

    await new Promise(r => setTimeout(r, 500));
    // Verify the process actually bound the port. If node:sqlite is unavailable
    // (or the script crashes on import), the process exits silently and the
    // port stays free — without this check we'd falsely claim it's listening.
    const portBound = !(await checkPort(SESSIONS_API_PORT));
    if (portBound) {
      log(DARK_GREEN, `  Sessions API: listening on port ${SESSIONS_API_PORT} (PID ${proc.pid})`);
    } else {
      log(YELLOW, `  Sessions API: failed to start (process exited or port not bound)`);
    }
  } catch (e) {
    log(YELLOW, `  Sessions API start failed: ${e.message}`);
  }
}

// ---- Money dashboard (port 4110) ----
// Standalone glitch-money control dashboard. Runs in its own visible
// PowerShell window on Windows (mirrors the model-ui visible_window pattern
// in plugin-manager.mjs). Falls back to a detached hidden spawn on Unix.
const MONEY_DASHBOARD_PORT = 4110;

async function startMoneyDashboard(ROOT_DIR) {
  const isWin = process.platform === 'win32';
  const dataDir = join(ROOT_DIR, 'data');
  const moneyDir = process.env.MONEY_DASHBOARD_DIR || join(ROOT_DIR, '..', 'code', 'glitch-money');
  const serverScript = join(moneyDir, 'dashboard', 'server.mjs');
  const pidFilePath = join(dataDir, 'money-dashboard.pid');

  if (!existsSync(serverScript)) {
    log(DARK_YELLOW, `  Money dashboard: server not found at ${serverScript}`);
    return;
  }

  // Skip if port already in use (service already running)
  const portFree = await checkPort(MONEY_DASHBOARD_PORT);
  if (!portFree) {
    log(DARK_GREEN, `  Money dashboard: already running on port ${MONEY_DASHBOARD_PORT}`);
    return;
  }

  try {
    if (!existsSync(dataDir)) { mkdirSync(dataDir, { recursive: true }); }

    if (isWin) {
      // Visible PowerShell window pattern (mirrors startPluginVisible in plugin-manager.mjs)
      const title = `Glitch: money-dashboard (port ${MONEY_DASHBOARD_PORT})`;
      const ps1Path = join(dataDir, 'money-dashboard-window.ps1');
      const esc = (s) => s.replace(/'/g, "''");

      // Run node in foreground with -NoExit so the window stays open on error.
      // Pass GLITCH_AI_ROOT so the dashboard's fleet-db/cost-db can locate the
      // opencode DB and config files without hardcoded paths.
      const innerCommand = `& { $host.ui.RawUI.WindowTitle = '${esc(title)}'; Set-Location -LiteralPath '${esc(moneyDir)}'; $env:GLITCH_AI_ROOT = '${esc(ROOT_DIR)}'; node dashboard/server.mjs }`;
      const ps1Inner = esc(innerCommand);
      const ps1PidPath = esc(pidFilePath);

      const ps1Content =
        `$proc = Start-Process powershell.exe -WindowStyle Normal -PassThru -ArgumentList @('-NoExit','-ExecutionPolicy','Bypass','-Command', '${ps1Inner}')\r\n` +
        `if ($proc) { $proc.Id | Out-File -FilePath '${ps1PidPath}' -Encoding ascii }\r\n`;

      writeFileSync(ps1Path, ps1Content, 'utf-8');

      const launcher = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Path], {
        cwd: moneyDir,
        stdio: 'ignore',
        windowsHide: true,
        detached: false,
      });
      launcher.unref();
      trackProcess(launcher);

      // Wait briefly for the PID file to appear (mirrors plugin-manager pattern).
      let realPid = null;
      const startedAt = Date.now();
      while (Date.now() - startedAt < 2000) {
        await new Promise(r => setTimeout(r, 100));
        if (existsSync(pidFilePath)) {
          try {
            const content = readFileSync(pidFilePath, 'utf-8').trim();
            const parsed = parseInt(content, 10);
            if (parsed > 0) { realPid = parsed; break; }
          } catch {}
        }
      }

      log(DARK_GREEN, `  Money dashboard: listening on port ${MONEY_DASHBOARD_PORT} (PID ${realPid || launcher.pid})`);
    } else {
      // Non-Windows: detached hidden spawn fallback
      const proc = spawn('node', [serverScript], {
        cwd: moneyDir,
        stdio: 'ignore',
        windowsHide: true,
        detached: true,
        env: { ...process.env, GLITCH_AI_ROOT: ROOT_DIR },
      });
      proc.on('error', (err) => {
        log(YELLOW, `  Money dashboard failed to start: ${err.message}`);
      });
      proc.unref();
      trackProcess(proc);

      try {
        writeFileSync(pidFilePath, String(proc.pid), 'utf-8');
      } catch {}

      await new Promise(r => setTimeout(r, 500));
      log(DARK_GREEN, `  Money dashboard: listening on port ${MONEY_DASHBOARD_PORT} (PID ${proc.pid})`);
    }
  } catch (e) {
    log(YELLOW, `  Money dashboard start failed: ${e.message}`);
  }
}

/**
 * Launch OpenCode in server (web) mode with all server extras.
 * 
 * @param {Object} options
 * @param {string} options.OpenCodeBin - Path to the opencode binary (required)
 * @param {string} options.ROOT_DIR - Project root directory (required)
 * @param {number} [options.TARGET_PORT=4102] - Server port
 * @param {number} [options.AUTH_PROXY_PORT=4100] - Auth proxy port
 * @param {string} [options.CloudflaredBin] - Path to cloudflared (derived from ROOT_DIR if not set)
 * @param {string} [options.CloudflaredConfig] - Path to cloudflared config (derived if not set)
 * @param {string} [options.cloudflareDomain] - Cloudflare tunnel domain from env
 * @param {string} [options.HandyBin] - Path to Handy binary (derived if not set)
 * @param {string} [options.PwFile] - Password file path (derived if not set)
 * @param {string} [options.AuthProxyPath] - Auth proxy script path (derived if not set)
 * @param {string} [options.FixPathsMjs] - Path fixer script path (derived if not set)
 * @param {boolean} [options.skipBootstrap=false] - Skip OpenCode download bootstrap
 */
export async function launchServer(options = {}) {
  const {
    OpenCodeBin,
    ROOT_DIR,
    TARGET_PORT = 4102,
    AUTH_PROXY_PORT = 4100,
    skipBootstrap = false,
  } = options;
  let cloudflareDomain = options.cloudflareDomain || process.env.GLITCH_DOMAIN;

  if (!OpenCodeBin || !ROOT_DIR) {
    log(RED, '  ERROR: OpenCodeBin and ROOT_DIR are required');
    process.exit(1);
  }

  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  // Derived paths
  const CLOUDFLARED_BIN = options.CloudflaredBin || join(ROOT_DIR, isWin ? 'cloudflared.exe' : 'cloudflared');
  const CLOUDFLARED_CONFIG = options.CloudflaredConfig || join(ROOT_DIR, 'config', 'cloudflared-config.yml');
  const HANDY_BIN = options.HandyBin || (() => {
    if (isWin) return join(ROOT_DIR, 'handy-voice', 'Handy', 'handy.exe');
    if (isMac) return join(ROOT_DIR, 'handy-voice', 'Handy.app', 'Contents', 'MacOS', 'Handy');
    return join(ROOT_DIR, 'handy-voice', 'Handy.AppImage');
  })();
  const PW_FILE = options.PwFile || join(ROOT_DIR, '.server-password');
  const AUTH_PROXY = options.AuthProxyPath || join(ROOT_DIR, 'plugins', 'auth-proxy.mjs');
  const FIX_PATHS = options.FixPathsMjs || join(ROOT_DIR, 'scripts', 'fix-paths.mjs');
  const SETUP_TUNNEL_SCRIPT = join(ROOT_DIR, 'scripts', isWin ? 'setup-tunnel.ps1' : 'setup-tunnel.sh');

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

  // ---- Cloudflare Tunnel status check + auto-setup ----
  let cloudflareOk = false;
  const HOME_DIR = process.env.USERPROFILE || process.env.HOME;

  if (existsSync(CLOUDFLARED_BIN)) {
    // Ensure config exists (copy from template if this is a fresh clone)
    if (!existsSync(CLOUDFLARED_CONFIG)) {
      const templateFile = join(ROOT_DIR, 'config', 'cloudflared-config.yml.template');
      if (existsSync(templateFile)) {
        log(YELLOW, '  Creating cloudflared-config.yml from template...');
        copyFileSync(templateFile, CLOUDFLARED_CONFIG);
      }
    }

    if (existsSync(CLOUDFLARED_CONFIG)) {
      // Parse tunnel UUID from config
      const configContent = readFileSync(CLOUDFLARED_CONFIG, 'utf-8');
      const uuidMatch = configContent.match(/^tunnel:\s*([a-f0-9-]+)/m);
      const uuid = uuidMatch ? uuidMatch[1] : null;

      // Check credential file exists for this tunnel
      const isAlreadyConfigured = uuid && existsSync(join(HOME_DIR, '.cloudflared', `${uuid}.json`));

      if (isAlreadyConfigured) {
        // Tunnel is ready to use
        cloudflareOk = true;

        // Derive domain from config or domain file (allow env var override)
        if (!cloudflareDomain) {
          const domainFile = join(ROOT_DIR, 'data', 'cloudflare-domain.txt');
          if (existsSync(domainFile)) {
            cloudflareDomain = readFileSync(domainFile, 'utf-8').trim();
          }
        }
        if (!cloudflareDomain) {
          const hostnameMatch = configContent.match(/hostname:\s*(\S+)/);
          cloudflareDomain = hostnameMatch ? hostnameMatch[1] : null;
        }

        if (cloudflareDomain) {
          log(GREEN, `  Cloudflare Tunnel: ${cloudflareDomain}`);
        } else {
          log(GREEN, '  Cloudflare Tunnel: configured');
        }
      } else {
        // Tunnel credentials missing — try auto-setup
        const certPath = join(HOME_DIR, '.cloudflared', 'cert.pem');
        const hasAuth = existsSync(certPath);
        const LOCK_FILE = join(ROOT_DIR, 'data', '.tunnel-setup.lock');

        if (hasAuth) {
          log(YELLOW, '  Tunnel credentials not found for current config.');
          log(CYAN, '  Auto-creating a new tunnel for this machine...');

          // Acquire lock (avoid concurrent setup)
          if (existsSync(LOCK_FILE)) {
            const lockAge = Date.now() - statSync(LOCK_FILE).mtimeMs;
            if (lockAge < 120000) {
              log(YELLOW, '  Tunnel setup already in progress on another process. Waiting...');
              let waited = 0;
              while (existsSync(LOCK_FILE) && waited < 60) {
                await new Promise(r => setTimeout(r, 2000));
                waited += 2;
              }
            } else {
              log(YELLOW, '  Removing stale tunnel setup lock...');
              unlinkSync(LOCK_FILE);
            }
          }
          writeFileSync(LOCK_FILE, String(process.pid));

          try {
            // Ensure data/ directory exists
            const dataDir = join(ROOT_DIR, 'data');
            if (!existsSync(dataDir)) { mkdirSync(dataDir, { recursive: true }); }

            const setupResult = isWin
              ? spawn('powershell.exe', [
                  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                  SETUP_TUNNEL_SCRIPT, '-Auto'
                ], { stdio: 'inherit' })
              : spawn('bash', [SETUP_TUNNEL_SCRIPT, '--auto'], { stdio: 'inherit' });

            await new Promise((resolve, reject) => {
              setupResult.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`${isWin ? 'setup-tunnel.ps1' : 'setup-tunnel.sh'} exited with code ${code}`));
              });
              setupResult.on('error', reject);
            });

            // Re-read domain from the file auto-setup wrote
            const domainFile = join(ROOT_DIR, 'data', 'cloudflare-domain.txt');
            if (existsSync(domainFile)) {
              cloudflareDomain = readFileSync(domainFile, 'utf-8').trim();
            }
            cloudflareOk = true;
            log(GREEN, `  Tunnel ready: https://${cloudflareDomain}`);
          } catch (err) {
            log(YELLOW, `  Tunnel auto-setup failed: ${err.message}`);
            log(YELLOW, '  Starting server without tunnel (local-only).');
            cloudflareOk = false;
          } finally {
            if (existsSync(LOCK_FILE)) unlinkSync(LOCK_FILE);
          }
        } else {
          // Not authenticated with Cloudflare at all
          log(YELLOW, '  Cloudflare not authenticated on this machine.');
          if (process.stdin.isTTY) {
            log(CYAN, '  Auto-setup can open your browser for one-time Cloudflare authorization.');
            const answer = await promptUser('  Open browser to authorize Cloudflare? [Y/n]: ');
            if (answer === '' || answer === 'y' || answer === 'yes') {
              log(CYAN, '  Launching Cloudflare login (opens browser)...');
              const loginProc = spawn(CLOUDFLARED_BIN, ['tunnel', 'login'], { stdio: 'inherit' });
              await new Promise((resolve, reject) => {
                loginProc.on('close', (code) => {
                  if (code === 0) resolve();
                  else reject(new Error(`cloudflared tunnel login exited with code ${code}`));
                });
                loginProc.on('error', reject);
              });
              // After auth, retry auto-setup
              log(CYAN, '  Cloudflare authorized. Creating tunnel...');
              const retryResult = isWin
                ? spawn('powershell.exe', [
                    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                    SETUP_TUNNEL_SCRIPT, '-Auto'
                  ], { stdio: 'inherit' })
                : spawn('bash', [SETUP_TUNNEL_SCRIPT, '--auto'], { stdio: 'inherit' });
              await new Promise((resolve, reject) => {
                retryResult.on('close', (code) => {
                  if (code === 0) resolve();
                  else reject(new Error(`${isWin ? 'setup-tunnel.ps1' : 'setup-tunnel.sh'} exited with code ${code}`));
                });
                retryResult.on('error', reject);
              });
              const domainFile = join(ROOT_DIR, 'data', 'cloudflare-domain.txt');
              if (existsSync(domainFile)) {
                cloudflareDomain = readFileSync(domainFile, 'utf-8').trim();
              }
              cloudflareOk = true;
              log(GREEN, `  Tunnel ready: https://${cloudflareDomain}`);
            } else {
              log(YELLOW, '  Tunnel setup skipped. Run later: cloudflared tunnel login');
            }
          } else {
            log(YELLOW, `  Run in a terminal to set up the tunnel: ${isWin ? '.\\scripts\\setup-tunnel.ps1' : './scripts/setup-tunnel.sh'}`);
          }
        }
      }
    } else {
      log(YELLOW, `  Cloudflare Tunnel: not configured. Run ${isWin ? 'setup-tunnel.ps1' : 'setup-tunnel.sh'} first.`);
    }
  } else {
    log(YELLOW, `  Cloudflare Tunnel: ${isWin ? 'cloudflared.exe' : 'cloudflared'} not found`);
  }

  // ---- Password management (before auth proxy) ----
  let pw = process.env.OPENCODE_SERVER_PASSWORD;
  if (!pw) {
    if (!existsSync(PW_FILE)) {
      pw = crypto.randomBytes(16).toString('hex');
      writeFileSync(PW_FILE, pw, 'utf-8');
    } else {
      pw = readFileSync(PW_FILE, 'utf-8').trim();
    }
    setPasswordAcl(PW_FILE);
    process.env.OPENCODE_SERVER_PASSWORD = pw;
  }

  const authToken = Buffer.from(`opencode:${pw}`).toString('base64');

  // ---- Project-pinned URL (SPA decodes base64url slug) ----
  const projectDir = process.env.GLITCH_PROJECT_DIR || ROOT_DIR;
  const dirSlug = Buffer.from(projectDir, 'utf-8').toString('base64url');

  // ---- Start Cloudflare Tunnel ----
  if (cloudflareOk) {
    log(CYAN, '  Starting Cloudflare Tunnel...');
    const cfProc = spawn(CLOUDFLARED_BIN, ['tunnel', '--config', CLOUDFLARED_CONFIG, 'run'], {
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

  // ---- Start Handy (if not already running) ----
  const handyProcName = isWin ? 'handy' : 'Handy';
  if (!isProcessRunning(handyProcName)) {
    if (existsSync(HANDY_BIN)) {
      log(CYAN, '  Starting Handy voice input...');
      if (isMac) {
        const handyApp = join(ROOT_DIR, 'handy-voice', 'Handy.app');
        if (existsSync(handyApp)) {
          spawn('open', [handyApp], { detached: true, stdio: 'ignore' }).unref();
        } else {
          const proc = spawn(HANDY_BIN, [], { detached: true, stdio: 'ignore' });
          proc.unref();
        }
      } else {
        const proc = spawn(HANDY_BIN, [], { detached: true, stdio: 'ignore', windowsHide: true });
        proc.unref();
      }
      await new Promise(r => setTimeout(r, 1000));
    } else {
      log(DARK_YELLOW, '  Handy not found (optional). Voice input disabled.');
    }
  } else {
    log(DARK_GREEN, '  Handy already running');
  }

  // ---- Start Auth Proxy ----
  log(CYAN, `  Starting auth proxy (port ${AUTH_PROXY_PORT} -> ${TARGET_PORT})...`);
  try {
    const authProxyProc = spawn('node', [AUTH_PROXY, String(AUTH_PROXY_PORT), `http://localhost:${TARGET_PORT}`], {
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

  // ---- Start Sessions API (port 4191) ----
  await startSessionsApi(ROOT_DIR);

  // ---- Start Money dashboard (port 4110) ----
  await startMoneyDashboard(ROOT_DIR);

  // ---- Start enabled plugins ----
  log(CYAN, '  Starting enabled plugins...');
  try {
    const { startEnabledPlugins, listPlugins } = await import('./plugin-manager.mjs');
    const results = await startEnabledPlugins();
    for (const r of results) {
      if (r.success) {
        log(DARK_GREEN, `  Plugin: ${r.name} (PID ${r.pid})`);
      } else if (r.error && !r.error.includes('already running')) {
        log(YELLOW, `  Plugin ${r.name}: ${r.error}`);
      }
    }
  } catch (e) {
    log(YELLOW, `  Plugin manager error: ${e.message}`);
  }

  // ---- Display URLs ----
  log('');
  log(MAGENTA, ' ┌────────────────────────────────────────────────────────┐');
  log(MAGENTA, ' │ Glitch Web Server Ready                                │');
  log(MAGENTA, ' ├────────────────────────────────────────────────────────┤');
  log(WHITE,   ' │ Credentials:                                           │');
  log(WHITE,   ` │   Username: opencode                                   │`);
  log(WHITE,   ` │   Password: ${pw.padEnd(42)} │`);
  log(MAGENTA, ' └────────────────────────────────────────────────────────┘');
  log('');
  log(CYAN, '  Web URLs:');
  if (cloudflareDomain) {
    log(GREEN, `    Tunnel: https://${cloudflareDomain}/${dirSlug}/?auth_token=${authToken}`);
  }
  log(GREEN,   `    Model Switcher: http://localhost:4104`);
  if (cloudflareDomain) {
    log(GREEN, `    Model Switcher (tunnel): https://${cloudflareDomain}/models?auth_token=${authToken}`);
  }
  log(GREEN,   `    Money dashboard:  http://localhost:4110`);
  log(GREEN,   `    Sessions API:     http://localhost:4191`);
  log(GREEN,   `    Local:  http://localhost:${TARGET_PORT}/${dirSlug}/`);
  log('');
  // Show enabled plugin URLs
  const { listPlugins } = await import('./plugin-manager.mjs');
  const allPlugins = listPlugins();
  for (const plugin of allPlugins) {
    if (plugin.enabled && plugin.port && plugin.name !== 'model-ui') {
      const webPath = plugin.web_path || `/${plugin.name}/`;
      log(DARK_GREEN, `  ${plugin.name}: http://localhost:${plugin.port}`);
      if (cloudflareDomain) {
        log(DARK_GREEN, `  ${plugin.name} (tunnel): https://${cloudflareDomain}${webPath}?auth_token=${authToken}`);
      }
    }
  }
  log('');

  // ---- Periodic path fixer (runs every 5 min) ----
  if (existsSync(FIX_PATHS)) {
    fixerInterval = setInterval(() => {
      run('node', [FIX_PATHS], { timeout: 15000, stdio: 'ignore' });
    }, 300000);
    fixerInterval.unref();
    log(CYAN, '  Path fixer running (every 5 min)');
  }

  // ---- Launch OpenCode Web (blocking) ----
  log(CYAN, '  Launching OpenCode Web...');
  console.log('');

  try {
    const opencodeProc = spawn(OpenCodeBin, ['web', '--port', String(TARGET_PORT), '--hostname', '0.0.0.0'], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
    // Write PID for restart helper
    writeFileSync(join(ROOT_DIR, 'data', 'opencode.pid'), String(opencodeProc.pid), 'utf-8');
    await new Promise((resolve) => opencodeProc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        log(RED, `  OpenCode exited with code ${code}`);
      }
      resolve();
    }));
  } catch (e) {
    log(RED, `  OpenCode exited with error: ${e.message || e}`);
  }

  // ---- Done ----
  log('');
  log(MAGENTA, 'Glitch server session ended.');
}
