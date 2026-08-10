/**
 * OpenCode Bootstrap Module
 *
 * Downloads the OpenCode binary for the current platform from the npm registry
 * and installs it to <rootDir>/opencode/opencode[.exe].
 *
 * Replaces the Windows-only bootstrap.ps1 invocation in the launch scripts.
 * Works on Windows, macOS, and Linux.
 *
 * No external dependencies -- uses only Node.js built-ins (fs, path, https, os, child_process).
 */

import { existsSync, mkdirSync, createWriteStream, unlinkSync, rmSync, chmodSync, readdirSync, statSync, copyFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { get as httpsGet } from 'https';

function resolveTar() {
  if (process.platform === 'win32') {
    const sysTar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (existsSync(sysTar)) return sysTar;
  }
  return 'tar';
}
const TAR = resolveTar();

// ANSI color codes (kept local so the module has no external deps)
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DARK_GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

function log(color, msg) {
  if (msg === undefined) {
    console.log(color);
  } else {
    console.log(`${color}${msg}${RESET}`);
  }
}

/**
 * Map (process.platform, process.arch) to the npm package name that ships
 * the OpenCode binary for that target.
 *
 * @param {string} platform - process.platform ('win32' | 'darwin' | 'linux')
 * @param {string} arch - process.arch ('x64' | 'arm64' | ...)
 * @returns {string|null} npm package name, or null if unsupported
 */
function getPackageName(platform, arch) {
  if (platform === 'win32') {
    if (arch === 'arm64') return 'opencode-windows-arm64';
    if (arch === 'x64') return 'opencode-windows-x64';
    return null;
  }
  if (platform === 'darwin') {
    if (arch === 'arm64') return 'opencode-darwin-arm64';
    if (arch === 'x64') return 'opencode-darwin-x64';
    return null;
  }
  if (platform === 'linux') {
    if (arch === 'arm64') return 'opencode-linux-arm64';
    if (arch === 'x64') return 'opencode-linux-x64';
    return null;
  }
  return null;
}

/**
 * Fetch the latest version of `opencode-ai` from the npm registry.
 * Returns the version string, or null on failure.
 *
 * @returns {Promise<string|null>}
 */
function fetchLatestOpenCodeVersion() {
  return new Promise((resolve) => {
    const url = 'https://registry.npmjs.org/opencode-ai/latest';
    httpsGet(url, (response) => {
      // Follow one redirect if needed
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = response.headers.location;
        httpsGet(redirectUrl, (r2) => collectJson(r2, resolve)).on('error', () => resolve(null));
        return;
      }
      collectJson(response, resolve);
    }).on('error', () => resolve(null));
  });
}

function collectJson(response, resolve) {
  if (response.statusCode !== 200) {
    resolve(null);
    return;
  }
  let body = '';
  response.setEncoding('utf-8');
  response.on('data', (chunk) => { body += chunk; });
  response.on('end', () => {
    try {
      const parsed = JSON.parse(body);
      resolve(parsed.version || null);
    } catch {
      resolve(null);
    }
  });
  response.on('error', () => resolve(null));
}

/**
 * Download a file from `url` to `destPath`. Follows redirects.
 * @param {string} url
 * @param {string} destPath
 * @returns {Promise<void>}
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    httpsGet(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        try { unlinkSync(destPath); } catch {}
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        try { unlinkSync(destPath); } catch {}
        reject(new Error(`HTTP ${response.statusCode} downloading ${url}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      file.close();
      try { unlinkSync(destPath); } catch {}
      reject(err);
    });
  });
}

/**
 * Recursively find a file by name inside `dir`.
 * @param {string} dir
 * @param {string} fileName
 * @returns {string|null} absolute path, or null if not found
 */
function findFileRecursive(dir, fileName) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return full;
    }
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, fileName);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Run `tar -xf <tgzPath> -C <destDir>` using the system tar.
 * On Windows, Node 18+ ships with `tar.exe` available via PATH (or via the
 * bundled Node location). On macOS/Linux, `tar` is always on PATH.
 *
 * @param {string} tgzPath
 * @param {string} destDir
 * @returns {{success: boolean, stderr: string, error: string|null}}
 */
function extractTarGz(tgzPath, destDir) {
  try {
    execFileSync(TAR, ['-xzf', tgzPath, '-C', destDir], {
      stdio: ['ignore', 'ignore', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    });
    return { success: true, stderr: '', error: null };
  } catch (e) {
    return {
      success: false,
      stderr: (e.stderr || '').toString(),
      error: e.message || String(e),
    };
  }
}

/**
 * Bootstrap OpenCode for the current platform.
 *
 * Downloads the platform-specific npm package, extracts the binary, and
 * installs it to <rootDir>/opencode/opencode[.exe]. Returns true on success.
 *
 * @param {string} rootDir - absolute path to the glitch-ai project root
 * @returns {Promise<boolean>} true if OpenCode is installed after this call
 */
export async function bootstrapOpenCode(rootDir) {
  const platform = process.platform;
  const arch = process.arch;
  const isWin = platform === 'win32';
  const binName = isWin ? 'opencode.exe' : 'opencode';

  const pkgName = getPackageName(platform, arch);
  if (!pkgName) {
    log(RED, `  ERROR: Unsupported platform/arch: ${platform}/${arch}`);
    log(YELLOW, '  Try running: npm install -g opencode-ai');
    return false;
  }

  const opencodeDir = join(rootDir, 'opencode');
  const opencodeBin = join(opencodeDir, binName);

  // Already installed -- nothing to do.
  if (existsSync(opencodeBin)) {
    return true;
  }

  // 1. Resolve latest version from npm registry (fallback to a known-good version).
  log(CYAN, `  Detecting latest OpenCode version...`);
  let version = await fetchLatestOpenCodeVersion();
  if (!version) {
    version = '1.18.11';
    log(DARK_GRAY, `  Could not query npm registry, using fallback version ${version}`);
  } else {
    log(DARK_GRAY, `  Latest version: ${version}`);
  }

  // 2. Download the platform-specific .tgz from the npm registry.
  const tgzUrl = `https://registry.npmjs.org/${pkgName}/-/${pkgName}-${version}.tgz`;
  const tempRoot = tmpdir();
  const tgzPath = join(tempRoot, `opencode-${pkgName}-${version}.tgz`);
  const extractDir = join(tempRoot, `opencode-extract-${pkgName}-${version}-${Date.now()}`);

  try {
    log(CYAN, `  Downloading OpenCode ${version} for ${platform}/${arch}...`);
    await downloadFile(tgzUrl, tgzPath);

    // 3. Extract the tarball.
    log(CYAN, '  Extracting...');
    if (existsSync(extractDir)) rmSync(extractDir, { recursive: true, force: true });
    mkdirSync(extractDir, { recursive: true });

    const extractResult = extractTarGz(tgzPath, extractDir);
    if (!extractResult.success) {
      throw new Error(`tar extraction failed: ${extractResult.stderr || extractResult.error}`);
    }

    // 4. Locate the binary inside the extracted `package/` folder.
    const extractedBin = findFileRecursive(extractDir, binName);
    if (!extractedBin) {
      throw new Error(`Could not find ${binName} in extracted package`);
    }

    // 5. Copy the binary to <rootDir>/opencode/opencode[.exe].
    if (!existsSync(opencodeDir)) mkdirSync(opencodeDir, { recursive: true });
    copyFileSync(extractedBin, opencodeBin);

    // 6. Make executable on Unix-like systems (no-op on Windows).
    if (!isWin) {
      try {
        chmodSync(opencodeBin, 0o755);
      } catch (e) {
        log(DARK_GRAY, `  Warning: chmod failed (${e.message}) -- binary may not be executable`);
      }
    }

    // 7. Verify the binary exists and is non-empty.
    if (!existsSync(opencodeBin)) {
      throw new Error('Binary copy reported success but file is missing');
    }
    const stat = statSync(opencodeBin);
    if (stat.size === 0) {
      throw new Error('Installed binary is empty (size 0)');
    }

    log(GREEN, `  OpenCode ${version} installed successfully.`);
    return true;
  } catch (e) {
    log(RED, `  ERROR: Failed to bootstrap OpenCode: ${e.message || e}`);
    log(YELLOW, '  Try running: npm install -g opencode-ai');
    return false;
  } finally {
    // 8. Clean up temp files (best-effort).
    try { if (existsSync(tgzPath)) unlinkSync(tgzPath); } catch {}
    try { if (existsSync(extractDir)) rmSync(extractDir, { recursive: true, force: true }); } catch {}
  }
}
