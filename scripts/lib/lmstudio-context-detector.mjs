/**
 * lmstudio-context-detector.mjs
 *
 * Reusable module for detecting context window sizes of models served by
 * LM Studio (and compatible OpenAI-compatible local servers).
 *
 * Detection strategy (in priority order):
 *   1. LM Studio /v1/models metadata — some builds include context_length or n_ctx
 *   2. LM Studio server config file on Windows (%LOCALAPPDATA%\LM Studio\config.json)
 *   3. Binary search via /v1/chat/completions — sends progressively larger dummy
 *      requests until the server rejects or truncates the output.
 *
 * Public API:
 *   detectContextSizes(baseUrl)            → { [modelId]: { context, source } }
 *   probeContextSize(baseUrl, modelId, n)  → boolean
 *   readConfigFile()                       → { config, path } | null
 *   extractContextFromModelMeta(model)     → number | null
 *   getModelsFromApi(baseUrl)              → Array<{ id, ... }>
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Known context sizes for binary search bounds
// ---------------------------------------------------------------------------

const KNOWN_CONTEXT_SIZES = [
  512, 1024, 2048, 4096, 8192, 16384, 24576, 32768,
  49152, 65536, 98304, 131072, 262144, 524288, 1048576,
];

const DEFAULT_CONTEXT = 32768;

// ---------------------------------------------------------------------------
// API: Fetch models from /v1/models
// ---------------------------------------------------------------------------

/**
 * Fetch the list of models from an OpenAI-compatible /v1/models endpoint.
 *
 * @param {string} baseUrl - Base URL (e.g. "http://127.0.0.1:1234")
 * @returns {Promise<Array<{ id: string, [key: string]: unknown }>>}
 */
export async function getModelsFromApi(baseUrl) {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/models`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }

    const data = await res.json();
    clearTimeout(timeoutId);

    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
      return [];
    }

    return data.data;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Strategy 1: Extract context from /v1/models metadata
// ---------------------------------------------------------------------------

/**
 * LM Studio's /v1/models endpoint sometimes includes extra metadata.
 * We check several known field names for the context window size.
 *
 * @param {{ [key: string]: unknown }} model - Model object from /v1/models
 * @returns {number | null}
 */
export function extractContextFromModelMeta(model) {
  if (!model) return null;

  const candidates = [
    'context_length',
    'n_ctx',
    'context_length_max',
    'max_context_length',
    'max_tokens',
    'ctx_length',
  ];

  for (const key of candidates) {
    const val = model[key] ?? model?.metadata?.[key];
    if (typeof val === 'number' && val > 0) {
      return val;
    }
    if (typeof val === 'string') {
      const parsed = parseInt(val, 10);
      if (parsed > 0) return parsed;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Strategy 2: Read LM Studio config file (Windows)
// ---------------------------------------------------------------------------

/**
 * Return candidate paths for the LM Studio server config file.
 *
 * @returns {string[]}
 */
export function getLmStudioConfigPaths() {
  const localAppData = process.env.LOCALAPPDATA;
  const appData = process.env.APPDATA;

  const candidates = [];

  if (localAppData) {
    candidates.push(resolve(localAppData, 'LM Studio', 'config.json'));
    candidates.push(resolve(localAppData, 'LM Studio', 'lm-studio', 'config.json'));
  }
  if (appData) {
    candidates.push(resolve(appData, 'LM Studio', 'config.json'));
  }

  return candidates;
}

/**
 * Read and parse the LM Studio config file from disk.
 *
 * @returns {{ config: object, path: string } | null}
 */
export function readConfigFile() {
  const paths = getLmStudioConfigPaths();

  for (const configPath of paths) {
    if (!existsSync(configPath)) continue;

    try {
      const raw = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw.replace(/^\uFEFF/, ''));
      return { config, path: configPath };
    } catch {
      // skip unparseable files
    }
  }

  return null;
}

/**
 * Extract n_ctx from a parsed LM Studio config.
 * The config structure varies by version — check common locations.
 *
 * @param {object} config - Parsed LM Studio config JSON
 * @returns {number | null}
 */
export function extractNctxFromConfig(config) {
  if (!config) return null;

  if (typeof config.n_ctx === 'number') return config.n_ctx;
  if (config.server?.n_ctx) return config.server.n_ctx;
  if (config.settings?.n_ctx) return config.settings.n_ctx;

  if (Array.isArray(config.loadedModels)) {
    for (const m of config.loadedModels) {
      if (typeof m.n_ctx === 'number') return m.n_ctx;
      if (typeof m.contextLength === 'number') return m.contextLength;
    }
  }

  if (config.model && typeof config.model === 'object') {
    if (typeof config.model.n_ctx === 'number') return config.model.n_ctx;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Strategy 3: Binary search via chat completions
// ---------------------------------------------------------------------------

/**
 * Generate a dummy message of approximately `approxTokens` tokens.
 * Rough approximation: 1 token ≈ 4 characters in English.
 *
 * @param {number} approxTokens
 * @returns {string}
 */
function generateDummyMessage(approxTokens) {
  const charCount = approxTokens * 4;
  return 'word '.repeat(Math.ceil(charCount / 5)).slice(0, charCount);
}

/**
 * Try sending a chat completion request with a message of the given size.
 * Returns true if the server accepted it, false otherwise.
 *
 * @param {string} baseUrl
 * @param {string} modelName
 * @param {number} tokenCount
 * @returns {Promise<boolean>}
 */
export async function probeContextSize(baseUrl, modelName, tokenCount) {
  const prompt = generateDummyMessage(tokenCount);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1,
        temperature: 0,
      }),
    });

    clearTimeout(timeoutId);

    if (res.ok) return true;
    if (res.status === 400 || res.status === 422) return false;

    return false;
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
}

/**
 * Binary search across known context sizes to find the actual limit.
 * Returns the largest size the server accepted, or null if indeterminate.
 *
 * @param {string} baseUrl
 * @param {string} modelName
 * @returns {Promise<number | null>}
 */
export async function binarySearchContext(baseUrl, modelName) {
  // Quick check: does the smallest size work?
  if (!(await probeContextSize(baseUrl, modelName, KNOWN_CONTEXT_SIZES[0]))) {
    return null;
  }

  // Quick check: does the largest size work?
  if (await probeContextSize(baseUrl, modelName, KNOWN_CONTEXT_SIZES[KNOWN_CONTEXT_SIZES.length - 1])) {
    return KNOWN_CONTEXT_SIZES[KNOWN_CONTEXT_SIZES.length - 1];
  }

  let lowIdx = 0;
  let highIdx = KNOWN_CONTEXT_SIZES.length - 1;

  while (lowIdx < highIdx - 1) {
    const midIdx = Math.floor((lowIdx + highIdx) / 2);
    const accepted = await probeContextSize(baseUrl, modelName, KNOWN_CONTEXT_SIZES[midIdx]);

    if (accepted) {
      lowIdx = midIdx;
    } else {
      highIdx = midIdx;
    }
  }

  return KNOWN_CONTEXT_SIZES[lowIdx];
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Detect context sizes for all models available at the given LM Studio endpoint.
 *
 * Uses a three-tier strategy: API metadata → config file → binary search.
 * Falls back to DEFAULT_CONTEXT (32768) if all strategies fail.
 *
 * @param {string} baseUrl - Base URL of the LM Studio server (e.g. "http://127.0.0.1:1234")
 * @returns {Promise<{ [modelId: string]: { context: number, source: string } }>}
 */
export async function detectContextSizes(baseUrl) {
  const cleanUrl = baseUrl.replace(/\/+$/, '');

  // Step 1: Fetch models from API
  let apiModels = [];
  try {
    apiModels = await getModelsFromApi(cleanUrl);
  } catch {
    // Server unreachable — try config-file-only path
  }

  const results = {};

  // Step 2a: Try metadata from /v1/models
  for (const model of apiModels) {
    const ctx = extractContextFromModelMeta(model);
    if (ctx) {
      results[model.id] = { context: ctx, source: 'metadata' };
    }
  }

  // Step 2b: Try LM Studio config file for models still without context
  const unknownFromApi = apiModels.filter(m => !results[m.id]);
  if (unknownFromApi.length > 0) {
    const configResult = readConfigFile();
    if (configResult) {
      const nctx = extractNctxFromConfig(configResult.config);
      if (nctx) {
        for (const model of unknownFromApi) {
          results[model.id] = { context: nctx, source: 'config_file' };
        }
      }
    }
  }

  // Step 2c: Binary search fallback for any still-unknown models
  const unknownModels = apiModels.filter(m => !results[m.id]);
  if (unknownModels.length > 0 && apiModels.length > 0) {
    for (const model of unknownModels) {
      const ctx = await binarySearchContext(cleanUrl, model.id);
      results[model.id] = {
        context: ctx || DEFAULT_CONTEXT,
        source: ctx ? 'binary_search' : 'default_fallback',
      };
    }
  }

  // Ensure all models have an entry (even if API returned nothing but config had data)
  // This covers the case where the server is down but we have cached entries.
  return results;
}
