#!/usr/bin/env node

/**
 * Local Model Discovery for Glitch AI
 * 
 * Probes local LM Studio and FreeToken (WSL) endpoints to discover
 * available models and merges them into the freetoken provider config.
 * 
 * Usage: node scripts/discover-local-models.mjs [--persist]
 *   --persist: Write discovered models back to config/providers.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const PROVIDERS_PATH = join(ROOT_DIR, 'config', 'providers.json');
const DISCOVERY_CACHE_PATH = join(ROOT_DIR, 'data', 'local-models-cache.json');

// Endpoint configurations — each backend gets its own provider entry
// because they serve on different ports/URLs.
const ENDPOINTS = [
  {
    name: 'LM Studio',
    backend: 'lmstudio',
    url: 'http://192.168.68.64:1234/v1/models',
    providerBaseURL: 'http://192.168.68.64:1234/v1',
    providerName: 'LM Studio (local)',
    timeout: 3000,
  },
  {
    name: 'FreeToken (WSL)',
    backend: 'freetoken-wsl',
    url: 'http://192.168.68.64:1919/v1/models',
    providerBaseURL: 'http://192.168.68.64:1919/v1',
    providerName: 'FreeToken (WSL)',
    timeout: 3000,
  },
];

/**
 * Read JSON file with BOM handling (PowerShell compatibility)
 */
function readJsonStripBom(filePath) {
  let raw = readFileSync(filePath, 'utf-8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  return JSON.parse(raw);
}

/**
 * Probe a single endpoint for available models
 */
async function probeEndpoint(endpoint) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), endpoint.timeout);
  
  try {
    const response = await fetch(endpoint.url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    
    if (!response.ok) {
      console.log(`  [DISCOVER] ${endpoint.name}: HTTP ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    clearTimeout(timeoutId);
    
    if (!data.data || !Array.isArray(data.data)) {
      console.log(`  [DISCOVER] ${endpoint.name}: Invalid response format`);
      return null;
    }
    
    return data.data.map(model => ({
      id: model.id,
      backend: endpoint.backend,
      last_seen: new Date().toISOString(),
    }));
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.log(`  [DISCOVER] ${endpoint.name}: Timeout after ${endpoint.timeout}ms`);
    } else {
      console.log(`  [DISCOVER] ${endpoint.name}: ${error.message}`);
    }
    return null;
  }
}

/**
 * Load cached models from previous discovery runs
 */
function loadCache() {
  if (!existsSync(DISCOVERY_CACHE_PATH)) {
    return {};
  }
  try {
    const cache = readJsonStripBom(DISCOVERY_CACHE_PATH);
    // Filter out entries older than 7 days
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const filtered = {};
    for (const [key, entry] of Object.entries(cache)) {
      if (new Date(entry.last_seen).getTime() > cutoff) {
        filtered[key] = entry;
      }
    }
    return filtered;
  } catch {
    return {};
  }
}

/**
 * Save discovered models to cache
 */
function saveCache(cache) {
  const dir = dirname(DISCOVERY_CACHE_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(DISCOVERY_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
}

/**
 * Generate a stable model key from model ID and backend
 */
function modelKey(modelId, backend) {
  return `${backend}::${modelId}`;
}

/**
 * Main discovery function
 */
export async function discoverLocalModels() {
  console.log('  [DISCOVER] Probing local model endpoints...');
  
  const cache = loadCache();
  const discovered = {};
  
  // Probe all endpoints in parallel
  const probes = await Promise.allSettled(
    ENDPOINTS.map(endpoint => probeEndpoint(endpoint))
  );
  
  // Process results
  for (let i = 0; i < probes.length; i++) {
    const result = probes[i];
    const endpoint = ENDPOINTS[i];
    
    if (result.status === 'fulfilled' && result.value) {
      const models = result.value;
      console.log(`  [DISCOVER] ${endpoint.name}: Found ${models.length} model(s)`);
      
      for (const model of models) {
        const key = modelKey(model.id, model.backend);
        discovered[key] = {
          ...model,
          first_seen: cache[key]?.first_seen || model.last_seen,
        };
      }
    }
  }
  
  // Merge with cache (preserving older entries)
  const merged = { ...cache, ...discovered };
  saveCache(merged);
  
  // Convert to provider format
  // Key MUST match the model ID returned by /v1/models so OpenCode can
  // resolve context_length and other metadata from the provider config.
  const models = {};
  for (const entry of Object.values(merged)) {
    models[entry.id] = {
      name: entry.id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      limit: {
        context: 32768,
        output: 8192,
      },
      backend: entry.backend,
      last_seen: entry.last_seen,
    };
  }
  
  return models;
}

/**
 * Merge discovered models into providers.json — one provider per backend
 * since each backend serves on a different port/URL.
 */
export function mergeIntoProviders(discoveredModels) {
  if (!existsSync(PROVIDERS_PATH)) {
    console.warn('  [DISCOVER] providers.json not found');
    return false;
  }
  
  const providers = readJsonStripBom(PROVIDERS_PATH);
  
  // Group models by backend
  const byBackend = {};
  for (const [key, model] of Object.entries(discoveredModels)) {
    const backend = model.backend;
    if (!byBackend[backend]) byBackend[backend] = {};
    byBackend[backend][key] = model;
  }
  
  let totalAdded = 0;
  
  for (const endpoint of ENDPOINTS) {
    const backendModels = byBackend[endpoint.backend] || {};
    const providerKey = endpoint.backend;
    
    // Ensure provider exists for this backend
    if (!providers[providerKey]) {
      providers[providerKey] = {
        npm: '@ai-sdk/openai-compatible',
        name: endpoint.providerName,
        options: {
          baseURL: endpoint.providerBaseURL,
        },
        models: {},
      };
    }
    
    const existingModels = providers[providerKey].models || {};
    let added = 0;
    
    for (const [key, model] of Object.entries(backendModels)) {
      if (!(key in existingModels)) {
        existingModels[key] = model;
        added++;
      } else {
        existingModels[key].last_seen = model.last_seen;
      }
    }
    
    providers[providerKey].models = existingModels;
    if (added > 0) {
      console.log(`  [DISCOVER] Added ${added} model(s) to ${providerKey} provider`);
    }
    totalAdded += added;
  }
  
  // Remove legacy single freetoken provider if it exists (migrated to per-backend)
  if (providers.freetoken && !ENDPOINTS.some(e => e.backend === 'freetoken')) {
    // Only remove if empty — don't delete user's manual entries
    const ftModels = providers.freetoken.models || {};
    if (Object.keys(ftModels).length === 0) {
      delete providers.freetoken;
    }
  }
  
  // Write back
  writeFileSync(PROVIDERS_PATH, JSON.stringify(providers, null, 2), 'utf-8');
  console.log(`  [DISCOVER] Total: ${totalAdded} new model(s) across ${ENDPOINTS.length} provider(s)`);
  
  return true;
}

// CLI entry point
if (process.argv[1] === __filename || process.argv[1].endsWith('discover-local-models.mjs')) {
  const persist = process.argv.includes('--persist');
  
  discoverLocalModels().then(models => {
    console.log(`  [DISCOVER] Total discovered: ${Object.keys(models).length} model(s)`);
    
    if (persist) {
      mergeIntoProviders(models);
    } else {
      console.log('  [DISCOVER] Dry run (use --persist to write to providers.json)');
      console.log(JSON.stringify(models, null, 2));
    }
  }).catch(error => {
    console.error('  [DISCOVER] Fatal error:', error);
    process.exit(1);
  });
}