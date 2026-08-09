#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fileExistsOnDiskOrBranch } from './lib/review-pass-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MARKER_PATH = join(ROOT, 'data', '.review-pass.json');

function showHelp() {
  console.log(`Usage: node scripts/write-review-pass.mjs [options]

Options:
  --verdict <verdict>    Review verdict (default: "PASS")
  --agent <name>         Reviewer agent name (default: "reviewer")
  --files <list>         Comma-separated list of reviewed files (optional)
  --target-branch <ref>  Allow files that resolve on a git ref (for pre-merge markers)
  --help                 Show this help message

Examples:
  node scripts/write-review-pass.mjs
  node scripts/write-review-pass.mjs --verdict PASS --agent reviewer
  node scripts/write-review-pass.mjs --files "src/file1.ts,src/file2.ts"
  node scripts/write-review-pass.mjs --files ".github/workflows/validate-submodules.yml" --target-branch origin/main`);
}

function parseArgs(argv) {
  const args = {
    verdict: 'PASS',
    agent: 'reviewer',
    files: null,
    targetBranch: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
        break;
      case '--verdict':
        args.verdict = argv[++i] ?? 'PASS';
        break;
      case '--agent':
        args.agent = argv[++i] ?? 'reviewer';
        break;
      case '--files':
        args.files = argv[++i] ?? null;
        break;
      case '--target-branch':
        args.targetBranch = argv[++i] ?? null;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        showHelp();
        process.exit(1);
    }
  }

  return args;
}

function getChangedFiles() {
  try {
    const output = execSync('git diff --name-only', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (err) {
    console.error(`Failed to read git diff: ${err.message}`);
    return [];
  }
}

function validateFiles(files, branchRef = null) {
  const validated = [];
  let diskCount = 0;
  let branchCount = 0;
  for (const file of files) {
    if (!file || typeof file !== 'string') {
      console.error(`Invalid file path: ${file}`);
      return null;
    }
    const result = fileExistsOnDiskOrBranch(file, ROOT, branchRef);
    if (!result.exists) {
      console.error(`File does not exist: ${file}`);
      return null;
    }
    if (result.source === 'branch') {
      console.log(`⚠ File ${file} only exists on ${branchRef} — allowed for pre-merge markers`);
      branchCount++;
    } else {
      diskCount++;
    }
    validated.push(file);
  }
  return { files: validated, diskCount, branchCount };
}

function computeHash(files) {
  const sorted = [...files].sort();
  const joined = sorted.join('\n');
  return createHash('sha256').update(joined).digest('hex');
}

function ensureDataDir() {
  const dataDir = join(ROOT, 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

function writeMarker(marker) {
  ensureDataDir();
  writeFileSync(MARKER_PATH, JSON.stringify(marker, null, 2) + '\n', 'utf8');
}

function resetMarker() {
  try {
    if (existsSync(MARKER_PATH)) {
      unlinkSync(MARKER_PATH);
    }
  } catch (err) {
    console.error(`Failed to reset marker: ${err.message}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const changedFiles = getChangedFiles();

  let reviewedFiles;
  let diskCount = 0;
  let branchCount = 0;
  if (args.files) {
    const provided = args.files
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);
    const validated = validateFiles(provided, args.targetBranch);
    if (validated === null) {
      console.error('Path validation failed. Resetting marker.');
      resetMarker();
      process.exit(1);
    }
    reviewedFiles = validated.files;
    diskCount = validated.diskCount;
    branchCount = validated.branchCount;
  } else {
    reviewedFiles = changedFiles;
  }

  const allChanged = reviewedFiles.length === changedFiles.length &&
    [...reviewedFiles].sort().join('\n') === [...changedFiles].sort().join('\n');

  const marker = {
    verdict: args.verdict,
    reviewer_agent: args.agent,
    timestamp: new Date().toISOString(),
    epoch_ms: Date.now(),
    files: reviewedFiles,
    all_changed_files: allChanged,
    hash: computeHash(reviewedFiles),
  };

  if (args.targetBranch) {
    marker.target_branch = args.targetBranch;
  }

  try {
    writeMarker(marker);
    console.log(`Review pass marker written: ${MARKER_PATH}`);
    console.log(`  Verdict: ${marker.verdict}`);
    console.log(`  Agent: ${marker.reviewer_agent}`);
    console.log(`  Files: ${marker.files.length}`);
    if (branchCount > 0) {
      console.log(`  Files: disk: ${diskCount}, branch-only: ${branchCount}`);
    }
    console.log(`  Hash: ${marker.hash.slice(0, 16)}...`);
    if (args.targetBranch) {
      console.log(`  Target branch: ${args.targetBranch}`);
    }
  } catch (err) {
    console.error(`Failed to write marker: ${err.message}`);
    process.exit(1);
  }
}

main();
