// build-zip.mjs
// Build the Glitch AI download ZIP archive at prebuild time.
// Reads from the parent repo (glitch-ai/) by default, but can be overridden with SOURCE_DIR.
//
// Usage:
//   node scripts/build-zip.mjs                          # build from parent repo
//   SOURCE_DIR=/path/to/glitch-ai node scripts/...      # build from custom dir
//   node scripts/build-zip.mjs --source <dir>           # same, with flag

import { createRequire } from "module";
import { createWriteStream, mkdirSync, existsSync, rmSync, writeFileSync } from "fs";
import { resolve, join, dirname, isAbsolute } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const _require = createRequire(import.meta.url);
const { ZipArchive } = _require("archiver");

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = resolve(__dirname, "..");          // glitch-website/
const DEFAULT_SOURCE = resolve(WEBSITE_ROOT, "..");     // glitch-ai/
const OUTPUT_DIR = resolve(WEBSITE_ROOT, "public", "downloads");
const OUTPUT_FILE = join(OUTPUT_DIR, "glitch-ai.zip");
const SHA_FILE = join(OUTPUT_DIR, ".sha");

// Parse args
function parseArgs() {
  const args = process.argv.slice(2);
  let source = process.env.SOURCE_DIR;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source" && args[i + 1]) {
      source = args[i + 1];
      i++;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
build-zip.mjs - Build the Glitch AI download archive

Usage:
  node scripts/build-zip.mjs                          Build from parent repo
  node scripts/build-zip.mjs --source <dir>           Build from a specific source dir
  SOURCE_DIR=<dir> node scripts/build-zip.mjs         Build from env var

Options:
  --source <dir>    Source directory to zip (default: parent of glitch-website/)
  -h, --help        Show this help
`);
      process.exit(0);
    }
  }
  return {
    source: source ? (isAbsolute(source) ? source : resolve(process.cwd(), source)) : DEFAULT_SOURCE,
  };
}

const { source: SOURCE_DIR } = parseArgs();

function getSha() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: SOURCE_DIR, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "local";
  }
}

function getCommitDate() {
  try {
    return execSync("git log -1 --format=%cd --date=short", { cwd: SOURCE_DIR, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const EXCLUDE_PATTERNS = [
  // VCS (nested-aware: catches .git in submodules too)
  "**/.git/**",
  "**/.git",
  "**/.gitmodules",

  // Deps / build (nested-aware: catches node_modules anywhere — important for submodules)
  "**/node_modules/**",
  "**/node_modules",
  "**/.next/**",
  "**/.next",
  "**/.turbo/**",
  "**/.turbo",
  "**/dist/**",
  "**/dist",
  "**/build/**",
  "**/build",
  "**/out/**",
  "**/out",

  // Glitch website itself (we don't want to bundle our own source)
  "glitch-website/**",
  "glitch-website",

  // Glitch runtime data (Troy's private)
  "**/user/**",
  "**/user",
  "**/data/**",
  "**/data",
  "**/tmp/**",
  "**/tmp",

  // Large binaries (downloaded by bootstrap.ps1 on first run)
  "**/opencode/**",
  "**/opencode",
  "**/handy-voice/**",
  "**/handy-voice",
  "cloudflared.exe",

  // Internal debug
  "**/tools/**",
  "**/tools",
  "**/screenshots/**",
  "**/screenshots",

  // Backups, locks, secrets
  "**/*.bak",
  "**/*.log",
  "**/*.zip",
  "**/*.tar.gz",
  "**/*.tgz",
  "**/*.db",
  "**/*.sqlite",
  "**/*.sqlite3",
  "**/.env",
  "**/.env.*",
  "**/.env.example",
  "**/.server-password",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",

  // OS junk
  "**/.DS_Store",
  "**/Thumbs.db",
  "**/desktop.ini",
];

function checkSource() {
  if (!existsSync(SOURCE_DIR)) {
    console.warn(`[build-zip] source not found: ${SOURCE_DIR} - skipping (this is expected on Vercel)`);
    process.exit(0);
  }
  const required = ["setup.bat", "launch-glitch.bat", "opencode.json", "README.md"];
  for (const file of required) {
    if (!existsSync(join(SOURCE_DIR, file))) {
      console.error(`[build-zip] required file missing in source: ${file}`);
      process.exit(1);
    }
  }
}

async function build() {
  checkSource();
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const sha = getSha();
  const date = getCommitDate();
  const startedAt = Date.now();

  console.log(`[build-zip] source: ${SOURCE_DIR}`);
  console.log(`[build-zip] output: ${OUTPUT_FILE}`);
  console.log(`[build-zip] commit: ${sha} (${date})`);

  return new Promise((resolve, reject) => {
    if (existsSync(OUTPUT_FILE)) {
      rmSync(OUTPUT_FILE);
    }

    const output = createWriteStream(OUTPUT_FILE);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    let totalEntries = 0;
    archive.on("entry", () => totalEntries++);

    output.on("close", () => {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(2);
      console.log(`[build-zip] built ${sizeMB} MB, ${totalEntries} entries, ${elapsed}s`);

      // Write SHA sidecar so the API route can use it
      try {
        writeFileSync(SHA_FILE, sha);
      } catch {
        /* noop */
      }

      resolve({
        zipPath: OUTPUT_FILE,
        sha,
        sizeBytes: archive.pointer(),
        builtAt: Date.now(),
      });
    });

    archive.on("warning", (err) => {
      if (err.code === "ENOENT") {
        console.warn(`[build-zip] warn: ${err.message}`);
      } else {
        reject(err);
      }
    });

    archive.on("error", (err) => reject(err));

    archive.pipe(output);

    // Add an INSTALL.txt with quick start
    archive.append(
      `# Glitch AI\n\n` +
        `Downloaded from: https://github.com/Cothek/glitch-ai\n` +
        `Commit: ${sha} (${date})\n\n` +
        `## Quick Start (Windows)\n\n` +
        `1. Extract this archive somewhere on your machine\n` +
        `2. Double-click \\\`setup.bat\\\` (or run it in PowerShell)\n` +
        `3. After setup completes, run \\\`launch-glitch.bat\\\`\n\n` +
        `Your personal data lives in \\\`user/\\\` and stays local.\n\n` +
        `## Documentation\n\n` +
        `See README.md in this archive for full details.\n` +
        `Or visit: https://github.com/Cothek/glitch-ai\n`,
      { name: "INSTALL.txt" }
    );

    archive.glob("**/*", {
      cwd: SOURCE_DIR,
      ignore: EXCLUDE_PATTERNS,
      dot: false,
    });

    archive.finalize();
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  build().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { build as buildZip };
