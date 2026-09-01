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

// Native NVIDIA model patterns — these need nvidia/ prefix at the NVIDIA API.
// When OpenCode strips the first nvidia/ provider prefix, native models still
// need nvidia/ at the API — so we store them double-prefixed (nvidia/nvidia/...).
const NATIVE_MODEL_PATTERNS = [
  /^nvidia\/nemotron/,
  /^nvidia\/nv-/,
  /^nvidia\/cosmos/,
  /^nvidia\/neva/,
  /^nvidia\/vila/,
  /^nvidia\/llama-.*-nemotron/,
  /^nvidia\/llama3-chatqa/,
  /^nvidia\/meta\//,
  /^nvidia\/moonshotai\//,
  /^nvidia\/google\//,
  /^nvidia\/mistralai\//,
  /^nvidia\/microsoft\//,
  /^nvidia\/openai\//,
  /^nvidia\/nvidia-nemotron/,
  /^nvidia\/ising/,
  /^nvidia\/deepseek-ai\//,
  /^nvidia\/ibm\//,
  /^nvidia\/zyphra\//,
  /^nvidia\/writer\//,
  /^nvidia\/poolside\//,
  /^nvidia\/thinkingmachines\//,
];

function isNativeNvidiaModel(modelId) {
  if (!modelId) return false;
  return NATIVE_MODEL_PATTERNS.some(p => p.test(modelId));
}

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
 * Ensure a nvidia model ID has the correct prefix for OpenCode routing.
 * Native models (nemotron, cosmos, meta/*, etc.) need double prefix
 * (nvidia/nvidia/...) so after OpenCode strips one nvidia/, the API gets nvidia/...
 * Hosted models (minimaxai/*, deepseek-ai/*, etc.) keep single prefix.
 */
function normalizeNvidiaModelId(modelId) {
  if (!modelId || !modelId.startsWith('nvidia/')) return modelId;
  const bare = modelId.replace(/^nvidia\//, '');
  const singleId = `nvidia/${bare}`;
  if (isNativeNvidiaModel(singleId)) {
    // Ensure double prefix for native models
    if (!modelId.startsWith('nvidia/nvidia/')) {
      return `nvidia/${singleId}`;
    }
  }
  return modelId;
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

    // Read registry once — shared by SYNC and CULL steps.
    let registryModels = null;
    let isFresh = false;
    try {
      for (const rp of REGISTRY_PATHS) {
        if (existsSync(rp)) {
          const rd = readJsonStripBom(rp);
          const arr = rd.models || rd;
          if (Array.isArray(arr)) {
            registryModels = arr;
            const generatedAt = rd.generated_at;
            if (generatedAt) {
              const age = Date.now() - new Date(generatedAt).getTime();
              isFresh = !isNaN(age) && age < 48 * 60 * 60 * 1000;
            }
            break;
          }
        }
      }
    } catch (_e) { /* best-effort */ }

    // Runtime safety net: merge nvidia models from model-registry.json
    // Prevents "Model not found" when providers.json is stale on disk.
    try {
      if (registryModels) {
        const nvidiaModels = providers.nvidia?.models || {};
        let added = 0;
        for (const entry of registryModels) {
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
    } catch (_e) {
      // Registry read is best-effort — don't block provider injection
    }

    // Ensure BOTH single and double prefix forms exist for native NVIDIA models.
    // OpenCode may strip the first nvidia/ segment, so the single-prefix form
    // must exist as a lookup key. Native models need the nvidia/ prefix at the
    // NVIDIA API, so they're stored double-prefixed — but the stripped form
    // must also be present for OpenCode's routing to match.
    try {
      const nvidiaModels = providers.nvidia?.models || {};
      let fixed = 0;
      for (const key of Object.keys(nvidiaModels)) {
        if (key.startsWith('nvidia/nvidia/')) {
          // Double-prefixed native model: ensure single-prefix form exists
          const singleForm = key.replace(/^nvidia\/nvidia\//, 'nvidia/');
          if (!(singleForm in nvidiaModels)) {
            nvidiaModels[singleForm] = nvidiaModels[key];
            fixed++;
          }
        } else if (key.startsWith('nvidia/') && !key.startsWith('nvidia/nvidia/')) {
          // Single-prefixed native model: ensure double-prefix form exists
          const normalized = normalizeNvidiaModelId(key);
          if (normalized !== key && !(normalized in nvidiaModels)) {
            nvidiaModels[normalized] = nvidiaModels[key];
            fixed++;
          }
        }
      }
      if (fixed > 0) {
        console.log(`  [FIX] Added ${fixed} mirrored native nvidia model(s) to providers`);
      }
    } catch (_e) {
      // Best-effort fix
    }

// Cull NVIDIA models to only usable free models with context > 0,
        // then deduplicate by display name (keep single-prefix form).
        try {
          const nvidiaModels = providers.nvidia?.models || {};
          if (!registryModels) {
            console.warn('  [CULL] Registry unavailable, skipping cull');
          } else {
            const registryMap = new Map();
            for (const m of registryModels) {
              if (m.id) registryMap.set(m.id, m);
            }

            function findRegistryEntry(key) {
              if (registryMap.has(key)) return registryMap.get(key);
              const singleForm = key.replace(/^nvidia\/nvidia\//, 'nvidia/');
              if (registryMap.has(singleForm)) return registryMap.get(singleForm);
              const bareForm = key.replace(/^nvidia\//, '');
              if (registryMap.has(bareForm)) return registryMap.get(bareForm);
              return null;
            }

            // Critical models allowed to have null context_length (whitelist)
            const CRITICAL_NULL_CONTEXT_MODELS = new Set([
              'nvidia/nvidia/nemotron-3.5-lightning-30b-a3b',
              'nvidia/nemotron-3.5-lightning-30b-a3b',
            ]);

            let culled = 0;
            for (const key of Object.keys(nvidiaModels)) {
              const entry = findRegistryEntry(key);
              if (!entry) {
                if (isFresh) { delete nvidiaModels[key]; culled++; }
                else { console.log(`  [CULL] Stale registry, keeping ${key} (no registry entry)`); }
                continue;
              }
              if (entry.context_length === 0) { delete nvidiaModels[key]; culled++; continue; }
              if (entry.context_length == null) {
                if (CRITICAL_NULL_CONTEXT_MODELS.has(key)) {
                  console.log(`  [CULL] CRITICAL: ${key} has unknown context_length (null), keeping (whitelisted)`);
                } else {
                  console.log(`  [CULL] Removed ${key} (unknown context_length / null)`);
                  delete nvidiaModels[key];
                  culled++;
                  continue;
                }
              }
              if (isFresh && entry.free !== true && entry.tier !== 'free') { delete nvidiaModels[key]; culled++; continue; }
              if (!isFresh && entry.free !== true && entry.tier !== 'free') { console.log(`  [CULL] Stale registry, skipping free check for ${key}`); }
              if (entry.capabilities && !entry.capabilities.includes('text')) { delete nvidiaModels[key]; culled++; continue; }
            }
            if (culled > 0) {
              console.log(`  [CULL] Removed ${culled} unusable nvidia model(s)`);
            }

            // Deduplicate by display name — keep single-prefix form over double-prefix.
            const seenNames = new Map();
            let deduped = 0;
            const keys = Object.keys(nvidiaModels);
            // Sort so single-prefix forms come before double-prefix forms
            keys.sort((a, b) => {
              const aDouble = a.startsWith('nvidia/nvidia/') ? 1 : 0;
              const bDouble = b.startsWith('nvidia/nvidia/') ? 1 : 0;
              return aDouble - bDouble;
            });
            for (const key of keys) {
              const displayName = nvidiaModels[key]?.name || key;
              if (seenNames.has(displayName)) {
                delete nvidiaModels[key];
                deduped++;
              } else {
                seenNames.set(displayName, key);
              }
            }
            if (deduped > 0) {
              console.log(`  [DEDUPE] Removed ${deduped} duplicate nvidia model(s)`);
            }
          }
        } catch (_e) {
          // Best-effort cull+dedupe — never block provider injection
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
