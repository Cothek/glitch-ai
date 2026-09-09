/**
 * Glitch Trader add-on — launches trading engine, API (port 4120), and web (port 3000).
 * Extracted from server-mode.mjs. Gated by GLITCH_ENABLE_TRADER env var.
 *
 * PID files are written to the PROJECT's data dir (traderDir/data/), not
 * glitch-ai's data dir, so each project owns its own process state.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import net from 'net';
import { startVisibleWindow } from '../lib/server-mode.mjs';

const GLITCH_TRADER_API_PORT = 4120;
const GLITCH_TRADER_WEB_PORT = 3000;

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

async function waitForPort(port, maxWaitMs = 5000, intervalMs = 500) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (!(await checkPort(port))) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function trackProcess(proc) {
  return proc;
}

export async function startGlitchTrader(ROOT_DIR) {
  const isWin = process.platform === 'win32';
  const traderDir = process.env.GLITCH_TRADER_DIR || join(ROOT_DIR, '..', 'code', 'glitch-trader');
  const dataDir = join(traderDir, 'data');
  const pythonExe = join(traderDir, 'engine', '.venv', 'Scripts', 'python.exe');
  const engineMain = join(traderDir, 'engine', 'main.py');

  if (!existsSync(pythonExe) || !existsSync(engineMain)) {
    log(DARK_YELLOW, `  Glitch Trader: not found at ${traderDir} — skipping`);
    return;
  }

  // --- Engine (no fixed port) ---
  const enginePidFile = join(dataDir, 'glitch-trader-engine.pid');

  // Skip engine if already running (check PID file liveness)
  let engineAlreadyRunning = false;
  try {
    if (existsSync(enginePidFile)) {
      const storedPid = parseInt(readFileSync(enginePidFile, 'utf-8').trim(), 10);
      if (storedPid > 0 && isProcessAlive(storedPid)) {
        engineAlreadyRunning = true;
        log(DARK_GREEN, `  Glitch Trader engine: already running (PID ${storedPid}) — reusing`);
      }
    }
  } catch {}

  if (!engineAlreadyRunning) {
  try {
    if (isWin) {
      const realPid = await startVisibleWindow({
        ROOT_DIR,
        title: 'Glitch Trader: engine',
        ps1FileName: 'glitch-trader-engine-window.ps1',
        pidFileName: 'glitch-trader-engine.pid',
        cwd: traderDir,
        serviceExe: pythonExe,
        serviceArgs: [engineMain],
      });
      if (realPid && isProcessAlive(realPid)) {
        log(DARK_GREEN, `  Glitch Trader engine: started (PID ${realPid})`);
      } else {
        log(YELLOW, `  Glitch Trader engine: failed to start (process exited immediately)`);
      }
    } else {
      if (!existsSync(dataDir)) { mkdirSync(dataDir, { recursive: true }); }
      const proc = spawn(pythonExe, [engineMain], {
        cwd: traderDir,
        stdio: 'ignore',
        windowsHide: true,
        detached: true,
      });
      proc.on('error', (err) => { log(YELLOW, `  Glitch Trader engine failed to start: ${err.message}`); });
      proc.unref();
      trackProcess(proc);
      try { writeFileSync(enginePidFile, String(proc.pid), 'utf-8'); } catch {}
      await new Promise(r => setTimeout(r, 500));
      if (isProcessAlive(proc.pid)) {
        log(DARK_GREEN, `  Glitch Trader engine: started (PID ${proc.pid})`);
      } else {
        log(YELLOW, `  Glitch Trader engine: failed to start (process exited immediately)`);
      }
    }
  } catch (e) {
    log(YELLOW, `  Glitch Trader engine start failed: ${e.message}`);
  }
  } // end if (!engineAlreadyRunning)

  // --- API (port 4120) ---
  const apiPortFree = await checkPort(GLITCH_TRADER_API_PORT);
  if (!apiPortFree) {
    log(DARK_GREEN, `  Glitch Trader API: already running on port ${GLITCH_TRADER_API_PORT}`);
  } else {
    try {
      if (isWin) {
        const realPid = await startVisibleWindow({
          ROOT_DIR,
          title: `Glitch Trader: API (port ${GLITCH_TRADER_API_PORT})`,
          ps1FileName: 'glitch-trader-api-window.ps1',
          pidFileName: 'glitch-trader-api.pid',
          cwd: traderDir,
          serviceExe: pythonExe,
          serviceArgs: ['-m', 'uvicorn', 'engine.api.__main__:app', '--port', String(GLITCH_TRADER_API_PORT)],
        });
        if (await waitForPort(GLITCH_TRADER_API_PORT)) {
          log(DARK_GREEN, `  Glitch Trader API: listening on port ${GLITCH_TRADER_API_PORT} (PID ${realPid || 'unknown'})`);
        } else {
          log(YELLOW, `  Glitch Trader API: failed to bind port ${GLITCH_TRADER_API_PORT} (process may have exited)`);
        }
      } else {
        if (!existsSync(dataDir)) { mkdirSync(dataDir, { recursive: true }); }
        const proc = spawn(pythonExe, ['-m', 'uvicorn', 'engine.api.__main__:app', '--port', String(GLITCH_TRADER_API_PORT)], {
          cwd: traderDir,
          stdio: 'ignore',
          windowsHide: true,
          detached: true,
        });
        proc.on('error', (err) => { log(YELLOW, `  Glitch Trader API failed to start: ${err.message}`); });
        proc.unref();
        trackProcess(proc);
        try { writeFileSync(join(dataDir, 'glitch-trader-api.pid'), String(proc.pid), 'utf-8'); } catch {}
        if (await waitForPort(GLITCH_TRADER_API_PORT)) {
          log(DARK_GREEN, `  Glitch Trader API: listening on port ${GLITCH_TRADER_API_PORT} (PID ${proc.pid})`);
        } else {
          log(YELLOW, `  Glitch Trader API: failed to bind port ${GLITCH_TRADER_API_PORT} (process may have exited)`);
        }
      }
    } catch (e) {
      log(YELLOW, `  Glitch Trader API start failed: ${e.message}`);
    }
  }

  // --- Web app (port 3000) ---
  const webPortFree = await checkPort(GLITCH_TRADER_WEB_PORT);
  if (!webPortFree) {
    log(DARK_GREEN, `  Glitch Trader web: already running on port ${GLITCH_TRADER_WEB_PORT}`);
  } else {
    const webDir = join(traderDir, 'web');
    if (!existsSync(webDir)) {
      log(DARK_YELLOW, `  Glitch Trader web: ${webDir} not found — skipping`);
    } else {
      try {
        const npmCmd = isWin ? 'npm.cmd' : 'npm';
        if (isWin) {
          const realPid = await startVisibleWindow({
            ROOT_DIR,
            title: `Glitch Trader: web app (port ${GLITCH_TRADER_WEB_PORT})`,
            ps1FileName: 'glitch-trader-web-window.ps1',
            pidFileName: 'glitch-trader-web.pid',
            cwd: webDir,
            serviceExe: npmCmd,
            serviceArgs: ['run', 'dev'],
          });
          if (await waitForPort(GLITCH_TRADER_WEB_PORT)) {
            log(DARK_GREEN, `  Glitch Trader web: listening on port ${GLITCH_TRADER_WEB_PORT} (PID ${realPid || 'unknown'})`);
          } else {
            log(YELLOW, `  Glitch Trader web: failed to bind port ${GLITCH_TRADER_WEB_PORT} (process may have exited)`);
          }
        } else {
          if (!existsSync(dataDir)) { mkdirSync(dataDir, { recursive: true }); }
          const proc = spawn(npmCmd, ['run', 'dev'], {
            cwd: webDir,
            stdio: 'ignore',
            windowsHide: true,
            detached: true,
          });
          proc.on('error', (err) => { log(YELLOW, `  Glitch Trader web failed to start: ${err.message}`); });
          proc.unref();
          trackProcess(proc);
          try { writeFileSync(join(dataDir, 'glitch-trader-web.pid'), String(proc.pid), 'utf-8'); } catch {}
          if (await waitForPort(GLITCH_TRADER_WEB_PORT)) {
            log(DARK_GREEN, `  Glitch Trader web: listening on port ${GLITCH_TRADER_WEB_PORT} (PID ${proc.pid})`);
          } else {
            log(YELLOW, `  Glitch Trader web: failed to bind port ${GLITCH_TRADER_WEB_PORT} (process may have exited)`);
          }
        }
      } catch (e) {
        log(YELLOW, `  Glitch Trader web start failed: ${e.message}`);
      }
    }
  }
}
