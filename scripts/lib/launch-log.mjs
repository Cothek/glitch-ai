// scripts/lib/launch-log.mjs
// Shared launch-log capture for Glitch launch scripts.
//
// Installs a tee wrapper on process.stdout.write / process.stderr.write so
// every line the script prints to the terminal is ALSO appended to
// data/launch.log (ANSI-stripped, ISO-timestamped). Child processes spawned
// with stdio: 'inherit' (opencode TUI, bootstrap.ps1, npm install, etc.)
// write directly to the terminal fd and are NOT captured -- by design.
//
// Truncation of the log on fresh launch stays in the .bat/.sh wrappers
// (they already do `>` redirection). This module only appends.

import { appendFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// scripts/lib/launch-log.mjs -> scripts/lib -> scripts -> <repo root>
const ROOT_DIR = resolve(__dirname, '..', '..');

const LOG_FILE = resolve(ROOT_DIR, 'data', 'launch.log');

// ---- ANSI strip ----
// Covers SGR color codes (\x1b[31m, \x1b[0m, \x1b[32;2m, etc.), OSC sequences
// (terminal title sets, hyperlinks), and other CSI patterns used in this repo.
const ANSI_SGR = /\x1b\[[0-9;]*m/g;
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const ANSI_CSI_OTHER = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(str) {
  if (typeof str !== 'string' || str.length === 0) return '';
  return str
    .replace(ANSI_OSC, '')
    .replace(ANSI_CSI_OTHER, '')
    .replace(ANSI_SGR, '');
}

// ---- Internal state ----
let initialized = false;
let stdoutBuffer = '';
let stderrBuffer = '';
let originalStdoutWrite = null;
let originalStderrWrite = null;

function nowIso() {
  return new Date().toISOString();
}

function appendLine(line) {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, `[${nowIso()}] ${line}\n`, 'utf-8');
  } catch {
    // Never break the launch because the log file is unwritable.
  }
}

function processChunk(buffer, chunk) {
  // Normalize line endings: \r\n and \r -> \n
  const text = (buffer + chunk).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = text.split('\n');
  // Last element is either '' (clean break) or a partial line (no trailing \n).
  const remainder = parts.pop();
  for (const line of parts) {
    appendLine(stripAnsi(line));
  }
  return remainder ?? '';
}

function makeTee(originalWrite, getBuffer) {
  return function teeWrite(chunk, encoding, callback) {
    // Capture for the log (best-effort; never throw out of here).
    try {
      const text =
        typeof chunk === 'string'
          ? chunk
          : (chunk && typeof chunk.toString === 'function')
            ? chunk.toString(typeof encoding === 'string' ? encoding : 'utf-8')
            : '';
      if (text.length > 0) {
        getBuffer().partial = processChunk(getBuffer().partial, text);
      }
    } catch {
      // Swallow -- logging must never break the launch.
    }

    // Forward to the original write, preserving stream semantics.
    // Node's stream.write accepts (chunk, encoding, callback) OR (chunk, callback).
    if (typeof encoding === 'function') {
      return originalWrite.call(this, chunk, encoding);
    }
    return originalWrite.call(this, chunk, encoding, callback);
  };
}

function flushRemainder() {
  if (stdoutBuffer.partial.length > 0) {
    appendLine(stripAnsi(stdoutBuffer.partial));
    stdoutBuffer.partial = '';
  }
  if (stderrBuffer.partial.length > 0) {
    appendLine(stripAnsi(stderrBuffer.partial));
    stderrBuffer.partial = '';
  }
}

// ---- Public API ----

/**
 * Install tee wrappers on process.stdout.write / process.stderr.write so every
 * line printed to the terminal is also appended to data/launch.log.
 *
 * Idempotent: calling more than once is a no-op (the second call returns
 * without re-wrapping). Safe to call from any launch script before its first
 * log() call.
 */
export function initLaunchLog() {
  if (initialized) return;

  // Ensure the data/ directory exists so the first appendFileSync succeeds.
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
  } catch {
    // If we can't even mkdir, the appendFileSync below will also fail and
    // its own try/catch will swallow it -- the launch still works.
  }

  originalStdoutWrite = process.stdout.write.bind(process.stdout);
  originalStderrWrite = process.stderr.write.bind(process.stderr);

  const stdoutState = { partial: '' };
  const stderrState = { partial: '' };
  stdoutBuffer = stdoutState;
  stderrBuffer = stderrState;

  process.stdout.write = makeTee(originalStdoutWrite, () => stdoutState);
  process.stderr.write = makeTee(originalStderrWrite, () => stderrState);

  // Flush any partial line on exit so prompts / partial writes aren't lost.
  // Use beforeExit (async-friendly) AND exit (sync drain) for safety.
  process.on('beforeExit', flushRemainder);
  process.on('exit', flushRemainder);

  initialized = true;
}

/**
 * Append a structured event line directly to data/launch.log with an ISO
 * timestamp prefix. Use for events that also print to the terminal (so the
 * log captures them even if the tee wrapper is bypassed, e.g. by a child
 * process inheriting stdio).
 */
export function logToFile(msg) {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, `[${nowIso()}] ${msg}\n`, 'utf-8');
  } catch {
    // Silently fail if log file can't be written.
  }
}

/** Returns the resolved absolute path to data/launch.log. */
export function getLogFile() {
  return LOG_FILE;
}
