#!/usr/bin/env node

// scripts/cleanup-screenshots.mjs
// Deletes screenshots older than N days from data/screenshots/.
// Always preserves manifest.json and NEW_IMAGE_FLAG regardless of age.
// Safe to run on every vision dispatch (idempotent, exits 0 in all normal cases).

import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, "..", "data", "screenshots");
const PRESERVED = new Set(["manifest.json", "NEW_IMAGE_FLAG"]);
const DEFAULT_DAYS = 14;

function parseArgs(argv) {
  const args = { days: DEFAULT_DAYS, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--days") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 0) {
        console.error(`[cleanup-screenshots] Invalid --days value: ${argv[i]}`);
        process.exit(1);
      }
      args.days = n;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/cleanup-screenshots.mjs [options]

Options:
  --days N       Retention in days (default: ${DEFAULT_DAYS})
  --dry-run      Print what would be deleted without deleting
  --help, -h     Show this help

Always preserves manifest.json and NEW_IMAGE_FLAG regardless of age.`);
}

function humanSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), u.length - 1);
  const v = bytes / Math.pow(1024, i);
  return `${i === 0 ? v : v.toFixed(1)} ${u[i]}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); process.exit(0); }

  let entries;
  try {
    entries = await readdir(SCREENSHOTS_DIR);
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log(`[cleanup-screenshots] Directory not found: ${SCREENSHOTS_DIR}`);
      console.log("[cleanup-screenshots] Nothing to clean. Exiting.");
      process.exit(0);
    }
    throw err;
  }

  const cutoffMs = Date.now() - args.days * 86400000;
  const deleted = [];
  const kept = [];
  let bytesFreed = 0;

  for (const name of entries) {
    if (PRESERVED.has(name)) { kept.push(name); continue; }
    const fp = path.join(SCREENSHOTS_DIR, name);
    let st;
    try { st = await stat(fp); } catch { continue; }
    if (!st.isFile()) { kept.push(name); continue; }
    if (st.mtimeMs >= cutoffMs) { kept.push(name); continue; }

    if (!args.dryRun) {
      try { await unlink(fp); } catch { continue; }
    }
    deleted.push({ name, size: st.size });
    bytesFreed += st.size;
  }

  const mode = args.dryRun ? "DRY RUN" : "CLEANED";
  console.log(`[cleanup-screenshots] ${mode}: ${deleted.length} file(s) deleted, ${humanSize(bytesFreed)} freed`);
  if (kept.length < 10) {
    console.log(`[cleanup-screenshots] Kept ${kept.length}: ${kept.join(", ") || "(none)"}`);
  } else {
    console.log(`[cleanup-screenshots] Kept ${kept.length} files (manifest.json + NEW_IMAGE_FLAG + recent)`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(`[cleanup-screenshots] Error: ${err.message}`);
  process.exit(1);
});
