/**
 * Engine Bootstrap Module
 * Ensures glitch-memorycore engine directory is populated with content files.
 * Handles both git submodule (fresh clone) and zip download (no .git) scenarios.
 */

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DARK_GREEN = '\x1b[32;2m';
const DARK_YELLOW = '\x1b[33;2m';

/**
 * @param {Object} options
 * @param {string} options.rootDir - ROOT_DIR of glitch-ai project
 * @param {boolean} options.isWin - process.platform === 'win32'
 * @param {Function} options.run - (cmd, args, opts) => { success, stdout, stderr, error, status }
 * @param {Function} options.downloadFile - (url, destPath) => Promise<void>
 * @param {Function} options.log - (colorString, msg) => void — uses ANSI color codes
 * @returns {Promise<boolean>}
 */
export async function ensureEngine(options) {
  const { rootDir, isWin, run, downloadFile, log } = options;

  const fs = await import('fs');
  const path = await import('path');

  const engineDir = path.join(rootDir, 'glitch-memorycore');
  const promptRulesPath = path.join(engineDir, 'prompt-rules.md');

  // a. Check if engine already exists
  if (fs.existsSync(promptRulesPath)) {
    log(DARK_GREEN, '  Engine found');
    return true;
  }

  // c. Try git submodule first
  const gitDir = path.join(rootDir, '.git');
  const hasGit = fs.existsSync(gitDir);

  if (hasGit) {
    log(CYAN, '  Initializing git submodule...');
    const result = await run('git', ['submodule', 'update', '--init', '--recursive'], { cwd: rootDir });

    if (result.success && fs.existsSync(promptRulesPath)) {
      log(GREEN, '  Engine initialized via git submodule');
      return true;
    }

    if (!result.success) {
      log(DARK_YELLOW, `  Git submodule init failed (${result.error || result.stderr || 'unknown error'}), falling back to download...`);
    }
  } else {
    log(DARK_YELLOW, '  No .git directory found, downloading engine from GitHub...');
  }

  // d. Download from GitHub as zip
  const zipUrl = 'https://github.com/Cothek/glitch-memorycore/archive/refs/heads/main.zip';
  const tempDir = isWin
    ? process.env.TEMP || process.env.TMP || 'C:\\Temp'
    : '/tmp';
  const zipPath = path.join(tempDir, `glitch-memorycore-${Date.now()}.zip`);
  const extractDir = path.join(tempDir, `glitch-memorycore-extract-${Date.now()}`);

  try {
    log(CYAN, '  Downloading engine from GitHub...');
    await downloadFile(zipUrl, zipPath);

    log(CYAN, '  Extracting...');
    if (isWin) {
      const psCmd = `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force`;
      await run('powershell.exe', ['-NoProfile', '-Command', psCmd], { cwd: rootDir });
    } else {
      await run('unzip', ['-o', zipPath, '-d', extractDir], { cwd: rootDir });
    }

    // Find the extracted folder (glitch-memorycore-main or similar)
    const entries = fs.readdirSync(extractDir, { withFileTypes: true });
    const extractedFolder = entries.find(e => e.isDirectory() && e.name.startsWith('glitch-memorycore'));

    if (!extractedFolder) {
      throw new Error('Extracted folder not found (expected glitch-memorycore-*)');
    }

    const sourceDir = path.join(extractDir, extractedFolder.name);

    // Ensure target directory exists
    fs.mkdirSync(engineDir, { recursive: true });

    // Copy all contents
    log(CYAN, '  Copying engine files...');
    await copyDirRecursive(sourceDir, engineDir, fs, path);

    // Cleanup temp files
    try {
      fs.rmSync(zipPath, { force: true });
      fs.rmSync(extractDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    // e. VERIFICATION
    if (!fs.existsSync(promptRulesPath)) {
      log(RED, '  ERROR: Engine download incomplete — critical files missing');
      log(RED, '  Run: git clone --recursive https://github.com/Cothek/glitch-ai.git');
      return false;
    }

    // f. Success
    log(GREEN, '  Engine downloaded and installed successfully');
    return true;

  } catch (err) {
    // Cleanup on error
    try {
      if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
      if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }

    log(RED, `  ERROR: Failed to bootstrap engine: ${err.message}`);
    return false;
  }
}

/**
 * Recursively copy directory contents
 */
async function copyDirRecursive(src, dest, fs, path) {
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      await copyDirRecursive(srcPath, destPath, fs, path);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
    // Skip symlinks and other types
  }
}