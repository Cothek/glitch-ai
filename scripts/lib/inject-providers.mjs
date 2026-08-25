#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..', '..');
const PROVIDERS_PATH = join(ROOT_DIR, 'config', 'providers.json');
const REGISTRY_PATHS = [
  join(ROOT_DIR, 'config', 'model-registry.json'),
  join(ROOT_DIR, 'data', 'model-registry.json'),
];

/**
 * Read a JSON file, stripping a UTF-8 BOM if present.
 * PowerShell (PS 5.1) writes UTF-8 files with a BOM by default — both
 * providers.json and model-registry.json are written by check-models.ps1,
 * so a raw JSON.parse fails with "Unexpected token '\uFEFF'". This helper
 * is the single BOM-safe read path for all JSON config files here.
 */
function readJsonStripBom(filePath) {
  let raw = readFileSync(filePath, 'utf-8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // strip BOM
  return JSON.parse(raw);
}

/**
 * Read the shared providers file and inject them into a runtime config object.
 *
 * @param {object} config - Parsed JSON config object (e.g., from a template)
 * @returns {object} - The config object with providers merged in (mutated)
 */
export function injectProviders(config) {
  if (!config) return config;
  if (!existsSync(PROVIDERS_PATH)) {
    console.warn('  [WARN] providers.json not found, skipping provider injection');
    return config;
  }
  try {
    const providers = readJsonStripBom(PROVIDERS_PATH);

    // Runtime safety net: merge nvidia models from model-registry.json
    // Prevents "Model not found" when providers.json is stale on disk.
    try {
      let registryData = null;
      for (const rp of REGISTRY_PATHS) {
        if (existsSync(rp)) {
          registryData = readJsonStripBom(rp);
          break;
        }
      }
      if (registryData) {
        const models = registryData.models || registryData;
        if (Array.isArray(models)) {
          const nvidiaModels = providers.nvidia?.models || {};
          let added = 0;
          for (const entry of models) {
            if (entry.id && entry.id.startsWith('nvidia/') && !(entry.id in nvidiaModels)) {
              const derivedName = entry.id.replace('nvidia/', '') + ' (free)';
              nvidiaModels[entry.id] = { name: entry.name || derivedName };
              added++;
            }
          }
          if (!providers.nvidia) providers.nvidia = {};
          providers.nvidia.models = nvidiaModels;
          if (added > 0) {
            console.log(`  [SYNC] Added ${added} nvidia model(s) from registry to providers`);
          }
        }
      }
    } catch (_e) {
      // Registry read is best-effort — don't block provider injection
    }

    config.provider = providers;
  } catch (e) {
    console.warn(`  [WARN] Failed to inject providers: ${e.message}`);
  }
  return config;
}

/**
 * CLI usage: node scripts/lib/inject-providers.mjs <path-to-template.json>
 * Reads the template, injects providers, writes back.
 */
if (process.argv[1] && (process.argv[1] === __filename || process.argv[1].endsWith('inject-providers.mjs'))) {
  const targetPath = process.argv[2];
  if (!targetPath) {
    console.error('Usage: node scripts/lib/inject-providers.mjs <path-to-template.json>');
    process.exit(1);
  }
  if (!existsSync(targetPath)) {
    console.error(`File not found: ${targetPath}`);
    process.exit(1);
  }

  const config = readJsonStripBom(targetPath);
  injectProviders(config);
  writeFileSync(targetPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`Providers injected into ${targetPath}`);
}
