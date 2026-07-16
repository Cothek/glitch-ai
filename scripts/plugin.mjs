#!/usr/bin/env node

/**
 * Glitch Plugin CLI
 * Usage: node scripts/plugin.mjs <command> [name]
 *
 * Commands:
 *   list              List all plugins with status
 *   status [name]     Show status of a specific plugin or all
 *   enable <name>     Enable a plugin (will start on next launch)
 *   disable <name>    Disable a plugin
 *   toggle <name>     Toggle a plugin on/off
 *   start <name>      Start a plugin's server immediately
 *   stop <name>       Stop a plugin's server immediately
 */

import { listPlugins, isEnabled, setEnabled, togglePlugin, startPlugin, stopPlugin, startEnabledPlugins, stopAllPlugins } from './lib/plugin-manager.mjs';

const cmd = process.argv[2];
const name = process.argv[3];

const MAGENTA = '\x1b[35m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DARK_GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

function log(color, msg) {
  console.log(`${color}${msg}${RESET}`);
}

async function main() {
  switch (cmd) {
    case 'list':
    case 'ls': {
      const plugins = listPlugins();
      if (plugins.length === 0) {
        log(YELLOW, 'No plugins found.');
        return;
      }
      log(MAGENTA, `Plugins (${plugins.length}):`);
      console.log('');
      for (const p of plugins) {
        const icon = p.enabled ? (p.running ? '✓' : '◌') : '○';
        const status = p.running ? GREEN : p.enabled ? YELLOW : DARK_GRAY;
        log(status, `  ${icon} ${p.name} v${p.version}`);
        log(DARK_GRAY, `     ${p.description}`);
        if (p.port) log(DARK_GRAY, `     Port: ${p.port}`);
        log(DARK_GRAY, `     ${p.enabled ? 'Enabled' : 'Disabled'}${p.running ? ' · Running' : ''}`);
        console.log('');
      }
      break;
    }

    case 'status': {
      if (name) {
        const plugins = listPlugins();
        const p = plugins.find(x => x.name === name);
        if (!p) { log(RED, `Plugin "${name}" not found.`); return; }
        log(CYAN, `${p.name}:`);
        log(DARK_GRAY, `  Description: ${p.description}`);
        log(DARK_GRAY, `  Version: ${p.version}`);
        log(DARK_GRAY, `  Port: ${p.port || 'N/A'}`);
        log(DARK_GRAY, `  State: ${p.enabled ? 'Enabled' : 'Disabled'}${p.running ? ' (running)' : ''}`);
      } else {
        const plugins = listPlugins();
        if (plugins.length === 0) { log(YELLOW, 'No plugins found.'); return; }
        for (const p of plugins) {
          console.log(`${p.enabled ? 'ENABLED ' : 'DISABLED'} ${p.name} — port ${p.port || 'N/A'}${p.running ? ' (running)' : ''}`);
        }
      }
      break;
    }

    case 'enable':
      if (!name) { log(RED, 'Usage: node scripts/plugin.mjs enable <name>'); return; }
      setEnabled(name, true);
      log(GREEN, `Plugin "${name}" enabled. It will start on next Glitch launch.`);
      log(DARK_GRAY, '  To start now: node scripts/plugin.mjs start ' + name);
      break;

    case 'disable':
      if (!name) { log(RED, 'Usage: node scripts/plugin.mjs disable <name>'); return; }
      await stopPlugin(name);
      setEnabled(name, false);
      log(GREEN, `Plugin "${name}" disabled and stopped.`);
      break;

    case 'toggle':
      if (!name) { log(RED, 'Usage: node scripts/plugin.mjs toggle <name>'); return; }
      const nowEnabled = togglePlugin(name);
      if (nowEnabled) {
        const result = await startPlugin(name);
        if (result.success) {
          log(GREEN, `Plugin "${name}" enabled and started (PID ${result.pid}).`);
        } else {
          log(GREEN, `Plugin "${name}" enabled (start on next launch).`);
        }
      } else {
        await stopPlugin(name);
        log(GREEN, `Plugin "${name}" disabled and stopped.`);
      }
      break;

    case 'start':
      if (!name) { log(RED, 'Usage: node scripts/plugin.mjs start <name>'); return; }
      if (!isEnabled(name)) {
        log(YELLOW, `Plugin "${name}" is disabled. Enable it first: node scripts/plugin.mjs enable ${name}`);
        return;
      }
      const startResult = await startPlugin(name);
      if (startResult.success) {
        log(GREEN, `Plugin "${name}" started (PID ${startResult.pid}).`);
      } else {
        log(RED, `Failed: ${startResult.error}`);
      }
      break;

    case 'stop':
      if (!name) { log(RED, 'Usage: node scripts/plugin.mjs stop <name>'); return; }
      const stopResult = stopPlugin(name);
      if (stopResult.success) {
        log(GREEN, `Plugin "${name}" stopped.`);
      } else {
        log(RED, `Failed: ${stopResult.error}`);
      }
      break;

    default:
      log(CYAN, 'Glitch Plugin Manager');
      console.log('');
      console.log('  node scripts/plugin.mjs list              List all plugins');
      console.log('  node scripts/plugin.mjs status [name]     Show plugin status');
      console.log('  node scripts/plugin.mjs enable <name>     Enable a plugin');
      console.log('  node scripts/plugin.mjs disable <name>    Disable a plugin');
      console.log('  node scripts/plugin.mjs toggle <name>     Toggle plugin on/off');
      console.log('  node scripts/plugin.mjs start <name>      Start plugin server now');
      console.log('  node scripts/plugin.mjs stop <name>       Stop plugin server');
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
