/**
 * Money dashboard add-on — launches glitch-money dashboard on port 4110.
 * Extracted from server-mode.mjs. Gated by GLITCH_ENABLE_MONEY env var.
 *
 * PID files are written to the PROJECT's data dir (moneyDir/data/), not
 * glitch-ai's data dir, so each project owns its own process state.
 */

import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import net from 'net';
import { startVisibleWindow } from '../lib/server-mode.mjs';

const MONEY_DASHBOARD_PORT = 4110;

const DARK_YELLOW = '\x1b[33;2m';
const DARK_GREEN = '\x1b[32;2m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function log(color, msg) {
  if (msg === undefined) {
    console.log(color);
  } else {
    console.log(`${color}${msg}${RESET}`);
  }
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

function trackProcess(proc) {
  return proc;
}

export async function startMoneyDashboard(ROOT_DIR) {
  const isWin = process.platform === 'win32';
  const moneyDir = process.env.MONEY_DASHBOARD_DIR || join(ROOT_DIR, '..', 'code', 'glitch-money');
  const dataDir = join(moneyDir, 'data');
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
