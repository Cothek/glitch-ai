#!/usr/bin/env node

/**
 * Plugin Manager — Glitch plugin engine
 * Reads plugin manifests from plugins/<name>/manifest.json
 * Manages enabled/disabled state in user/plugins.json (user layer, synced cross-machine)
 * Starts/stops plugin processes with PID tracking
 *
 * Optional manifest field:
 *   visible_window (boolean) — When true AND platform is win32, the plugin runs in its
 *     own visible console window so the user can see output and close it directly.
 *     A PowerShell launcher script is generated at data/plugin-<name>-window.ps1 and
 *     the real server PID is written to data/plugin-<name>.pid for stop/cleanup.
 *     Non-Windows platforms fall back to the standard hidden background spawn.
 *
 * Merge semantics (additive only — respects user intent):
 *   - System defaults are declared per-plugin via manifest.json `default_enabled: true`
 *   - On launch, ensureDefaultRegistry() reads all default-enabled plugins and adds
 *     any missing entries to user/plugins.json with { enabled: true }
 *   - Existing user entries (including enabled: false) are NEVER overwritten or removed
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawn, execFileSync } from 'child_process';
import net from 'node:net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..', '..');
const PLUGIN_REGISTRY_PATH = join(ROOT_DIR, 'user', 'plugins.json');
const PLUGINS_DIR = join(ROOT_DIR, 'plugins');
const VISIBLE_WINDOW_PID_RETRY_MS = 2000;

// Active plugin processes: Map<name, ChildProcess>
const activePlugins = new Map();

/**
 * Cross-platform process-existence check via signal 0.
 * Returns true if the pid is alive, or if we lack permission to signal it
 * (EPERM — process exists but belongs to another user).
 */
function isProcessAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

/**
 * Read data/plugin-<name>.pid and return the parsed pid if > 0, else null.
 * Missing file or unparseable content → null.
 */
function getExistingPid(pluginName) {
  const pidFilePath = join(ROOT_DIR, 'data', `plugin-${pluginName}.pid`);
  try {
    const content = readFileSync(pidFilePath, 'utf-8').trim();
    const parsed = parseInt(content, 10);
    return parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Async TCP connect check to 127.0.0.1:<port> with a ~500ms timeout.
 * Resolves true if the connection succeeds (port is accepting connections),
 * false on any connect error or timeout. Any error means the port is not
 * accepting connections — kept simple per spec.
 */
function isPortInUse(port) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    const socket = net.connect({ port, host: '127.0.0.1' });
    const timer = setTimeout(() => {
      socket.destroy();
      done(false);
    }, 500);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      done(true);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      done(false);
    });
  });
}

function readJson(path) {
  try {
    const raw = readFileSync(path, 'utf-8');
    const cleaned = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function writeJson(path, data) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function readRegistry() {
  return readJson(PLUGIN_REGISTRY_PATH) || {};
}

function writeRegistry(reg) {
  writeJson(PLUGIN_REGISTRY_PATH, reg);
}

function readManifest(pluginName) {
  return readJson(join(PLUGINS_DIR, pluginName, 'manifest.json'));
}

/**
 * Check if a plugin is enabled in the registry.
 */
export function isEnabled(pluginName) {
  const reg = readRegistry();
  return reg[pluginName]?.enabled === true;
}

/**
 * Set a plugin's enabled/disabled state in the registry.
 */
export function setEnabled(pluginName, enabled) {
  const reg = readRegistry();
  reg[pluginName] = reg[pluginName] || {};
  reg[pluginName].enabled = enabled;
  writeRegistry(reg);
}

/**
 * Toggle a plugin's enabled state. Returns the new state.
 */
export function togglePlugin(pluginName) {
  const currently = isEnabled(pluginName);
  setEnabled(pluginName, !currently);
  return !currently;
}

/**
 * List all discovered plugins (from manifest files) with their state.
 */
export function listPlugins() {
  if (!existsSync(PLUGINS_DIR)) return [];
  const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true });
  const plugins = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = readManifest(entry.name);
    if (manifest) {
      plugins.push({
        name: entry.name,
        description: manifest.description || '',
        version: manifest.version || '0.0.0',
        port: manifest.port || null,
        dependencies: manifest.dependencies || [],
        enabled: isEnabled(entry.name),
        running: activePlugins.has(entry.name),
      });
    }
  }
  return plugins;
}

/**
 * Start a plugin's server process. Only starts if enabled in registry.
 * Returns { success, pid?, error? }.
 */
export async function startPlugin(pluginName) {
  if (!isEnabled(pluginName)) {
    return { success: false, error: `Plugin "${pluginName}" is disabled` };
  }
  if (activePlugins.has(pluginName)) {
    return { success: true, message: `Plugin "${pluginName}" already running` };
  }

  // OS-level idempotency: if a pid file points at a live process, the plugin
  // is already running (possibly started by a prior launch/server-mode call).
  // This guards against the double-start that happens when launch.mjs and
  // server-mode.mjs both call startEnabledPlugins() in web mode.
  const existingPid = getExistingPid(pluginName);
  if (existingPid && isProcessAlive(existingPid)) {
    return { success: true, alreadyRunning: true, pid: existingPid };
  }

  const manifest = readManifest(pluginName);
  if (!manifest) {
    return { success: false, error: `No manifest.json found for plugin "${pluginName}" at plugins/${pluginName}/` };
  }
  if (!manifest.start_command) {
    return { success: false, error: `Plugin "${pluginName}" manifest has no start_command` };
  }

  // Port-level idempotency: if the pid file is missing/stale but a previous
  // instance is already listening on the port, treat it as already running.
  // Catches the case where the pid file points at a dead launcher while the
  // real server holds the port.
  if (manifest.port) {
    const portBusy = await isPortInUse(manifest.port);
    if (portBusy) {
      return { success: true, alreadyRunning: true, port: manifest.port };
    }
  }

  if (manifest.visible_window === true) {
    if (process.platform === 'win32') {
      return startPluginVisible(pluginName, manifest);
    }
    console.warn(`[plugin-manager] visible_window is Windows-only for now; starting "${pluginName}" as hidden background process`);
  }

  try {
    const parts = manifest.start_command.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);

    const proc = spawn(cmd, args, {
      cwd: ROOT_DIR,
      stdio: 'ignore',
      windowsHide: true,
      detached: true,
    });
    proc.unref();
    activePlugins.set(pluginName, proc);
    return { success: true, pid: proc.pid };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Start a plugin in its own visible console window (Windows only).
 * Generates a PS1 launcher that opens a normal PowerShell window running the
 * plugin's start_command in foreground. The real server PID is written to
 * data/plugin-<name>.pid so stopPlugin can kill it by PID.
 */
async function startPluginVisible(pluginName, manifest) {
  const dataDir = join(ROOT_DIR, 'data');
  mkdirSync(dataDir, { recursive: true });

  const parts = manifest.start_command.split(' ');
  const cmd = parts[0];
  const args = parts.slice(1);
  const cmdStr = args.length > 0 ? `& ${cmd} ${args.join(' ')}` : `& ${cmd}`;

  const portTag = manifest.port ? ` (port ${manifest.port})` : '';
  const title = `Glitch: ${pluginName}${portTag}`;

  const ps1Path = join(dataDir, `plugin-${pluginName}-window.ps1`);
  const pidFilePath = join(dataDir, `plugin-${pluginName}.pid`);

  const esc = (s) => s.replace(/'/g, "''");

  const innerCommand = `& { $host.ui.RawUI.WindowTitle = '${esc(title)}'; Set-Location -LiteralPath '${esc(ROOT_DIR)}'; ${cmdStr} }`;
  const ps1Inner = esc(innerCommand);
  const ps1PidPath = esc(pidFilePath);

  const ps1Content =
    `$proc = Start-Process powershell.exe -WindowStyle Normal -PassThru -ArgumentList @('-NoExit','-ExecutionPolicy','Bypass','-Command', '${ps1Inner}')\r\n` +
    `if ($proc) { $proc.Id | Out-File -FilePath '${ps1PidPath}' -Encoding ascii }\r\n`;

  try {
    writeFileSync(ps1Path, ps1Content, 'utf-8');

    const launcher = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Path], {
      cwd: ROOT_DIR,
      stdio: 'ignore',
      windowsHide: true,
      detached: false,
    });
    launcher.unref();
    launcher._visibleWindow = true;
    activePlugins.set(pluginName, launcher);

    let launcherFailed = false;
    launcher.on('exit', () => { launcherFailed = true; });

    let realPid = null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < VISIBLE_WINDOW_PID_RETRY_MS) {
      await new Promise(r => setTimeout(r, 100));
      if (existsSync(pidFilePath)) {
        try {
          const content = readFileSync(pidFilePath, 'utf-8').trim();
          const parsed = parseInt(content, 10);
          if (parsed > 0) { realPid = parsed; break; }
        } catch {}
      }
      if (launcherFailed && !existsSync(pidFilePath)) break;
    }

    if (!realPid && launcherFailed) {
      try { unlinkSync(ps1Path); } catch {}
      try { unlinkSync(pidFilePath); } catch {}
      activePlugins.delete(pluginName);
      return { success: false, error: `Launcher exited before creating the visible window for "${pluginName}"` };
    }

    return { success: true, pid: realPid || launcher.pid };
  } catch (err) {
    try { unlinkSync(ps1Path); } catch {}
    try { unlinkSync(pidFilePath); } catch {}
    return { success: false, error: err.message };
  }
}

/**
 * Stop a plugin's server process by name.
 */
export function stopPlugin(pluginName) {
  const dataDir = join(ROOT_DIR, 'data');
  const pidFilePath = join(dataDir, `plugin-${pluginName}.pid`);
  const ps1Path = join(dataDir, `plugin-${pluginName}-window.ps1`);

  if (existsSync(pidFilePath)) {
    const pid = parseInt(readFileSync(pidFilePath, 'utf-8').trim(), 10);
    if (pid > 0) {
      let taskkillOk = false;
      let taskkillMsg = '';
      try {
        execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'pipe' });
        taskkillOk = true;
      } catch (err) {
        const msg = (err && err.message) || '';
        const status = err && err.status;
        if (status === 128 || /not found/i.test(msg) || /No tasks running/i.test(msg)) {
          taskkillOk = true;
        } else {
          taskkillMsg = msg || String(err);
        }
      }
      if (!taskkillOk) {
        return { success: false, error: `Failed to stop "${pluginName}": ${taskkillMsg}` };
      }
    }
    try { unlinkSync(pidFilePath); } catch {}
    try { unlinkSync(ps1Path); } catch {}
    activePlugins.delete(pluginName);
    return { success: true };
  }

  const proc = activePlugins.get(pluginName);
  if (!proc) {
    return { success: false, error: `Plugin "${pluginName}" is not running` };
  }
  try {
    if (!proc.killed) proc.kill();
  } catch {}
  activePlugins.delete(pluginName);
  return { success: true };
}

/**
 * Collect all system-default plugins (manifest declares `default_enabled: true`).
 * Returns array of plugin names.
 */
function collectDefaultEnabledPlugins() {
  const names = [];
  if (!existsSync(PLUGINS_DIR)) return names;
  const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = readManifest(entry.name);
    if (manifest && manifest.default_enabled === true) {
      names.push(entry.name);
    }
  }
  return names;
}

/**
 * Ensure user/plugins.json exists and contains every system-default plugin.
 * Additive merge — respects user intent:
 *   - If user/plugins.json does NOT exist: create it with all default-enabled
 *     plugins set to { enabled: true }. Returns { created: true, added: [...names] }.
 *   - If it DOES exist: for each system-default plugin NOT already a key in the
 *     user registry, add { enabled: true }. Existing entries (including
 *     enabled: false) are NEVER overwritten or removed. Returns
 *     { created: false, added: [...names] } where `added` lists newly-added plugins.
 */
export function ensureDefaultRegistry() {
  const defaults = collectDefaultEnabledPlugins();

  if (!existsSync(PLUGIN_REGISTRY_PATH)) {
    const fresh = {};
    for (const name of defaults) {
      fresh[name] = { enabled: true };
    }
    writeRegistry(fresh);
    return { created: true, added: [...defaults] };
  }

  const reg = readRegistry();
  const added = [];
  for (const name of defaults) {
    if (!(name in reg)) {
      reg[name] = { enabled: true };
      added.push(name);
    }
  }
  if (added.length > 0) {
    writeRegistry(reg);
  }
  return { created: false, added };
}

/**
 * Start all enabled plugins. Called at Glitch startup.
 * Returns array of { name, success, pid?, error? }.
 */
export async function startEnabledPlugins() {
  ensureDefaultRegistry();
  const registry = readRegistry();
  const results = [];
  for (const [name, config] of Object.entries(registry)) {
    if (config.enabled) {
      const result = await startPlugin(name);
      results.push({ name, ...result });
    }
  }
  return results;
}

/**
 * Stop all active plugin processes.
 */
export function stopAllPlugins() {
  const results = [];
  for (const [name, proc] of activePlugins) {
    if (proc._visibleWindow) {
      results.push({ name, stopped: false, reason: 'visible-window plugin persists independently' });
      continue;
    }
    const dataDir = join(ROOT_DIR, 'data');
    const pidFilePath = join(dataDir, `plugin-${name}.pid`);
    const ps1Path = join(dataDir, `plugin-${name}-window.ps1`);

    if (existsSync(pidFilePath)) {
      const pid = parseInt(readFileSync(pidFilePath, 'utf-8').trim(), 10);
      let taskkillOk = true;
      let taskkillMsg = '';
      if (pid > 0) {
        try {
          execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'pipe' });
        } catch (err) {
          const msg = (err && err.message) || '';
          const status = err && err.status;
          if (status === 128 || /not found/i.test(msg) || /No tasks running/i.test(msg)) {
            taskkillOk = true;
          } else {
            taskkillOk = false;
            taskkillMsg = msg || String(err);
          }
        }
      }
      if (taskkillOk) {
        try { unlinkSync(pidFilePath); } catch {}
        try { unlinkSync(ps1Path); } catch {}
        results.push({ name, stopped: true });
      } else {
        results.push({ name, stopped: false, error: `Failed to stop "${name}": ${taskkillMsg}` });
      }
    } else {
      try {
        if (!proc.killed) proc.kill();
      } catch {}
      results.push({ name, stopped: true });
    }
  }
  activePlugins.clear();
  return results;
}

// Cleanup all plugins on exit
process.on('exit', stopAllPlugins);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));
