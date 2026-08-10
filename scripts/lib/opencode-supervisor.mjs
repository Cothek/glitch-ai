/**
 * OpenCode supervisor — shared helpers for PID file management and TUI supervision.
 * Used by launch scripts (TUI mode) and server-mode.mjs (web mode).
 */

import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Write the OpenCode PID file. Idempotent. Returns the absolute path.
 * Swallows errors (PID file is a soft contract).
 */
export function writeOpenCodePid(rootDir, pid) {
  const pidPath = join(rootDir, 'data', 'opencode.pid');
  try {
    writeFileSync(pidPath, String(pid), 'utf-8');
    return pidPath;
  } catch (e) {
    console.error(`[supervisor] Failed to write PID file: ${e.message}`);
    return pidPath;
  }
}

/**
 * Best-effort removal of the PID file. Swallows ENOENT.
 */
export function clearOpenCodePid(rootDir) {
  const pidPath = join(rootDir, 'data', 'opencode.pid');
  try {
    unlinkSync(pidPath);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(`[supervisor] Failed to clear PID file: ${e.message}`);
    }
  }
}

/**
 * Supervise an OpenCode TUI process. Writes PID file on spawn, clears on exit.
 * Returns a Promise that resolves with { code, signal } when the child exits.
 *
 * @param {Object} opts
 * @param {string} opts.bin - Path to the opencode binary
 * @param {string[]} [opts.args=[]] - Arguments to pass
 * @param {string} opts.rootDir - Root directory for PID file
 * @param {Object} [opts.env] - Environment variables (defaults to process.env)
 * @returns {Promise<{code: number, signal: string|null}>}
 */
export function superviseOpenCodeTUI({ bin, args = [], rootDir, env = process.env }) {
  return new Promise((resolve, reject) => {
    clearOpenCodePid(rootDir);

    const child = spawn(bin, args, {
      stdio: 'inherit',
      env,
    });

    if (child.pid) {
      writeOpenCodePid(rootDir, child.pid);
    }

    child.on('error', (err) => {
      clearOpenCodePid(rootDir);
      reject(err);
    });

    child.on('exit', (code, signal) => {
      clearOpenCodePid(rootDir);
      resolve({ code: code ?? 0, signal });
    });
  });
}
