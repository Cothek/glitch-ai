#!/usr/bin/env node
// Check whether a review-pass marker exists, is fresh, and covers specific files.
// Counterpart to write-review-pass.mjs.

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileExistsOnDiskOrBranch } from './lib/review-pass-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_MARKER = join(ROOT, 'data', '.review-pass.json');

function showHelp() {
  console.log(`Usage: node scripts/check-review-pass.mjs [options]

Options:
  --files <list>          Comma-separated list of files to verify coverage for
  --target-branch <ref>   Allow files that resolve on a git ref (for pre-merge markers)
  --max-age <seconds>     Max marker age in seconds (default: 7200)
  --marker-path <path>    Path to the marker file (default: data/.review-pass.json)
  --help                  Show this help message

Examples:
  node scripts/check-review-pass.mjs
  node scripts/check-review-pass.mjs --files "src/api.ts,src/lib.ts"
  node scripts/check-review-pass.mjs --files ".github/workflows/validate-submodules.yml" --target-branch origin/main`);
}

function parseArgs(argv) {
  const args = {
    files: null,
    targetBranch: null,
    maxAge: 7200,
    markerPath: DEFAULT_MARKER,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
        break;
      case '--files':
        args.files = argv[++i] ?? null;
        break;
      case '--target-branch':
        args.targetBranch = argv[++i] ?? null;
        break;
      case '--max-age':
        args.maxAge = parseInt(argv[++i], 10);
        if (isNaN(args.maxAge) || args.maxAge <= 0) {
          console.error(`Invalid --max-age: ${argv[i]}`);
          process.exit(1);
        }
        break;
      case '--marker-path':
        args.markerPath = resolve(argv[++i] ?? DEFAULT_MARKER);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        showHelp();
        process.exit(1);
    }
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.markerPath)) {
    console.error(`✗ Review-pass marker not found: ${args.markerPath}`);
    process.exit(1);
  }

  let marker;
  try {
    marker = JSON.parse(readFileSync(args.markerPath, 'utf8'));
  } catch (err) {
    console.error(`✗ Failed to parse marker: ${err.message}`);
    process.exit(1);
  }

  const ageSeconds = (Date.now() - (marker.epoch_ms || 0)) / 1000;
  if (ageSeconds > args.maxAge) {
    console.error(`✗ Marker expired: age ${Math.round(ageSeconds)}s exceeds max ${args.maxAge}s`);
    process.exit(1);
  }

  if (args.files) {
    const checkFiles = args.files
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    const markerFiles = new Set(marker.files || []);

    for (const file of checkFiles) {
      const covered = marker.all_changed_files || markerFiles.has(file);
      if (!covered) {
        console.error(`✗ File not covered by marker: ${file}`);
        process.exit(1);
      }
      const result = fileExistsOnDiskOrBranch(file, ROOT, args.targetBranch);
      if (!result.exists) {
        console.error(`✗ File does not exist: ${file}`);
        process.exit(1);
      }
    }
  }

  const fileCount = marker.files ? marker.files.length : 0;
  console.log(`✓ Marker valid: ${marker.verdict || 'unknown'} from ${marker.reviewer_agent || 'unknown'} covering ${fileCount} files (age ${Math.round(ageSeconds)}s)`);
  process.exit(0);
}

main();
