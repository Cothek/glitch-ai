#!/usr/bin/env node

import { readFileSync, existsSync, mkdirSync, copyFileSync, rmSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

// ── CLI Args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let checkOnly = false;
let manifestPath = join(ROOT_DIR, 'config', 'tools.json');
let jsonOutput = false;
let verbose = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--check-only') checkOnly = true;
  else if (arg === '--json') jsonOutput = true;
  else if (arg === '--verbose') verbose = true;
  else if (arg === '--manifest' && i + 1 < args.length) manifestPath = args[++i];
}

function log(msg) {
  if (verbose && !jsonOutput) console.error(msg);
}

function error(msg) {
  if (!jsonOutput) console.error(msg);
}

// ── Manifest ────────────────────────────────────────────────────────────────
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (e) {
  console.error(`Failed to read manifest: ${e.message}`);
  process.exit(1);
}

const tools = manifest.tools || [];
const report = {
  checked: 0,
  installed: [],
  skipped: [],
  failed: [],
  errors: []
};

// ── Helpers ─────────────────────────────────────────────────────────────────
const isWindows = () => process.platform === 'win32';
const npmBin = () => (isWindows() ? 'npm.cmd' : 'npm');

function psQuote(str) {
  return str.replace(/'/g, "''");
}

function runNpm(args, opts = {}) {
  const cmd = npmBin();
  const fullArgs = isWindows() && cmd.endsWith('.cmd')
    ? ['/d', '/s', '/c', cmd, ...args]
    : args;
  const fullCmd = isWindows() && cmd.endsWith('.cmd') ? 'cmd.exe' : cmd;
  return execFileSync(fullCmd, fullArgs, { ...opts, stdio: 'pipe' });
}

function checkNpm(packageName) {
  try {
    runNpm(['list', '-g', '--depth=0', packageName]);
    return true;
  } catch {
    return false;
  }
}

function installNpm(packageName) {
  runNpm(['install', '-g', packageName]);
}

function npmListVersion(packageName) {
  try {
    const out = runNpm(['list', '-g', '--depth=0', packageName], { encoding: 'utf8' });
    return out.trim();
  } catch {
    return null;
  }
}

function downloadFile(url, dest) {
  if (isWindows()) {
    const cmd = `Invoke-WebRequest -Uri '${psQuote(url)}' -OutFile '${psQuote(dest)}'`;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { stdio: 'pipe' });
  } else {
    try {
      execFileSync('curl', ['-fsSL', '-o', dest, url], { stdio: 'pipe' });
    } catch (err) {
      if (err.code === 'ENOENT') {
        execFileSync('wget', ['-O', dest, url], { stdio: 'pipe' });
      } else {
        throw err;
      }
    }
  }
}

function extractArchive(archivePath, extractDir, type) {
  if (isWindows()) {
    if (type === 'zip') {
      const cmd = `Expand-Archive -Path '${psQuote(archivePath)}' -DestinationPath '${psQuote(extractDir)}' -Force`;
      execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { stdio: 'pipe' });
    } else if (type === 'targz') {
      const cmd = `tar -xzf '${psQuote(archivePath)}' -C '${psQuote(extractDir)}'`;
      execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { stdio: 'pipe' });
    } else {
      throw new Error(`Unsupported archive type: ${type}`);
    }
  } else {
    if (type === 'zip') {
      execFileSync('unzip', ['-o', archivePath, '-d', extractDir], { stdio: 'pipe' });
    } else if (type === 'targz') {
      execFileSync('tar', ['-xzf', archivePath, '-C', extractDir], { stdio: 'pipe' });
    } else {
      throw new Error(`Unsupported archive type: ${type}`);
    }
  }
}

function getBinaryVersion(binaryPath) {
  // Avoid shell:true for binary version checks — shell concatenates args on Windows,
  // breaking flags when path has spaces (causes DEP0190 deprecation too).
  try {
    return execFileSync(binaryPath, ['--version'], { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    try {
      return execFileSync(binaryPath, ['-version'], { encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch {
      return null;
    }
  }
}

// ── Main Loop ───────────────────────────────────────────────────────────────
for (const tool of tools) {
  report.checked++;
  try {
    // ── NPM tools ─────────────────────────────────────────────────────────
    if (tool.type === 'npm') {
      log(`Checking npm package: ${tool.package}`);
      if (checkNpm(tool.package)) {
        const v = npmListVersion(tool.package);
        log(`  ${tool.package} already installed${v ? ' — ' + v : ''}`);
        continue;
      }

      if (checkOnly) {
        report.skipped.push(tool.name);
        log(`  ${tool.package} missing (check-only mode)`);
        continue;
      }

      log(`  Installing ${tool.package}...`);
      installNpm(tool.package);
      report.installed.push(tool.name);

      const binName = tool.binary || tool.package || tool.name;
      const v = getBinaryVersion(binName) || npmListVersion(tool.package);
      log(`  Installed ${tool.package}${v ? ' — ' + v : ''}`);
      continue;
    }

    // ── Binary tools ──────────────────────────────────────────────────────
    const platform = tool.platforms?.[process.platform];
    if (!platform) {
      report.skipped.push(tool.name);
      log(`  ${tool.name}: no platform config for ${process.platform}`);
      continue;
    }

    const binaryPath = join(ROOT_DIR, tool.binary);
    if (existsSync(binaryPath)) {
      const v = getBinaryVersion(binaryPath);
      log(`  ${tool.name} already exists${v ? ' — ' + v : ''}`);
      continue;
    }

    if (checkOnly) {
      report.skipped.push(tool.name);
      log(`  ${tool.name} missing at ${binaryPath} (check-only mode)`);
      continue;
    }

    log(`  Downloading ${tool.name} v${tool.version}...`);
    const url = platform.url.replace(/{version}/g, tool.version);
    const tempDir = os.tmpdir();
    const archiveName = basename(new URL(url).pathname) || `archive-${tool.name}`;
    const tempArchive = join(tempDir, archiveName);
    const extractDir = join(tempDir, `ensure-tools-${tool.name}-${Date.now()}`);

    mkdirSync(extractDir, { recursive: true });

    try {
      downloadFile(url, tempArchive);
      log(`  Extracting ${archiveName}...`);
      extractArchive(tempArchive, extractDir, platform.archive);

      const binaryDir = dirname(binaryPath);
      for (const file of platform.extract) {
        const src = join(extractDir, file);
        if (!existsSync(src)) {
          throw new Error(`Extracted file not found: ${file}`);
        }
        const dest = platform.extract.length === 1 ? binaryPath : join(binaryDir, basename(file));
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
        log(`  Moved ${file} → ${dest}`);
      }

      const v = getBinaryVersion(binaryPath);
      if (!v) {
        throw new Error('Binary verification failed (no version output)');
      }
      log(`  Verified ${tool.name} — ${v}`);
      report.installed.push(tool.name);
    } finally {
      try { rmSync(tempArchive, { force: true }); } catch {}
      try { rmSync(extractDir, { recursive: true, force: true }); } catch {}
    }
  } catch (err) {
    report.failed.push(tool.name);
    report.errors.push(`${tool.name}: ${err.message}`);
    error(`FAILED: ${tool.name} — ${err.message}`);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
const output = jsonOutput ? JSON.stringify(report) : JSON.stringify(report, null, 2);
console.log(output);
