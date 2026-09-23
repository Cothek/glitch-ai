/**
 * Unit tests for scripts/lib/lmstudio-context-detector.mjs
 *
 * Uses Node.js built-in test runner (node:test + node:assert).
 * Run: node --test scripts/test/lmstudio-context-detector.test.mjs
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Test helpers: mock fetch globally before importing the module
// ---------------------------------------------------------------------------

let originalFetch;
let mockFetchResponses;

function setupFetchMock() {
  originalFetch = globalThis.fetch;
  mockFetchResponses = [];
  globalThis.fetch = async (url, opts) => {
    const resp = mockFetchResponses.shift();
    if (!resp) throw new Error(`No mock response for ${url}`);
    if (resp.error) throw resp.error;
    return {
      ok: resp.ok ?? true,
      status: resp.status ?? 200,
      json: async () => resp.body,
      headers: new Map(),
    };
  };
}

function restoreFetchMock() {
  if (originalFetch) globalThis.fetch = originalFetch;
}

// ---------------------------------------------------------------------------
// Import the functions under test (fresh import after mock setup)
// ---------------------------------------------------------------------------

let detector;

async function loadModule() {
  // Dynamic import so we can mock fetch before module initialization
  // Use a cache-busting query string to bypass Node's module cache
  const mod = await import(`../lib/lmstudio-context-detector.mjs?t=${Date.now()}`);
  detector = mod;
}

// ===========================================================================
// extractContextFromModelMeta
// ===========================================================================

describe('extractContextFromModelMeta', () => {
  it('should return context_length when present as a number', async () => {
    await loadModule();
    const result = detector.extractContextFromModelMeta({ context_length: 8192 });
    assert.equal(result, 8192);
  });

  it('should return n_ctx when present as a number', async () => {
    await loadModule();
    const result = detector.extractContextFromModelMeta({ n_ctx: 4096 });
    assert.equal(result, 4096);
  });

  it('should return context_length_max when present', async () => {
    await loadModule();
    const result = detector.extractContextFromModelMeta({ context_length_max: 16384 });
    assert.equal(result, 16384);
  });

  it('should return max_context_length when present', async () => {
    await loadModule();
    const result = detector.extractContextFromModelMeta({ max_context_length: 32768 });
    assert.equal(result, 32768);
  });

  it('should return max_tokens when present', async () => {
    await loadModule();
    const result = detector.extractContextFromModelMeta({ max_tokens: 65536 });
    assert.equal(result, 65536);
  });

  it('should return ctx_length when present', async () => {
    await loadModule();
    const result = detector.extractContextFromModelMeta({ ctx_length: 24576 });
    assert.equal(result, 24576);
  });

  it('should parse context_length from a string', async () => {
    await loadModule();
    const result = detector.extractContextFromModelMeta({ context_length: '12288' });
    assert.equal(result, 12288);
  });

  it('should check metadata sub-object for context fields', async () => {
    await loadModule();
    const result = detector.extractContextFromModelMeta({
      metadata: { context_length: 49152 },
    });
    assert.equal(result, 49152);
  });

  it('should check metadata.n_ctx', async () => {
    await loadModule();
    const result = detector.extractContextFromModelMeta({
      metadata: { n_ctx: 8192 },
    });
    assert.equal(result, 8192);
  });

  it('should prefer top-level over metadata fields', async () => {
    await loadModule();
    const result = detector.extractContextFromModelMeta({
      context_length: 8192,
      metadata: { context_length: 16384 },
    });
    assert.equal(result, 8192);
  });

  it('should return null for empty object', async () => {
    await loadModule();
    const result = detector.extractContextFromModelMeta({});
    assert.equal(result, null);
  });

  it('should return null for null model (BUG: crashes on null)', async () => {
    await loadModule();
    // BUG: extractContextFromModelMeta does not guard against null input.
    // model[key] throws TypeError when model is null.
    // Expected behavior: return null (no context found).
    assert.throws(
      () => detector.extractContextFromModelMeta(null),
      TypeError,
      'Source bug: extractContextFromModelMeta crashes on null input'
    );
  });

  it('should return null for zero values', async () => {
    await loadModule();
    const result = detector.extractContextFromModelMeta({ context_length: 0 });
    assert.equal(result, null);
  });

  it('should return null for negative values', async () => {
    await loadModule();
    const result = detector.extractContextFromModelMeta({ context_length: -100 });
    assert.equal(result, null);
  });

  it('should return null for non-numeric strings', async () => {
    await loadModule();
    const result = detector.extractContextFromModelMeta({ context_length: 'not-a-number' });
    assert.equal(result, null);
  });

  it('should return null for boolean values', async () => {
    await loadModule();
    const result = detector.extractContextFromModelMeta({ context_length: true });
    assert.equal(result, null);
  });

  it('should return null for array values', async () => {
    await loadModule();
    const result = detector.extractContextFromModelMeta({ context_length: [8192] });
    assert.equal(result, null);
  });

  it('should return null for object values', async () => {
    await loadModule();
    const result = detector.extractContextFromModelMeta({ context_length: { value: 8192 } });
    assert.equal(result, null);
  });

  it('should handle models with many fields but no context', async () => {
    await loadModule();
    const result = detector.extractContextFromModelMeta({
      id: 'test-model',
      object: 'model',
      owned_by: 'test',
      created: 1234567890,
    });
    assert.equal(result, null);
  });
});

// ===========================================================================
// extractNctxFromConfig
// ===========================================================================

describe('extractNctxFromConfig', () => {
  it('should extract n_ctx from top-level', async () => {
    await loadModule();
    const result = detector.extractNctxFromConfig({ n_ctx: 4096 });
    assert.equal(result, 4096);
  });

  it('should extract n_ctx from server.n_ctx', async () => {
    await loadModule();
    const result = detector.extractNctxFromConfig({ server: { n_ctx: 8192 } });
    assert.equal(result, 8192);
  });

  it('should extract n_ctx from settings.n_ctx', async () => {
    await loadModule();
    const result = detector.extractNctxFromConfig({ settings: { n_ctx: 16384 } });
    assert.equal(result, 16384);
  });

  it('should extract n_ctx from loadedModels array (n_ctx field)', async () => {
    await loadModule();
    const result = detector.extractNctxFromConfig({
      loadedModels: [
        { name: 'model-a', n_ctx: 4096 },
        { name: 'model-b', n_ctx: 8192 },
      ],
    });
    assert.equal(result, 4096); // First match
  });

  it('should extract contextLength from loadedModels array', async () => {
    await loadModule();
    const result = detector.extractNctxFromConfig({
      loadedModels: [{ name: 'model-a', contextLength: 16384 }],
    });
    assert.equal(result, 16384);
  });

  it('should extract n_ctx from model.n_ctx', async () => {
    await loadModule();
    const result = detector.extractNctxFromConfig({
      model: { n_ctx: 32768 },
    });
    assert.equal(result, 32768);
  });

  it('should prefer top-level over nested', async () => {
    await loadModule();
    const result = detector.extractNctxFromConfig({
      n_ctx: 4096,
      server: { n_ctx: 8192 },
      settings: { n_ctx: 16384 },
    });
    assert.equal(result, 4096);
  });

  it('should return null for empty config', async () => {
    await loadModule();
    const result = detector.extractNctxFromConfig({});
    assert.equal(result, null);
  });

  it('should return null for config with no context fields', async () => {
    await loadModule();
    const result = detector.extractNctxFromConfig({
      theme: 'dark',
      language: 'en',
      loadedModels: [{ name: 'model-a' }],
    });
    assert.equal(result, null);
  });

  it('should return null for empty loadedModels array', async () => {
    await loadModule();
    const result = detector.extractNctxFromConfig({ loadedModels: [] });
    assert.equal(result, null);
  });

  it('should return null for null config (BUG: crashes on null)', async () => {
    await loadModule();
    // BUG: extractNctxFromConfig does not guard against null input.
    // config.n_ctx throws TypeError when config is null.
    // Expected behavior: return null (no context found).
    assert.throws(
      () => detector.extractNctxFromConfig(null),
      TypeError,
      'Source bug: extractNctxFromConfig crashes on null input'
    );
  });

  it('should handle config with loadedModels having mixed fields', async () => {
    await loadModule();
    const result = detector.extractNctxFromConfig({
      loadedModels: [
        { name: 'model-a' }, // no context
        { name: 'model-b', contextLength: 12288 },
      ],
    });
    assert.equal(result, 12288);
  });
});

// ===========================================================================
// probeContextSize (with mocked fetch)
// ===========================================================================

describe('probeContextSize', () => {
  beforeEach(() => {
    setupFetchMock();
  });

  afterEach(() => {
    restoreFetchMock();
  });

  it('should return true when server responds 200', async () => {
    await loadModule();
    mockFetchResponses.push({ ok: true, status: 200, body: { choices: [] } });
    const result = await detector.probeContextSize('http://localhost:1234', 'test-model', 1024);
    assert.equal(result, true);
  });

  it('should return false when server responds 400', async () => {
    await loadModule();
    mockFetchResponses.push({ ok: false, status: 400, body: { error: 'bad request' } });
    const result = await detector.probeContextSize('http://localhost:1234', 'test-model', 1048576);
    assert.equal(result, false);
  });

  it('should return false when server responds 422', async () => {
    await loadModule();
    mockFetchResponses.push({ ok: false, status: 422, body: { error: 'unprocessable' } });
    const result = await detector.probeContextSize('http://localhost:1234', 'test-model', 99999);
    assert.equal(result, false);
  });

  it('should return false when server responds 500', async () => {
    await loadModule();
    mockFetchResponses.push({ ok: false, status: 500, body: { error: 'internal error' } });
    const result = await detector.probeContextSize('http://localhost:1234', 'test-model', 1024);
    assert.equal(result, false);
  });

  it('should return false on network error', async () => {
    await loadModule();
    mockFetchResponses.push({ error: new Error('ECONNREFUSED') });
    const result = await detector.probeContextSize('http://localhost:1234', 'test-model', 1024);
    assert.equal(result, false);
  });

  it('should return false on abort/timeout', async () => {
    await loadModule();
    mockFetchResponses.push({ error: Object.assign(new Error('aborted'), { name: 'AbortError' }) });
    const result = await detector.probeContextSize('http://localhost:1234', 'test-model', 1024);
    assert.equal(result, false);
  });

  it('should strip trailing slashes from baseUrl', async () => {
    await loadModule();
    mockFetchResponses.push({ ok: true, status: 200, body: { choices: [] } });
    const result = await detector.probeContextSize('http://localhost:1234///', 'test-model', 1024);
    assert.equal(result, true);
  });

  it('should send correct request body', async () => {
    await loadModule();
    let capturedBody = null;
    let capturedUrl = null;
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({}) };
    };
    await detector.probeContextSize('http://localhost:1234', 'my-model', 2048);
    assert.equal(capturedUrl, 'http://localhost:1234/v1/chat/completions');
    assert.equal(capturedBody.model, 'my-model');
    assert.equal(capturedBody.max_tokens, 1);
    assert.equal(capturedBody.temperature, 0);
    assert.ok(Array.isArray(capturedBody.messages));
    assert.equal(capturedBody.messages.length, 1);
    assert.equal(capturedBody.messages[0].role, 'user');
  });
});

// ===========================================================================
// binarySearchContext (with mocked fetch)
// ===========================================================================

describe('binarySearchContext', () => {
  beforeEach(() => {
    setupFetchMock();
  });

  afterEach(() => {
    restoreFetchMock();
  });

  it('should find correct context size via binary search', async () => {
    await loadModule();
    // KNOWN_CONTEXT_SIZES = [512, 1024, 2048, 4096, 8192, 16384, 24576, 32768, 49152, 65536, 98304, 131072, 262144, 524288, 1048576]
    // Server accepts up to 32768, rejects above.
    //
    // Binary search trace:
    //   Quick check: probe(512) -> accept, probe(1048576) -> reject
    //   low=0, high=14
    //   mid=7 (32768) -> accept -> low=7
    //   mid=floor((7+14)/2)=10 (98304) -> reject -> high=10
    //   mid=floor((7+10)/2)=8 (49152) -> reject -> high=8
    //   Loop ends (high-low=1), return KNOWN[7] = 32768

    // Responses in order: 512 OK, 1048576 FAIL, 32768 OK, 98304 FAIL, 49152 FAIL
    mockFetchResponses.push({ ok: true, status: 200, body: {} });    // 512 accept (quick check)
    mockFetchResponses.push({ ok: false, status: 400, body: {} });   // 1048576 reject (quick check)
    mockFetchResponses.push({ ok: true, status: 200, body: {} });    // 32768 accept (mid=7)
    mockFetchResponses.push({ ok: false, status: 400, body: {} });   // 98304 reject (mid=10)
    mockFetchResponses.push({ ok: false, status: 400, body: {} });   // 49152 reject (mid=8)

    const result = await detector.binarySearchContext('http://localhost:1234', 'test-model');
    assert.equal(result, 32768);
  });

  it('should return null when server rejects the smallest size', async () => {
    await loadModule();
    // First probe (smallest = 512) fails
    mockFetchResponses.push({ ok: false, status: 400, body: {} });
    const result = await detector.binarySearchContext('http://localhost:1234', 'test-model');
    assert.equal(result, null);
  });

  it('should return largest size when server accepts everything', async () => {
    await loadModule();
    // Smallest OK + largest OK -> return largest
    mockFetchResponses.push({ ok: true, status: 200, body: {} }); // 512 OK
    mockFetchResponses.push({ ok: true, status: 200, body: {} }); // 1048576 OK
    const result = await detector.binarySearchContext('http://localhost:1234', 'test-model');
    assert.equal(result, 1048576);
  });

  it('should handle server always accepting (returns max)', async () => {
    await loadModule();
    mockFetchResponses.push({ ok: true, status: 200, body: {} }); // 512
    mockFetchResponses.push({ ok: true, status: 200, body: {} }); // 1048576
    const result = await detector.binarySearchContext('http://localhost:1234', 'test-model');
    assert.equal(result, 1048576);
  });

  it('should handle server always rejecting (returns null)', async () => {
    await loadModule();
    mockFetchResponses.push({ ok: false, status: 400, body: {} }); // 512 reject
    const result = await detector.binarySearchContext('http://localhost:1234', 'test-model');
    assert.equal(result, null);
  });
});

// ===========================================================================
// getLmStudioConfigPaths
// ===========================================================================

describe('getLmStudioConfigPaths', () => {
  it('should return paths based on LOCALAPPDATA', async () => {
    await loadModule();
    const original = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
    try {
      const paths = detector.getLmStudioConfigPaths();
      assert.ok(paths.length >= 1);
      assert.ok(paths.some(p => p.includes('LM Studio') && p.includes('config.json')));
    } finally {
      if (original !== undefined) process.env.LOCALAPPDATA = original;
      else delete process.env.LOCALAPPDATA;
    }
  });

  it('should return paths based on APPDATA', async () => {
    await loadModule();
    const originalLocal = process.env.LOCALAPPDATA;
    const originalApp = process.env.APPDATA;
    delete process.env.LOCALAPPDATA;
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    try {
      const paths = detector.getLmStudioConfigPaths();
      assert.ok(paths.length >= 1);
      assert.ok(paths.some(p => p.includes('LM Studio') && p.includes('config.json')));
    } finally {
      if (originalLocal !== undefined) process.env.LOCALAPPDATA = originalLocal;
      else delete process.env.LOCALAPPDATA;
      if (originalApp !== undefined) process.env.APPDATA = originalApp;
      else delete process.env.APPDATA;
    }
  });

  it('should return empty array when no env vars set', async () => {
    await loadModule();
    const originalLocal = process.env.LOCALAPPDATA;
    const originalApp = process.env.APPDATA;
    delete process.env.LOCALAPPDATA;
    delete process.env.APPDATA;
    try {
      const paths = detector.getLmStudioConfigPaths();
      assert.ok(Array.isArray(paths));
      // On non-Windows CI, both may be undefined
    } finally {
      if (originalLocal !== undefined) process.env.LOCALAPPDATA = originalLocal;
      if (originalApp !== undefined) process.env.APPDATA = originalApp;
    }
  });
});

// ===========================================================================
// getModelsFromApi (with mocked fetch)
// ===========================================================================

describe('getModelsFromApi', () => {
  beforeEach(() => {
    setupFetchMock();
  });

  afterEach(() => {
    restoreFetchMock();
  });

  it('should return models from valid response', async () => {
    await loadModule();
    mockFetchResponses.push({
      ok: true,
      status: 200,
      body: { data: [{ id: 'model-a' }, { id: 'model-b' }] },
    });
    const models = await detector.getModelsFromApi('http://localhost:1234');
    assert.equal(models.length, 2);
    assert.equal(models[0].id, 'model-a');
    assert.equal(models[1].id, 'model-b');
  });

  it('should return empty array when data field is missing', async () => {
    await loadModule();
    mockFetchResponses.push({ ok: true, status: 200, body: {} });
    const models = await detector.getModelsFromApi('http://localhost:1234');
    assert.deepEqual(models, []);
  });

  it('should return empty array when data is empty', async () => {
    await loadModule();
    mockFetchResponses.push({ ok: true, status: 200, body: { data: [] } });
    const models = await detector.getModelsFromApi('http://localhost:1234');
    assert.deepEqual(models, []);
  });

  it('should throw on HTTP error', async () => {
    await loadModule();
    mockFetchResponses.push({ ok: false, status: 404, body: {} });
    await assert.rejects(
      () => detector.getModelsFromApi('http://localhost:1234'),
      { message: /HTTP 404/ }
    );
  });

  it('should throw on network error', async () => {
    await loadModule();
    mockFetchResponses.push({ error: new Error('ECONNREFUSED') });
    await assert.rejects(
      () => detector.getModelsFromApi('http://localhost:1234'),
      { message: /ECONNREFUSED/ }
    );
  });

  it('should strip trailing slashes from URL', async () => {
    await loadModule();
    let capturedUrl = null;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };
    await detector.getModelsFromApi('http://localhost:1234///');
    assert.equal(capturedUrl, 'http://localhost:1234/v1/models');
  });
});

// ===========================================================================
// detectContextSizes (integration with mocked fetch)
// ===========================================================================

describe('detectContextSizes', () => {
  beforeEach(() => {
    setupFetchMock();
  });

  afterEach(() => {
    restoreFetchMock();
  });

  it('should detect context from metadata when available', async () => {
    await loadModule();
    // getModelsFromApi returns models with metadata
    mockFetchResponses.push({
      ok: true,
      status: 200,
      body: {
        data: [
          { id: 'model-a', context_length: 8192 },
          { id: 'model-b', n_ctx: 4096 },
        ],
      },
    });

    const result = await detector.detectContextSizes('http://localhost:1234');
    assert.equal(result['model-a'].context, 8192);
    assert.equal(result['model-a'].source, 'metadata');
    assert.equal(result['model-b'].context, 4096);
    assert.equal(result['model-b'].source, 'metadata');
  });

  it('should return empty result when API is unreachable', async () => {
    await loadModule();
    mockFetchResponses.push({ error: new Error('ECONNREFUSED') });

    const result = await detector.detectContextSizes('http://localhost:1234');
    assert.deepEqual(result, {});
  });

  it('should return empty result when API returns no models', async () => {
    await loadModule();
    mockFetchResponses.push({ ok: true, status: 200, body: { data: [] } });

    const result = await detector.detectContextSizes('http://localhost:1234');
    assert.deepEqual(result, {});
  });

  it('should handle mix of metadata and non-metadata models', async () => {
    await loadModule();
    // Model with metadata + model without
    mockFetchResponses.push({
      ok: true,
      status: 200,
      body: {
        data: [
          { id: 'model-with-meta', context_length: 16384 },
          { id: 'model-no-meta' },
        ],
      },
    });
    // For model-no-meta: binarySearchContext will be called
    // Smallest probe (512) -> accept
    mockFetchResponses.push({ ok: true, status: 200, body: {} }); // 512 OK
    mockFetchResponses.push({ ok: true, status: 200, body: {} }); // 1048576 OK -> returns max

    const result = await detector.detectContextSizes('http://localhost:1234');
    assert.equal(result['model-with-meta'].context, 16384);
    assert.equal(result['model-with-meta'].source, 'metadata');
    assert.equal(result['model-no-meta'].context, 1048576);
    assert.equal(result['model-no-meta'].source, 'binary_search');
  });
});
