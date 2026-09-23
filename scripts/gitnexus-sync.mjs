#!/usr/bin/env node
// gitnexus-sync.mjs — background GitNexus index sync for the startup pipeline.
//
// Runs `gitnexus analyze` (incremental — only re-analyzes changed files) with
// the LadybugDB buffer pool raised, so the blast-radius hook and GitNexus MCP
// tools always query a fresh index. Spawned detached by the launch scripts
// (same pattern as watchdog-external.mjs), so it never blocks startup.
//
// Why the buffer pool: the LadybugDB default (256 MiB) is exhausted by the bulk
// COPY on a full rebuild. 4 GiB is enough for glitch-ai's ~4.8k-node graph.
//
// Why the PATH fix: GitNexus's FTS (full-text search) extension links against
// OpenSSL 3 (libssl-3-x64.dll / libcrypto-3-x64.dll), which are NOT distributed
// with the extension. Without them on the DLL search path, the FTS extension
// fails to load (Windows error 126) and `gitnexus analyze` silently skips FTS
// index creation — degrading the `query` tool to empty results. Git for Windows
// ships those DLLs at <GitRoot>\mingw64\bin, so we detect that directory and
// prepend it to PATH before running analyze.
//
// Logs to data/logs/gitnexus-sync.log (self-managed; the launcher spawns with
// stdio: 'ignore').

import { spawn, execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, appendFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const LOG_FILE = join(ROOT_DIR, 'data', 'logs', 'gitnexus-sync.log');

// Raise the LadybugDB buffer pool so bulk COPY doesn't exhaust the 256 MiB default.
process.env.GITNEXUS_LBUG_BUFFER_POOL_SIZE =
  process.env.GITNEXUS_LBUG_BUFFER_POOL_SIZE || '4294967296';

const isWin = process.platform === 'win32';

function log(msg) {
  try {
    mkdirSync(join(ROOT_DIR, 'data', 'logs'), { recursive: true });
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`, 'utf-8');
  } catch {
    // Logging is best-effort; never let it crash the sync.
  }
}

/**
 * Locate Git for Windows' mingw64\bin directory (which ships the OpenSSL 3 DLLs
 * the FTS extension needs). Returns the directory path, or null if not found.
 * Detects dynamically via `where.exe git` (deriving <GitRoot>\mingw64\bin from
 * <GitRoot>\cmd\git.exe), with a fallback over common install locations.
 */
function findGitMingw64Bin() {
  if (!isWin) return null;

  // 1. Resolve git via where.exe and derive the mingw64 bin path.
  try {
    const out = execFileSync('where.exe', ['git'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of out.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const idx = line.toLowerCase().indexOf('\\cmd\\git');
      if (idx !== -1) {
        const candidate = join(line.slice(0, idx), 'mingw64', 'bin');
        if (existsSync(join(candidate, 'libssl-3-x64.dll'))) return candidate;
      }
    }
  } catch {
    // where.exe failed — fall through to the common-location scan.
  }

  // 2. Fallback: scan common Git install roots (drive letters vary per machine).
  const roots = [
    'C:\\Program Files\\Git',
    'D:\\Program Files\\Git',
    'E:\\Program Files\\Git',
    'C:\\Program Files (x86)\\Git',
  ];
  for (const root of roots) {
    const candidate = join(root, 'mingw64', 'bin');
    if (existsSync(join(candidate, 'libssl-3-x64.dll'))) return candidate;
  }
  return null;
}

// Prepend Git's mingw64\bin to PATH so the FTS extension can load OpenSSL 3.
const mingw64Bin = findGitMingw64Bin();
if (mingw64Bin) {
  process.env.PATH = mingw64Bin + ';' + (process.env.PATH || '');
  log(`prepended Git mingw64 bin to PATH for FTS/OpenSSL: ${mingw64Bin}`);
} else {
  log('WARN: Git mingw64 bin not found — FTS extension may fail to load (OpenSSL 3 DLLs missing); keyword search will degrade');
}

log(`gitnexus-sync starting (buffer pool ${process.env.GITNEXUS_LBUG_BUFFER_POOL_SIZE})`);

const args = ['analyze'];
let child;
try {
  // Windows: gitnexus is a .cmd/.ps1 shim — route through cmd.exe /c.
  if (isWin) {
    child = spawn('cmd.exe', ['/c', 'gitnexus', ...args], {
      cwd: ROOT_DIR,
      shell: false,
      windowsHide: true,
    });
  } else {
    child = spawn('gitnexus', args, { cwd: ROOT_DIR, shell: false });
  }
} catch (err) {
  log(`failed to spawn gitnexus: ${err.message}`);
  process.exit(1);
}

let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => { stdout += d.toString(); });
child.stderr.on('data', (d) => { stderr += d.toString(); });

child.on('error', (err) => {
  log(`gitnexus error: ${err.message}`);
  process.exit(1);
});

child.on('close', (code) => {
  // Extract the summary line (e.g. "4,781 nodes | 12,404 edges | ...") for the log.
  const summary = stdout.split('\n').filter((l) => /\d+ nodes \|/.test(l)).pop() || '';
  if (code === 0) {
    log(`analyze complete (exit 0)${summary ? ' — ' + summary.trim() : ''}`);
  } else {
    const detail = (stderr.trim() || stdout.trim()).slice(0, 500);
    log(`analyze FAILED (exit ${code}): ${detail}`);
  }
  process.exit(code === 0 ? 0 : 1);
});