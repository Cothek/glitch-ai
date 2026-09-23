#!/usr/bin/env node

/**
 * detect-lmstudio-context.mjs
 *
 * CLI wrapper around the lmstudio-context-detector module.
 * Detects context lengths of models loaded in LM Studio and writes the
 * values into opencode-local.json so the runtime knows the real limits.
 *
 * Usage:
 *   node scripts/detect-lmstudio-context.mjs [options]
 *
 * Options:
 *   --dry-run             Print what would change without writing to disk
 *   --apply-if-changes    Detect once, write only if changes needed (JSON output)
 *   --base-url <url>      Override the LM Studio base URL (default: http://127.0.0.1:1234)
 *   --help                Show this help message
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  detectContextSizes,
  getModelsFromApi,
  readConfigFile,
} from './lib/lmstudio-context-detector.mjs';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const CONFIG_PATH = resolve(ROOT_DIR, 'config', 'opencode-local.json');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    dryRun: false,
    applyIfChanges: false,
    baseUrl: 'http://127.0.0.1:1234',
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--apply-if-changes') {
      args.applyIfChanges = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--base-url') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        console.error('Error: --base-url requires a value');
        process.exit(1);
      }
      args.baseUrl = next.replace(/\/+$/, '');
      i++;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return args;
}

function showHelp() {
  console.log(`
detect-lmstudio-context.mjs — Detect LM Studio model context lengths

Usage:
  node scripts/detect-lmstudio-context.mjs [options]

Options:
  --dry-run             Print what would change without writing to disk
  --apply-if-changes    Detect once, write only if changes needed (JSON output)
  --base-url <url>      Override the LM Studio base URL (default: http://127.0.0.1:1234)
  -h, --help            Show this help message

Detection strategy:
  1. Read metadata from LM Studio's /v1/models endpoint
  2. Read the LM Studio server config file (Windows only)
  3. Binary-search the actual context limit via chat completions

Output:
  Updates config/opencode-local.json with the detected context_length values
  for each model loaded in LM Studio.
`);
}

// ---------------------------------------------------------------------------
// Utility: BOM-safe JSON read
// ---------------------------------------------------------------------------

function readJsonStripBom(filePath) {
  let raw = readFileSync(filePath, 'utf-8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  const jsonMode = args.applyIfChanges;

  if (!jsonMode) {
    console.log('===========================================');
    console.log('  LM Studio Context Length Detection');
    console.log('===========================================');
    console.log(`  Base URL: ${args.baseUrl}`);
    console.log(`  Dry run:  ${args.dryRun}`);
    console.log('');
  }

  // --- Step 1: Read the existing config (graceful if missing) ---
  const configExists = existsSync(CONFIG_PATH);
  let config = null;
  let existingModels = {};

  if (configExists) {
    try {
      config = readJsonStripBom(CONFIG_PATH);
    } catch (err) {
      if (jsonMode) {
        process.stdout.write(JSON.stringify({
          status: 'error',
          error: `Could not parse config: ${err.message}`,
          configPath: CONFIG_PATH,
          configExists: true,
        }) + '\n');
        process.exit(1);
      }
      console.error(`Error: Could not parse config: ${err.message}`);
      process.exit(1);
    }

    // Ensure the lmstudio provider section exists
    if (!config.provider) config.provider = {};
    if (!config.provider.lmstudio) {
      config.provider.lmstudio = {
        npm: '@ai-sdk/openai-compatible',
        name: 'LM Studio (local)',
        options: { baseURL: `${args.baseUrl}/v1` },
        models: {},
      };
    }
    if (!config.provider.lmstudio.models) {
      config.provider.lmstudio.models = {};
    }

    existingModels = config.provider.lmstudio.models;
  }

  // --- Step 2: Query LM Studio for loaded models ---
  if (!jsonMode) console.log('[1/3] Querying LM Studio API for loaded models...');
  let apiModels = [];

  try {
    apiModels = await getModelsFromApi(args.baseUrl);
    if (!jsonMode) console.log(`  Found ${apiModels.length} model(s) via API`);
  } catch (err) {
    if (err.name === 'AbortError') {
      if (!jsonMode) console.error('  Error: LM Studio did not respond (timeout). Is it running?');
    } else if (err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED')) {
      if (!jsonMode) {
        console.error('  Error: Cannot connect to LM Studio. Is it running?');
        console.error(`  Attempted: ${args.baseUrl}/v1/models`);
      }
    } else {
      if (!jsonMode) console.error(`  Error querying LM Studio: ${err.message}`);
    }
    if (!jsonMode) console.error('  Continuing with config-file and probe strategies only...');
  }

  // --- Step 3: Detect context lengths using the module ---
  if (!jsonMode) {
    console.log('');
    console.log('[2/3] Detecting context lengths...');
  }

  const detected = await detectContextSizes(args.baseUrl);

  // Log results (non-JSON mode)
  if (!jsonMode) {
    for (const [modelId, { context, source }] of Object.entries(detected)) {
      const label = source === 'metadata' ? 'META'
        : source === 'config_file' ? 'CONFIG'
        : source === 'binary_search' ? 'PROBE'
        : 'FALLBACK';
      console.log(`  [${label}] ${modelId}: ${context} tokens (source: ${source})`);
    }
  }

  // --- Step 4: Compute what would change ---
  if (!jsonMode) {
    console.log('');
    console.log('[3/3] Updating opencode-local.json...');
  }

  const changes = {};
  let changeCount = 0;

  for (const [modelId, { context: contextLength, source }] of Object.entries(detected)) {
    const existing = existingModels[modelId];
    const outputLimit = Math.min(Math.floor(contextLength / 4), 8192);

    const newEntry = {
      name: modelId.replace(/[-_/]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      limit: {
        context: contextLength,
        output: outputLimit,
      },
    };

    if (existing) {
      const oldCtx = existing?.limit?.context;
      if (oldCtx === contextLength) {
        if (!jsonMode) console.log(`  [KEEP] ${modelId}: ${contextLength} (unchanged, source: ${source})`);
        continue;
      }

      if (!jsonMode) {
        if (oldCtx) {
          console.log(`  [UPDATE] ${modelId}: ${oldCtx} -> ${contextLength} (source: ${source})`);
        } else {
          console.log(`  [SET] ${modelId}: ${contextLength} (source: ${source})`);
        }
      }
      changes[modelId] = { old: oldCtx ?? null, new: contextLength, source };
      existingModels[modelId] = {
        ...existing,
        ...newEntry,
        limit: newEntry.limit,
      };
    } else {
      if (!jsonMode) console.log(`  [ADD] ${modelId}: ${contextLength} (source: ${source})`);
      changes[modelId] = { old: null, new: contextLength, source };
      existingModels[modelId] = newEntry;
    }

    changeCount++;
  }

  // --- Step 5: Write or report ---
  if (!jsonMode) {
    console.log('');
    console.log('---');
  }

  if (jsonMode) {
    // Structured JSON output for --apply-if-changes
    let writeResult = 'skipped';
    let writeError = null;

    if (!configExists) {
      writeResult = 'skipped_no_config';
    } else if (changeCount === 0) {
      writeResult = 'no_changes';
    } else {
      // Apply changes
      try {
        writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4) + '\n', 'utf-8');
        writeResult = 'applied';
      } catch (err) {
        writeResult = 'error';
        writeError = err.message;
      }
    }

    const result = {
      status: writeResult,
      changeCount,
      models: detected,
      changes,
      configPath: CONFIG_PATH,
      configExists,
    };
    if (writeError) result.error = writeError;

    process.stdout.write(JSON.stringify(result) + '\n');
  } else if (changeCount === 0) {
    console.log('No changes needed — all context lengths are already correct.');
  } else if (args.dryRun) {
    console.log(`[DRY RUN] Would update ${changeCount} model(s):`);
    for (const [modelId, { context: contextLength, source }] of Object.entries(detected)) {
      const existing = existingModels[modelId];
      const oldCtx = existing?.limit?.context ?? '(none)';
      console.log(`  ${modelId}: ${oldCtx} -> ${contextLength} (${source})`);
    }
    console.log('No files modified.');
  } else {
    try {
      writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4) + '\n', 'utf-8');
      console.log(`Updated ${changeCount} model(s) in ${CONFIG_PATH}`);
    } catch (err) {
      console.error(`Error writing config: ${err.message}`);
      process.exit(1);
    }
  }

  // --- Summary (non-JSON mode only) ---
  if (!jsonMode) {
    console.log('');
    console.log('=== Detection Summary ===');
    for (const [modelId, { context: contextLength, source }] of Object.entries(detected)) {
      console.log(`  ${modelId}`);
      console.log(`    Context: ${contextLength.toLocaleString()} tokens`);
      console.log(`    Source:  ${source}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
