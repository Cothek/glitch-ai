// sqlite-driver.mjs — Runtime-adaptive SQLite driver for Glitch plugins.
//
// WHY THIS EXISTS (verified empirically 2026-08-20):
//   opencode's embedded plugin runtime is Bun — the Go binary embeds Bun and
//   loads plugins with it (stack traces show B:/~BUN/root/...; a probe plugin
//   confirmed `typeof Bun === 'object'`, `bun:sqlite` AVAILABLE, and
//   `node:sqlite` UNAVAILABLE with "No such built-in module").
//   System Node (tests, standalone scripts) is the opposite: `node:sqlite`
//   available (Node >= 22.5), `bun:sqlite` unresolvable.
//
//   So a plugin that hard-imports `node:sqlite` degrades inside opencode, and
//   one that hard-imports `bun:sqlite` crashes under system Node. This module
//   picks whichever driver the CURRENT runtime exposes:
//     - bun:sqlite  → Database      (opencode embedded runtime)
//     - node:sqlite → DatabaseSync  (system Node)
//   Both expose the same prepare/get/all/run/close surface the helpers use.
//
// THE ONLY API DIFFERENCE HANDLED HERE:
//   The readonly option name — bun:sqlite uses { readonly }, node:sqlite uses
//   { readOnly }. (agent-watchdog-helpers.mjs previously passed the bun-style
//   name to node:sqlite, which silently ignored it and opened read-write.)

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let DatabaseCtor = null;
let driverName = null;

try {
  // opencode embedded runtime (Bun) — native SQLite module.
  DatabaseCtor = require("bun:sqlite").Database;
  driverName = "bun:sqlite";
} catch {
  try {
    // System Node (tests, standalone scripts) — built-in since 22.5.
    DatabaseCtor = require("node:sqlite").DatabaseSync;
    driverName = "node:sqlite";
  } catch {
    driverName = null;
  }
}

/**
 * Which SQLite driver this runtime exposes: 'bun:sqlite' | 'node:sqlite' | null.
 * null means neither is available — callers must degrade gracefully.
 */
export function getSqliteDriver() {
  return driverName;
}

/**
 * Open a SQLite database. Throws when no driver is available or the open
 * fails — callers wrap in try/catch and degrade (the helpers' established
 * fail-closed pattern). The readonly option name is normalized per driver.
 *
 * @param {string} path - path to the SQLite DB file
 * @param {{ readonly?: boolean }} [opts]
 * @returns {object} driver-specific Database instance
 */
export function openDatabase(path, { readonly = false } = {}) {
  if (!DatabaseCtor) {
    const err = new Error("no SQLite driver available (bun:sqlite / node:sqlite)");
    err.code = "NO_SQLITE_DRIVER";
    throw err;
  }
  const options = driverName === "bun:sqlite" ? { readonly } : { readOnly: readonly };
  return new DatabaseCtor(path, options);
}