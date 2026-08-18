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

// Module-scope process helpers (used by both launchServer's port-check and
// killPidFromFile). Defined here so cleanup() — which runs on process exit,
// outside launchServer's closure — can verify a PID is alive and matches the
// expected service before taskkilling it. Windows recycles PIDs; a stale pid
// file could otherwise point at an unrelated process that now holds that PID.
function getProcessName(pid) {
  if (!pid) return null;
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf-8', timeout: 5000 });
      // Line looks like: "node.exe  1234 Console  1 12,345 K"
      const m = out.match(/^\s*(\S+)\.exe\s/i);
      return m ? m[1].toLowerCase() : null;
    } else {
      const out = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf-8', timeout: 5000 });
      return out.trim().toLowerCase() || null;
    }
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but we lack permission to signal it.
    return e.code === 'EPERM';
  }
}

// ---- Background process tracking ----
const backgroundProcesses = [];
let fixerInterval = null;
// Set by launchServer() so cleanup() can find data/<service>.pid files.
// Visible-window services (cloudflared, auth-proxy) are NOT in
// backgroundProcesses (they run in their own windows); cleanup reads their
// pid files and taskkills them on Ctrl+C to prevent orphans holding ports.
let rootDirRef = null;

function trackProcess(proc) {
  backgroundProcesses.push(proc);
  return proc;
}

function killPidFromFile(pidFileName, expectedNames) {
  if (!rootDirRef) return;
  const pidFile = join(rootDirRef, 'data', pidFileName);
  if (!existsSync(pidFile)) return;
  let pid = 0;
  try {
    pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    if (pid > 0 && process.platform === 'win32') {
      // Guard against recycled PIDs: only kill if the process is alive AND its
      // name matches one of the expected services. A stale pid file pointing
      // at an unrelated process (Windows recycles PIDs aggressively) is left
      // untouched rather than risk killing the user's own work.
      if (isProcessAlive(pid)) {
        const name = getProcessName(pid);
        if (name && expectedNames.includes(name)) {
          execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 });
        }
      }
    }
  } catch {}
  // Delete the pid file when the recorded process is confirmed dead (or the
  // pid was invalid). This prevents stale reads in startVisibleWindow's
  // read-back loop, which would otherwise log the old PID as the new service's
  // PID (PM-NNN: Cloudflare tunnel failure from stale pid read + duplicate
  // connector). We only delete when the process is NOT alive — if it's still
  // running and we didn't kill it (name mismatch / recycled PID), leave the
  // file alone so the caller can investigate.
  try {
    if (pid <= 0 || !isProcessAlive(pid)) {
      unlinkSync(pidFile);
    }
  } catch {}
}

function cleanup() {
  for (const proc of backgroundProcesses) {
    try { if (!proc.killed) proc.kill(); } catch {}
  }
  backgroundProcesses.length = 0;
  // Kill visible-window services by their pid files (Windows only).
  // Each call verifies the PID is alive and its process name matches the
  // expected set before taskkilling — guards against recycled PIDs.
  killPidFromFile('cloudflared.pid', ['cloudflared', 'powershell', 'pwsh', 'node']);
  killPidFromFile('auth-proxy.pid', ['node', 'powershell', 'pwsh']);
  killPidFromFile('money-dashboard.pid', ['node', 'powershell', 'pwsh']);
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

// ---- Visible window launcher (shared helper) ----
// Extracts the Windows visible-PowerShell-window pattern (mirrors
// startPluginVisible in plugin-manager.mjs) into a reusable helper so
// cloudflared, auth-proxy, and the money dashboard all start the same way.
// The user can see and close each service window; PID files let cleanup()
// kill orphans on Ctrl+C. Unix callers fall back to a detached hidden spawn.
//
// Two modes:
//   1. Direct mode (serviceExe provided): the PS1 script runs inside the
//      visible window and starts the service directly via Start-Process
//      -PassThru -NoNewWindow. The PID written to the pid file IS the real
//      service PID (node.exe, cloudflared.exe, etc.). The visible window is
//      spawned directly from Node (no outer launcher).
//   2. Legacy mode (serviceExe NOT provided): an outer launcher PS1 starts a
//      visible window running innerCommand. The pid file holds the PowerShell
//      window PID (not the real service PID). Kept for backward compatibility.
//
// @param {Object} opts
// @param {string} opts.ROOT_DIR       - Project root (data/ lives here).
// @param {string} opts.title          - Window title (also shown in logs).
// @param {string} opts.ps1FileName    - File name written under data/ (e.g. 'cloudflared-window.ps1').
// @param {string} opts.pidFileName    - File name written under data/ (e.g. 'cloudflared.pid').
// @param {string} opts.cwd            - Working directory for the inner command.
// @param {string} opts.innerCommand   - PowerShell command string (legacy mode only).
// @param {string} [opts.serviceExe]   - Service executable path (direct mode).
// @param {string[]} [opts.serviceArgs] - Arguments for the service (direct mode).
// @param {string} [opts.setupCommand] - PowerShell commands run before the service (e.g. env vars).
// @returns {Promise<number|null>}     - Real PID read from the pid file, or null on timeout.
async function startVisibleWindow({ ROOT_DIR, title, ps1FileName, pidFileName, cwd, innerCommand, serviceExe, serviceArgs, setupCommand }) {
  const dataDir = join(ROOT_DIR, 'data');
  if (!existsSync(dataDir)) { mkdirSync(dataDir, { recursive: true }); }

  const ps1Path = join(dataDir, ps1FileName);
  const pidFilePath = join(dataDir, pidFileName);
  const esc = (s) => s.replace(/'/g, "''");

  let ps1Content;
  let directSpawn;

  if (serviceExe) {
    // PS 5.1 Start-Process -ArgumentList joins array elements with spaces and
    // does NOT re-quote them. Any arg containing a space (e.g. a path under
    // "E:\Glitch AI\") gets split into multiple command-line tokens, the spawned
    // process fails to find its file and exits immediately (cloudflared:
    // "open E:\Glitch: The system cannot find the file specified"). Wrap
    // space-containing args in literal double quotes so the joined command line
    // preserves the spaces (PM-037: tunnel/auth-proxy/money died on spaced paths).
    const argsArray = (serviceArgs || []).map(a => {
      const needsQuote = a.includes(' ');
      return needsQuote ? `'"${esc(a)}"'` : `'${esc(a)}'`;
    }).join(',');
    const setup = setupCommand ? `${setupCommand}\r\n` : '';
    ps1Content =
      `$host.ui.RawUI.WindowTitle = '${esc(title)}'\r\n` +
      `Set-Location -LiteralPath '${esc(cwd)}'\r\n` +
      `${setup}` +
      `$__child = Start-Process -FilePath '${esc(serviceExe)}' -ArgumentList @(${argsArray}) -PassThru -NoNewWindow\r\n` +
      `$__child.Id | Out-File -FilePath '${esc(pidFilePath)}' -Encoding ascii\r\n` +
      `Wait-Process -Id $__child.Id\r\n`;
    directSpawn = true;
  } else {
    const wrapped = `& { $host.ui.RawUI.WindowTitle = '${esc(title)}'; Set-Location -LiteralPath '${esc(cwd)}'; ${innerCommand} }`;
    const ps1Inner = esc(wrapped);
    // Same space-quoting fix as the direct branch: the -Command value must be a
    // single command-line token, so wrap it in literal double quotes.
    const ps1CmdValue = `'"${ps1Inner}"'`;
    const ps1PidPath = esc(pidFilePath);
    ps1Content =
      `$proc = Start-Process powershell.exe -WindowStyle Normal -PassThru -ArgumentList @('-NoExit','-ExecutionPolicy','Bypass','-Command', ${ps1CmdValue})\r\n` +
      `if ($proc) { $proc.Id | Out-File -FilePath '${ps1PidPath}' -Encoding ascii }\r\n`;
    directSpawn = false;
  }

  writeFileSync(ps1Path, ps1Content, 'utf-8');

  const launcher = directSpawn
    ? spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-WindowStyle', 'Normal', '-File', ps1Path], {
        cwd,
        stdio: 'ignore',
        windowsHide: false,
        detached: false,
      })
    : spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Path], {
        cwd,
        stdio: 'ignore',
        windowsHide: true,
        detached: false,
      });
  launcher.unref();
  trackProcess(launcher);

  let launcherFailed = false;
  launcher.on('exit', () => { launcherFailed = true; });

  let realPid = null;
  const startedAt = Date.now();
  const retryMs = directSpawn ? 3000 : 2000;
  // Record the pid file's mtime BEFORE spawning so we can detect a fresh write
  // from the child. Without this guard, the read-back loop reads a pre-existing
  // stale pid file (e.g. from a previous session) and returns the OLD pid as
  // if it were the new service's PID (PM-NNN: Cloudflare tunnel failure from
  // stale pid read + duplicate connector).
  let initialMtimeMs = 0;
  try {
    if (existsSync(pidFilePath)) {
      initialMtimeMs = statSync(pidFilePath).mtimeMs;
    }
  } catch {}
  while (Date.now() - startedAt < retryMs) {
    await new Promise(r => setTimeout(r, 100));
    if (existsSync(pidFilePath)) {
      try {
        const stat = statSync(pidFilePath);
        // Only accept the pid if the file was written AFTER we started spawning.
        // This ensures we read the child's write, not a pre-existing stale value.
        if (stat.mtimeMs <= initialMtimeMs) continue;
        const content = readFileSync(pidFilePath, 'utf-8').trim();
        const parsed = parseInt(content, 10);
        if (parsed > 0) { realPid = parsed; break; }
      } catch {}
    }
    if (launcherFailed && !existsSync(pidFilePath)) break;
  }

  return realPid;
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
    if (isWin) {
      // Pass GLITCH_AI_ROOT so the dashboard's fleet-db/cost-db can locate the
      // opencode DB and config files without hardcoded paths.
      const realPid = await startVisibleWindow({
        ROOT_DIR,
        title: `Glitch: money-dashboard (port ${MONEY_DASHBOARD_PORT})`,
        ps1FileName: 'money-dashboard-window.ps1',
        pidFileName: 'money-dashboard.pid',
        cwd: moneyDir,
        serviceExe: 'node',
        serviceArgs: [serverScript, '--force-seed'],
        setupCommand: `$env:GLITCH_AI_ROOT = '${ROOT_DIR.replace(/'/g, "''")}'`,
      });
      log(DARK_GREEN, `  Money dashboard: listening on port ${MONEY_DASHBOARD_PORT} (PID ${realPid || 'unknown'})`);
    } else {
      // Non-Windows: detached hidden spawn fallback
      if (!existsSync(dataDir)) { mkdirSync(dataDir, { recursive: true }); }
      const proc = spawn('node', [serverScript, '--force-seed'], {
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
export function cleanupServices() {
  cleanup();
}

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

  // Capture ROOT_DIR for cleanup() so it can kill visible-window services by pid file.
  rootDirRef = ROOT_DIR;

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
  // Detects the exact PID holding a port and, if it looks like an orphaned
  // Glitch process, offers to kill it. Two tiers of process names:
  //   - GLITCH_SPECIFIC: opencode, cloudflared — safe to auto-kill (default Y)
  //   - GENERIC: node, powershell, pwsh — could be the user's own work, so an
  //     explicit 'y'/'yes' is required (default N)
  // Falls back to the existing error + manual fix hint for unknown processes.
  const GLITCH_SPECIFIC_PROCESS_NAMES = new Set(['opencode', 'cloudflared']);
  const GENERIC_PROCESS_NAMES = new Set(['node', 'powershell', 'pwsh']);
  const ALL_KNOWN_PROCESS_NAMES = new Set([...GLITCH_SPECIFIC_PROCESS_NAMES, ...GENERIC_PROCESS_NAMES]);

  function getPortPid(port) {
    try {
      if (isWin) {
        // netstat -ano: find the LISTENING line for :<port>, last column is PID.
        // Windows output looks like:
        //   "  TCP    0.0.0.0:4102           0.0.0.0:0              LISTENING       12345"
        // The port is preceded by a COLON (0.0.0.0:4102), not whitespace, so
        // the regex must accept either a colon or whitespace before the port.
        // IPv6 form "[::]:4102 ... LISTENING 12345" also matches (same PID).
        const out = execFileSync('netstat', ['-ano'], { encoding: 'utf-8', timeout: 5000, maxBuffer: 10 * 1024 * 1024 });
        const re = new RegExp(`[:\\s]${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)$`, 'm');
        const m = out.match(re);
        return m ? parseInt(m[1], 10) : null;
      } else {
        const out = execFileSync('lsof', ['-i', `:${port}`, '-t'], { encoding: 'utf-8', timeout: 5000 });
        const pid = parseInt(out.trim().split('\n')[0], 10);
        return pid > 0 ? pid : null;
      }
    } catch {
      return null;
    }
  }

  // Map port numbers to their pid-file names so checkAndClearPort can
  // recognize an orphaned auth-proxy or cloudflared even when the process
  // name is generic ('node' on Windows). Without this, a restart leaves the
  // old auth-proxy holding port 4100, and since 'node' is in the GENERIC set
  // (default-N kill), non-interactive callers skip it → process.exit(1) kills
  // the entire Glitch process.
  const PORT_PID_FILE_MAP = {
    [TARGET_PORT]: null,           // opencode — already GLITCH_SPECIFIC
    [AUTH_PROXY_PORT]: 'auth-proxy.pid',
  };

  async function checkAndClearPort(port) {
    const free = await checkPort(port);
    if (free) {
      log(CYAN, `  Port ${port} is free`);
      return true;
    }

    const pid = getPortPid(port);
    const name = getProcessName(pid);

    // Check if this port's PID matches a known Glitch service pid file.
    // If so, treat it as Glitch-specific (auto-kill in non-interactive mode)
    // even if the process name is generic ('node'). This is the key fix for
    // the restart port-conflict cascade: the old auth-proxy runs as 'node'
    // and would otherwise be skipped in non-interactive mode.
    let isGlitchServiceByPidFile = false;
    const pidFileName = PORT_PID_FILE_MAP[port];
    if (pidFileName && rootDirRef) {
      const pidFilePath = join(rootDirRef, 'data', pidFileName);
      if (existsSync(pidFilePath)) {
        try {
          const filePid = parseInt(readFileSync(pidFilePath, 'utf-8').trim(), 10);
          if (filePid > 0 && filePid === pid) {
            isGlitchServiceByPidFile = true;
          }
        } catch {}
      }
    }

    if (pid && name && (ALL_KNOWN_PROCESS_NAMES.has(name) || isGlitchServiceByPidFile)) {
      const isGlitchSpecific = GLITCH_SPECIFIC_PROCESS_NAMES.has(name) || isGlitchServiceByPidFile;
      log(YELLOW, `  Port ${port} is held by ${name} (PID ${pid}) — likely an orphaned Glitch process.`);

      // Decide whether to kill. Two gates:
      //   1. TTY gate (m2): only prompt interactively when stdin is a TTY.
      //      Non-interactive callers (serve.mjs) get default behavior silently.
      //   2. Default-Y vs default-N (M1): Glitch-specific names (opencode,
      //      cloudflared) default to YES (empty answer kills). Generic names
      //      (node, powershell, pwsh) default to NO — require explicit 'y'/'yes'
      //      so we never kill the user's own node server by accident.
      //      EXCEPTION: if the PID matches a known Glitch pid file (e.g.
      //      auth-proxy.pid), treat as Glitch-specific regardless of name.
      let shouldKill;
      if (process.stdin.isTTY) {
        const hint = isGlitchSpecific ? '[Y/n]' : '[y/N]';
        const answer = await promptUser(`  Kill it and continue? ${hint}: `);
        if (isGlitchSpecific) {
          shouldKill = (answer === '' || answer === 'y' || answer === 'yes');
        } else {
          shouldKill = (answer === 'y' || answer === 'yes');
        }
      } else {
        // Non-interactive: auto-kill Glitch-specific, skip generic.
        shouldKill = isGlitchSpecific;
      }

      if (shouldKill) {
        try {
          if (isWin) {
            execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 });
          } else {
            execFileSync('kill', [String(pid)], { stdio: 'ignore', timeout: 5000 });
          }
        } catch {}
        // Wait 2000ms for TIME_WAIT sockets to clear (was 500ms — too short
        // for Windows TCP stack to release the port after taskkill).
        await new Promise(r => setTimeout(r, 2000));
        const nowFree = await checkPort(port);
        if (nowFree) {
          log(GREEN, `  Port ${port} freed (killed PID ${pid}).`);
          return true;
        }
        log(RED, `  Port ${port} still in use after killing PID ${pid}.`);
      } else {
        log(YELLOW, `  Declined to kill PID ${pid}.`);
      }
    }

    // Either unknown process, user declined, or kill failed — show the error.
    log(RED, `  ERROR: Port ${port} is in use (likely orphan TCP socket from previous crash).`);
    if (pid && name) {
      log(YELLOW, `  Held by: ${name} (PID ${pid}). Close that process or kill it manually.`);
    }
    if (isWin) {
      log(YELLOW, '  Fix: Run PowerShell as Admin and execute: net stop winnat; net start winnat');
    } else {
      log(YELLOW, `  Fix: lsof -i :${port} -t | xargs kill`);
    }
    return false;
  }

  // Retry-and-wait wrapper: retry checkAndClearPort up to 3 times with 2s
  // sleep between attempts. This replaces the old process.exit(1) on first
  // failure, which killed the entire Glitch process during a restart when the
  // port was still in TIME_WAIT or held by an orphaned service that hadn't
  // fully released yet.
  async function checkAndClearPortWithRetry(port, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const ok = await checkAndClearPort(port);
      if (ok) return true;
      if (attempt < maxRetries) {
        log(YELLOW, `  Retrying port ${port} check (attempt ${attempt + 1}/${maxRetries}) in 2s...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    return false;
  }

  const targetOk = await checkAndClearPortWithRetry(TARGET_PORT);
  if (!targetOk) process.exit(1);

  const authProxyOk = await checkAndClearPortWithRetry(AUTH_PROXY_PORT);
  if (!authProxyOk) process.exit(1);

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
    // Skip-if-alive: if cloudflared.pid points to a live cloudflared.exe,
    // reuse it instead of spawning a duplicate. Two connectors break the
    // tunnel (documented 2026-08-15 failure mode: duplicates tolerated,
    // non-graceful kill breaks the tunnel).
    let existingCfPid = null;
    if (isWin) {
      const cfPidFile = join(ROOT_DIR, 'data', 'cloudflared.pid');
      if (existsSync(cfPidFile)) {
        try {
          const pid = parseInt(readFileSync(cfPidFile, 'utf-8').trim(), 10);
          if (pid > 0 && isProcessAlive(pid) && getProcessName(pid) === 'cloudflared') {
            existingCfPid = pid;
          }
        } catch {}
      }
    }
    if (existingCfPid !== null) {
      log(DARK_GREEN, `  Cloudflare Tunnel: already running (PID ${existingCfPid})`);
      if (cloudflareDomain) {
        log(GREEN, `  Tunnel running: https://${cloudflareDomain} (PID ${existingCfPid})`);
      }
      cloudflareOk = false; // skip the spawn below
    } else {
      log(CYAN, '  Starting Cloudflare Tunnel...');
      if (isWin) {
        // Visible window so the user can see/close the tunnel process.
        const cfInnerCommand = `& '${CLOUDFLARED_BIN.replace(/'/g, "''")}' tunnel --config '${CLOUDFLARED_CONFIG.replace(/'/g, "''")}' run`;
        const cfPid = await startVisibleWindow({
          ROOT_DIR,
          title: 'Glitch: cloudflare-tunnel',
          ps1FileName: 'cloudflared-window.ps1',
          pidFileName: 'cloudflared.pid',
          cwd: ROOT_DIR,
          innerCommand: cfInnerCommand,
          serviceExe: CLOUDFLARED_BIN,
          serviceArgs: ['tunnel', '--config', CLOUDFLARED_CONFIG, 'run'],
        });
        await new Promise(r => setTimeout(r, 2000));
        if (cloudflareDomain) {
          log(GREEN, `  Tunnel running: https://${cloudflareDomain} (PID ${cfPid || 'unknown'})`);
        }
      } else {
        // Unix: detached hidden spawn fallback
        const cfProc = spawn(CLOUDFLARED_BIN, ['tunnel', '--config', CLOUDFLARED_CONFIG, 'run'], {
          stdio: 'ignore',
          windowsHide: true,
          detached: true,
        });
        cfProc.on('error', () => { cloudflareOk = false; });
        cfProc.unref();
        trackProcess(cfProc);
        try { writeFileSync(join(ROOT_DIR, 'data', 'cloudflared.pid'), String(cfProc.pid), 'utf-8'); } catch {}
        await new Promise(r => setTimeout(r, 2000));
        if (cloudflareDomain) {
          log(GREEN, `  Tunnel running: https://${cloudflareDomain} (PID ${cfProc.pid})`);
        }
      }
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
    if (isWin) {
      // Visible window so the user can see/close the auth proxy process.
      const apInnerCommand = `node '${AUTH_PROXY.replace(/'/g, "''")}' ${AUTH_PROXY_PORT} http://localhost:${TARGET_PORT}`;
      const apPid = await startVisibleWindow({
        ROOT_DIR,
        title: `Glitch: auth-proxy (port ${AUTH_PROXY_PORT})`,
        ps1FileName: 'auth-proxy-window.ps1',
        pidFileName: 'auth-proxy.pid',
        cwd: ROOT_DIR,
        innerCommand: apInnerCommand,
        serviceExe: 'node',
        serviceArgs: [AUTH_PROXY, String(AUTH_PROXY_PORT), `http://localhost:${TARGET_PORT}`],
      });
      await new Promise(r => setTimeout(r, 1000));
      log(DARK_GREEN, `  Auth proxy listening (PID ${apPid || 'unknown'})`);
    } else {
      // Unix: detached hidden spawn fallback
      const authProxyProc = spawn('node', [AUTH_PROXY, String(AUTH_PROXY_PORT), `http://localhost:${TARGET_PORT}`], {
        stdio: 'ignore',
        windowsHide: true,
        detached: true,
      });
      authProxyProc.on('error', (err) => {
        log(YELLOW, `  Auth proxy failed to start: ${err.message}`);
      });
      authProxyProc.unref();
      trackProcess(authProxyProc);
      try { writeFileSync(join(ROOT_DIR, 'data', 'auth-proxy.pid'), String(authProxyProc.pid), 'utf-8'); } catch {}
      await new Promise(r => setTimeout(r, 1000));
      log(DARK_GREEN, `  Auth proxy listening (PID ${authProxyProc.pid})`);
    }
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
