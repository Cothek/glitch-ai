import { existsSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DARK_GREEN = '\x1b[32;2m';
const DARK_YELLOW = '\x1b[33;2m';
const DARK_GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

function log(color, msg) {
  console.log(`${color}${msg}${RESET}`);
}

function logStep(msg) {
  log(CYAN, `  → ${msg}`);
}

function logSuccess(msg) {
  log(GREEN, `  ✓ ${msg}`);
}

function logError(msg) {
  log(RED, `  ✗ ${msg}`);
}

function logWarn(msg) {
  log(YELLOW, `  ⚠ ${msg}`);
}

function logDim(msg) {
  log(DARK_GRAY, `    ${msg}`);
}

export async function installTool(options) {
  const {
    tool,
    rootDir,
    isWin,
    isMac,
    isLinux,
    run,
    downloadFile,
    log: logFn = logStep,
  } = options;

  const platformKey = isWin ? 'win32' : isMac ? 'darwin' : 'linux';
  const platformConfig = tool.platforms?.[platformKey];

  if (!platformConfig || !platformConfig.url) {
    logError(`No platform config or URL for ${tool.name} on ${platformKey}`);
    return false;
  }

  const url = platformConfig.url.replace(/\{version\}/g, tool.version);
  const binaryPath = join(rootDir, tool.binary);
  const binaryDir = dirname(binaryPath);

  try {
    if (tool.type === 'npm') {
      logStep(`Installing ${tool.name} via npm (${tool.package}@${tool.version})...`);
      const result = run('npm', ['install', '-g', `${tool.package}@${tool.version}`], { timeout: 120000 });
      if (!result.success) {
        logError(`npm install failed: ${result.stderr || result.error}`);
        return false;
      }
      logSuccess(`${tool.name} installed via npm`);
      return true;
    }

    logStep(`Installing ${tool.name} v${tool.version} for ${platformKey}...`);
    logDim(`URL: ${url}`);

    if (!existsSync(binaryDir)) {
      mkdirSync(binaryDir, { recursive: true });
    }

    const tempDir = join(tmpdir(), `glitch-install-${tool.name}-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    const archiveName = platformConfig.archive === 'targz' ? 'archive.tar.gz' : 'archive.zip';
    const archivePath = join(tempDir, archiveName);

    logStep('Downloading...');
    await downloadFile(url, archivePath);

    if (!existsSync(archivePath)) {
      logError('Download failed - file not found');
      rmSync(tempDir, { recursive: true, force: true });
      return false;
    }

    const extractDir = join(tempDir, 'extract');
    mkdirSync(extractDir, { recursive: true });

    logStep(`Extracting ${platformConfig.archive}...`);

    let extractSuccess = false;

    if (platformConfig.archive === 'zip') {
      if (isWin) {
        const psCmd = `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`;
        const result = run('powershell.exe', ['-NoProfile', '-Command', psCmd], { timeout: 60000 });
        extractSuccess = result.success;
      } else {
        const result = run('unzip', ['-o', archivePath, '-d', extractDir], { timeout: 60000 });
        extractSuccess = result.success;
      }
    } else if (platformConfig.archive === 'targz') {
      const result = run('tar', ['-xzf', archivePath, '-C', extractDir], { timeout: 60000 });
      extractSuccess = result.success;

      if (!extractSuccess && isWin) {
        logWarn('tar failed, trying PowerShell fallback...');
        const psCmd = `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
          `[System.IO.Compression.TarArchive]::ExtractToGZip('${archivePath.replace(/'/g, "''")}', '${extractDir.replace(/'/g, "''")}')`;
        const fallbackResult = run('powershell.exe', ['-NoProfile', '-Command', psCmd], { timeout: 60000 });
        extractSuccess = fallbackResult.success;
      }
    } else {
      logError(`Unknown archive type: ${platformConfig.archive}`);
      rmSync(tempDir, { recursive: true, force: true });
      return false;
    }

    if (!extractSuccess) {
      logError('Extraction failed');
      rmSync(tempDir, { recursive: true, force: true });
      return false;
    }

    let foundBinary = false;
    const findBinary = (dir) => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (findBinary(fullPath)) return true;
        } else if (entry.name === tool.binary.split('/').pop() || entry.name === tool.binary.split('\\').pop()) {
          if (!existsSync(binaryDir)) mkdirSync(binaryDir, { recursive: true });
          const destPath = join(binaryDir, entry.name);
          if (existsSync(destPath)) rmSync(destPath, { force: true });
          import('fs').then(fs => fs.copyFileSync(fullPath, destPath));
          if (isWin) {
            const exePath = destPath.endsWith('.exe') ? destPath : `${destPath}.exe`;
            if (!existsSync(exePath) && existsSync(destPath)) {
              import('fs').then(fs => fs.renameSync(destPath, exePath));
            }
          } else {
            import('fs').then(fs => fs.chmodSync(destPath, 0o755));
          }
          foundBinary = true;
          return true;
        }
      }
      return false;
    };

    findBinary(extractDir);

    if (!foundBinary) {
      const entries = readdirSync(extractDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const fullPath = join(extractDir, entry.name);
          const destPath = join(binaryDir, tool.binary.split('/').pop() || tool.binary.split('\\').pop());
          if (existsSync(destPath)) rmSync(destPath, { force: true });
          import('fs').then(fs => fs.copyFileSync(fullPath, destPath));
          if (!isWin) {
            import('fs').then(fs => fs.chmodSync(destPath, 0o755));
          }
          foundBinary = true;
          break;
        }
      }
    }

    rmSync(tempDir, { recursive: true, force: true });

    if (!foundBinary || !existsSync(binaryPath)) {
      const expectedName = tool.binary.split('/').pop() || tool.binary.split('\\').pop();
      const altPath = join(binaryDir, expectedName);
      if (!existsSync(altPath)) {
        logError(`Binary not found after extraction: ${binaryPath}`);
        return false;
      }
    }

    logSuccess(`${tool.name} v${tool.version} installed to ${binaryPath}`);
    return true;

  } catch (err) {
    logError(`Installation failed: ${err.message}`);
    return false;
  }
}