#!/usr/bin/env node

/**
 * Plugin Manager — Glitch plugin engine
 * Reads plugin manifests from plugins/<name>/manifest.json
 * Manages enabled/disabled state in data/plugins.json
 * Starts/stops plugin processes with PID tracking
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..', '..');
const PLUGIN_REGISTRY_PATH = join(ROOT_DIR, 'data', 'plugins.json');
const PLUGINS_DIR = join(ROOT_DIR, 'plugins');

// Active plugin processes: Map<name, ChildProcess>
const activePlugins = new Map();

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

  const manifest = readManifest(pluginName);
  if (!manifest) {
    return { success: false, error: `No manifest.json found for plugin "${pluginName}" at plugins/${pluginName}/` };
  }
  if (!manifest.start_command) {
    return { success: false, error: `Plugin "${pluginName}" manifest has no start_command` };
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
 * Stop a plugin's server process by name.
 */
export function stopPlugin(pluginName) {
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
 * Start all enabled plugins. Called at Glitch startup.
 * Returns array of { name, success, pid?, error? }.
 */
export async function startEnabledPlugins() {
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
    try {
      if (!proc.killed) proc.kill();
    } catch {}
    results.push({ name, stopped: true });
  }
  activePlugins.clear();
  return results;
}

// Cleanup all plugins on exit
process.on('exit', stopAllPlugins);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));
