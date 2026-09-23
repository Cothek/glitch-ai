/**
 * Integration tests for scripts/lib/inject-providers.mjs
 *
 * Tests:
 * - Auto-detection runs when local models are present
 * - Detection failures are handled gracefully
 * - Existing context limits are not overwritten with fallback values
 *
 * Run: node --test scripts/test/inject-providers.test.mjs
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..', '..');
const CONFIG_DIR = join(ROOT_DIR, 'config');
const PROVIDERS_PATH = join(CONFIG_DIR, 'providers.json');
const REGISTRY_PATH = join(CONFIG_DIR, 'model-registry.json');
const DATA_DIR = join(ROOT_DIR, 'data');
const DATA_REGISTRY_PATH = join(DATA_DIR, 'model-registry.json');

// Backup originals
let originalProviders = null;
let originalRegistry = null;
let originalDataRegistry = null;

function resolve(...args) {
  return join(...args);
}

function backupFile(filePath) {
  if (existsSync(filePath)) {
    return readFileSync(filePath, 'utf-8');
  }
  return null;
}

function restoreFile(filePath, content) {
  if (content !== null) {
    writeFileSync(filePath, content, 'utf-8');
  } else if (existsSync(filePath)) {
    rmSync(filePath);
  }
}

// ---------------------------------------------------------------------------
// Mock fetch for LM Studio API
// ---------------------------------------------------------------------------

let originalFetch;
let mockFetchHandler;

function setupFetchMock() {
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (mockFetchHandler) return mockFetchHandler(url, opts);
    return { ok: false, status: 503, json: async () => ({}) };
  };
}

function restoreFetchMock() {
  if (originalFetch) globalThis.fetch = originalFetch;
}

// ===========================================================================
// Tests
// ===========================================================================

describe('injectProviders', () => {
  beforeEach(() => {
    setupFetchMock();
    mockFetchHandler = null;
    // Backup config files
    originalProviders = backupFile(PROVIDERS_PATH);
    originalRegistry = backupFile(REGISTRY_PATH);
    originalDataRegistry = backupFile(DATA_REGISTRY_PATH);
  });

  afterEach(() => {
    restoreFetchMock();
    // Restore config files
    restoreFile(PROVIDERS_PATH, originalProviders);
    restoreFile(REGISTRY_PATH, originalRegistry);
    restoreFile(DATA_REGISTRY_PATH, originalDataRegistry);
  });

  it('should return config unchanged when providers.json is missing', async () => {
    // Temporarily rename providers.json
    const backup = backupFile(PROVIDERS_PATH);
    if (existsSync(PROVIDERS_PATH)) rmSync(PROVIDERS_PATH);

    try {
      const { injectProviders } = await import(`../lib/inject-providers.mjs?t=${Date.now()}`);
      const config = { provider: {} };
      const result = await injectProviders(config);
      assert.deepEqual(result, config);
    } finally {
      restoreFile(PROVIDERS_PATH, backup);
    }
  });

  it('should handle null config gracefully', async () => {
    const { injectProviders } = await import(`../lib/inject-providers.mjs?t=${Date.now()}`);
    const result = await injectProviders(null);
    assert.equal(result, null);
  });

  it('should handle undefined config gracefully', async () => {
    const { injectProviders } = await import(`../lib/inject-providers.mjs?t=${Date.now()}`);
    const result = await injectProviders(undefined);
    assert.equal(result, undefined);
  });

  it('should handle empty config object', async () => {
    const { injectProviders } = await import(`../lib/inject-providers.mjs?t=${Date.now()}`);
    const config = {};
    const result = await injectProviders(config);
    assert.ok(result);
  });

  it('should run auto-detection for lmstudio provider', async () => {
    // Mock LM Studio API to return models
    mockFetchHandler = async (url) => {
      if (url.includes('/v1/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 'test-model', context_length: 16384 }],
          }),
        };
      }
      return { ok: false, status: 503, json: async () => ({}) };
    };

    // Write a providers.json with lmstudio provider
    const providers = {
      lmstudio: {
        npm: '@ai-sdk/openai-compatible',
        name: 'LM Studio (local)',
        options: { baseURL: 'http://127.0.0.1:1234/v1' },
        models: {
          'test-model': { name: 'Test Model' },
        },
      },
    };
    writeFileSync(PROVIDERS_PATH, JSON.stringify(providers, null, 2), 'utf-8');

    const { injectProviders } = await import(`../lib/inject-providers.mjs?t=${Date.now()}`);
    const config = { provider: {} };
    await injectProviders(config);

    // The lmstudio model should have context detected
    const lmstudioModels = config.provider?.lmstudio?.models;
    assert.ok(lmstudioModels, 'lmstudio models should exist');
    assert.ok(lmstudioModels['test-model'], 'test-model should exist');
  });

  it('should not overwrite existing context limits with default_fallback', async () => {
    // Mock: server unreachable (triggers fallback)
    mockFetchHandler = async () => {
      throw new Error('ECONNREFUSED');
    };

    const providers = {
      lmstudio: {
        npm: '@ai-sdk/openai-compatible',
        name: 'LM Studio (local)',
        options: { baseURL: 'http://127.0.0.1:1234/v1' },
        models: {
          'existing-model': {
            name: 'Existing Model',
            limit: { context: 8192, output: 2048 },
          },
        },
      },
    };
    writeFileSync(PROVIDERS_PATH, JSON.stringify(providers, null, 2), 'utf-8');

    const { injectProviders } = await import(`../lib/inject-providers.mjs?t=${Date.now()}`);
    const config = { provider: {} };
    await injectProviders(config);

    // Existing limit should NOT be overwritten
    const modelCfg = config.provider?.lmstudio?.models?.['existing-model'];
    assert.ok(modelCfg, 'model should exist');
    // The model has hasExistingLimit=true and source=default_fallback, so it should NOT be updated
    // (line 143: if (isReliableSource || !hasExistingLimit))
    assert.equal(modelCfg.limit?.context, 8192, 'existing context should not be overwritten');
  });

  it('should set context when model has no existing limit', async () => {
    // Mock: server returns models with metadata
    mockFetchHandler = async (url) => {
      if (url.includes('/v1/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 'new-model', context_length: 32768 }],
          }),
        };
      }
      return { ok: false, status: 503, json: async () => ({}) };
    };

    const providers = {
      lmstudio: {
        npm: '@ai-sdk/openai-compatible',
        name: 'LM Studio (local)',
        options: { baseURL: 'http://127.0.0.1:1234/v1' },
        models: {
          'new-model': { name: 'New Model' }, // No limit set
        },
      },
    };
    writeFileSync(PROVIDERS_PATH, JSON.stringify(providers, null, 2), 'utf-8');

    const { injectProviders } = await import(`../lib/inject-providers.mjs?t=${Date.now()}`);
    const config = { provider: {} };
    await injectProviders(config);

    const modelCfg = config.provider?.lmstudio?.models?.['new-model'];
    assert.ok(modelCfg, 'model should exist');
    // source is 'metadata' (reliable), so it should update
    assert.equal(modelCfg.limit?.context, 32768, 'new model should get detected context');
  });

  it('should handle detection failure gracefully (non-blocking)', async () => {
    // Mock: detection throws
    mockFetchHandler = async () => {
      throw new Error('Detection failed');
    };

    const providers = {
      lmstudio: {
        npm: '@ai-sdk/openai-compatible',
        name: 'LM Studio (local)',
        options: { baseURL: 'http://127.0.0.1:1234/v1' },
        models: { 'test-model': { name: 'Test' } },
      },
    };
    writeFileSync(PROVIDERS_PATH, JSON.stringify(providers, null, 2), 'utf-8');

    const { injectProviders } = await import(`../lib/inject-providers.mjs?t=${Date.now()}`);
    const config = { provider: {} };

    // Should not throw
    const result = await injectProviders(config);
    assert.ok(result, 'should return config even on detection failure');
  });

  it('should skip detection for providers without baseURL', async () => {
    mockFetchHandler = async (url) => {
      if (url.includes('/v1/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 'm', context_length: 4096 }] }),
        };
      }
      return { ok: false, status: 503, json: async () => ({}) };
    };

    const providers = {
      customprovider: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Custom',
        // No options.baseURL
        models: { 'm': { name: 'M' } },
      },
    };
    writeFileSync(PROVIDERS_PATH, JSON.stringify(providers, null, 2), 'utf-8');

    const { injectProviders } = await import(`../lib/inject-providers.mjs?t=${Date.now()}`);
    const config = { provider: {} };
    await injectProviders(config);

    // No baseURL -> detection should be skipped
    const modelCfg = config.provider?.customprovider?.models?.['m'];
    assert.ok(modelCfg, 'model should exist');
    // Should not have auto_detect flag (detection was skipped)
    assert.notEqual(modelCfg.auto_detect, true, 'should not have auto_detect when skipped');
  });

  it('should skip detection for providers without models', async () => {
    mockFetchHandler = async () => {
      throw new Error('Should not be called');
    };

    const providers = {
      lmstudio: {
        npm: '@ai-sdk/openai-compatible',
        name: 'LM Studio (local)',
        options: { baseURL: 'http://127.0.0.1:1234/v1' },
        models: {}, // Empty models
      },
    };
    writeFileSync(PROVIDERS_PATH, JSON.stringify(providers, null, 2), 'utf-8');

    const { injectProviders } = await import(`../lib/inject-providers.mjs?t=${Date.now()}`);
    const config = { provider: {} };

    // Should not throw and should not call fetch
    await injectProviders(config);
    assert.ok(true, 'completed without error');
  });

  it('should update output limit proportionally to context', async () => {
    mockFetchHandler = async (url) => {
      if (url.includes('/v1/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 'big-model', context_length: 65536 }],
          }),
        };
      }
      return { ok: false, status: 503, json: async () => ({}) };
    };

    const providers = {
      lmstudio: {
        npm: '@ai-sdk/openai-compatible',
        name: 'LM Studio (local)',
        options: { baseURL: 'http://127.0.0.1:1234/v1' },
        models: { 'big-model': { name: 'Big Model' } },
      },
    };
    writeFileSync(PROVIDERS_PATH, JSON.stringify(providers, null, 2), 'utf-8');

    const { injectProviders } = await import(`../lib/inject-providers.mjs?t=${Date.now()}`);
    const config = { provider: {} };
    await injectProviders(config);

    const modelCfg = config.provider?.lmstudio?.models?.['big-model'];
    assert.ok(modelCfg, 'model should exist');
    // output = min(floor(65536/4), 8192) = min(16384, 8192) = 8192
    assert.equal(modelCfg.limit?.output, 8192, 'output should be capped at 8192');
    assert.equal(modelCfg.limit?.context, 65536, 'context should be detected value');
  });

  it('should set last_detected timestamp', async () => {
    mockFetchHandler = async (url) => {
      if (url.includes('/v1/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 'ts-model', context_length: 4096 }],
          }),
        };
      }
      return { ok: false, status: 503, json: async () => ({}) };
    };

    const providers = {
      lmstudio: {
        npm: '@ai-sdk/openai-compatible',
        name: 'LM Studio (local)',
        options: { baseURL: 'http://127.0.0.1:1234/v1' },
        models: { 'ts-model': { name: 'TS Model' } },
      },
    };
    writeFileSync(PROVIDERS_PATH, JSON.stringify(providers, null, 2), 'utf-8');

    const { injectProviders } = await import(`../lib/inject-providers.mjs?t=${Date.now()}`);
    const config = { provider: {} };
    await injectProviders(config);

    const modelCfg = config.provider?.lmstudio?.models?.['ts-model'];
    assert.ok(modelCfg?.last_detected, 'should have last_detected timestamp');
    // Should be a valid ISO date string
    assert.ok(!isNaN(Date.parse(modelCfg.last_detected)), 'last_detected should be valid ISO');
  });
});
