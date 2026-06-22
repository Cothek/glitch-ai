#!/usr/bin/env node

/**
 * Shared server-mode module for Glitch AI
 * Handles all server-specific setup: port check, Cloudflare tunnel,
 * password management, auth proxy, URL display, path fixer, and OpenCode web launch.
 * Used by all launch scripts when --serve flag is passed.
 */

import { existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync, spawn } from 'child_process';
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
    cloudflareDomain = process.env.GLITCH_DOMAIN,
    skipBootstrap = false,
  } = options;

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

  // ---- Cloudflare Tunnel status check ----
  let cloudflareOk = false;

  if (existsSync(CLOUDFLARED_BIN)) {
    if (existsSync(CLOUDFLARED_CONFIG)) {
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
    run(OpenCodeBin, ['web', '--port', String(TARGET_PORT), '--hostname', '0.0.0.0'], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      timeout: 0
    });
  } catch (e) {
    log(RED, `  OpenCode exited with error: ${e.message || e}`);
  }

  // ---- Done ----
  log('');
  log(MAGENTA, 'Glitch server session ended.');
}
