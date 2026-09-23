/**
 * CLI tests for scripts/detect-lmstudio-context.mjs
 *
 * Tests:
 * - --apply-if-changes flag works correctly (JSON output)
 * - JSON output format is correct
 * - Graceful handling when config file is missing
 *
 * Run: node --test scripts/test/detect-lmstudio-context.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const SCRIPT = join(ROOT_DIR, 'scripts', 'detect-lmstudio-context.mjs');
const CONFIG_DIR = join(ROOT_DIR, 'config');
const CONFIG_PATH = join(CONFIG_DIR, 'opencode-local.json');
const NODE = join(ROOT_DIR, 'data', 'node', 'node.exe');

// Use system node if bundled not available
const NODE_BIN = existsSync(NODE) ? NODE : 'node';

// Backup and restore config
let originalConfig = null;

function backupConfig() {
  if (existsSync(CONFIG_PATH)) {
    originalConfig = readFileSync(CONFIG_PATH, 'utf-8');
  }
}

function restoreConfig() {
  if (originalConfig !== null) {
    writeFileSync(CONFIG_PATH, originalConfig, 'utf-8');
  } else if (existsSync(CONFIG_PATH)) {
    rmSync(CONFIG_PATH);
  }
}

function runDetectScript(args = [], opts = {}) {
  try {
    const stdout = execFileSync(NODE_BIN, [SCRIPT, ...args], {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...opts,
    });
    return { success: true, stdout: stdout.trim(), stderr: '' };
  } catch (e) {
    return {
      success: false,
      stdout: (e.stdout || '').toString().trim(),
      stderr: (e.stderr || '').toString().trim(),
      status: e.status,
    };
  }
}

// ===========================================================================
// Tests
// ===========================================================================

describe('detect-lmstudio-context CLI', () => {
  beforeEach(() => {
    backupConfig();
  });

  afterEach(() => {
    restoreConfig();
  });

  // -----------------------------------------------------------------------
  // --help
  // -----------------------------------------------------------------------

  it('should show help with --help flag', () => {
    const result = runDetectScript(['--help']);
    assert.ok(result.stdout.includes('detect-lmstudio-context'), 'should include script name');
    assert.ok(result.stdout.includes('--dry-run'), 'should mention --dry-run');
    assert.ok(result.stdout.includes('--apply-if-changes'), 'should mention --apply-if-changes');
    assert.ok(result.stdout.includes('--base-url'), 'should mention --base-url');
  });

  // -----------------------------------------------------------------------
  // --apply-if-changes with no config file
  // -----------------------------------------------------------------------

  it('should handle missing config file gracefully', () => {
    // Remove config file temporarily
    if (existsSync(CONFIG_PATH)) rmSync(CONFIG_PATH);

    const result = runDetectScript(['--apply-if-changes']);
    // Parse JSON output
    assert.ok(result.stdout, 'should have stdout output');
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (e) {
      assert.fail(`stdout is not valid JSON: ${result.stdout}`);
    }

    // When config is missing AND LM Studio is not running:
    // detectContextSizes returns empty, changeCount=0 → status='no_changes'
    // The configExists field correctly reports false
    assert.equal(parsed.configExists, false, 'configExists should be false');
    assert.ok(parsed.configPath, 'should have configPath');
    assert.equal(typeof parsed.changeCount, 'number', 'should have numeric changeCount');
    // Status is either skipped_no_config or no_changes depending on whether
    // detectContextSizes finds any models (it won't if LM Studio is down)
    assert.ok(
      ['skipped_no_config', 'no_changes'].includes(parsed.status),
      `status should be skipped_no_config or no_changes, got: ${parsed.status}`
    );
  });

  // -----------------------------------------------------------------------
  // --apply-if-changes with valid config (no changes needed)
  // -----------------------------------------------------------------------

  it('should return no_changes when context is already correct', () => {
    // Write a config that matches what detection would find
    // (LM Studio may not be running, so detection finds nothing -> no_changes)
    const config = {
      provider: {
        lmstudio: {
          npm: '@ai-sdk/openai-compatible',
          name: 'LM Studio (local)',
          options: { baseURL: 'http://127.0.0.1:1234/v1' },
          models: {},
        },
      },
    };
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4), 'utf-8');

    const result = runDetectScript(['--apply-if-changes']);
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (e) {
      assert.fail(`stdout is not valid JSON: ${result.stdout}`);
    }

    // When LM Studio is not running, detectContextSizes returns empty
    // So no changes are needed
    assert.equal(parsed.status, 'no_changes', 'status should be no_changes');
    assert.equal(parsed.changeCount, 0, 'changeCount should be 0');
    assert.ok(parsed.models, 'should have models object');
    assert.ok(parsed.configPath, 'should have configPath');
  });

  // -----------------------------------------------------------------------
  // JSON output format validation
  // -----------------------------------------------------------------------

  it('should produce valid JSON with all required fields', () => {
    // Ensure config exists for this test
    const config = {
      provider: {
        lmstudio: {
          npm: '@ai-sdk/openai-compatible',
          name: 'LM Studio (local)',
          options: { baseURL: 'http://127.0.0.1:1234/v1' },
          models: {},
        },
      },
    };
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4), 'utf-8');

    const result = runDetectScript(['--apply-if-changes']);
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (e) {
      assert.fail(`stdout is not valid JSON: ${result.stdout}`);
    }

    // Required fields
    assert.ok('status' in parsed, 'should have status field');
    assert.ok('changeCount' in parsed, 'should have changeCount field');
    assert.ok('models' in parsed, 'should have models field');
    assert.ok('changes' in parsed, 'should have changes field');
    assert.ok('configPath' in parsed, 'should have configPath field');
    assert.ok('configExists' in parsed, 'should have configExists field');

    // status should be one of the known values
    const validStatuses = ['applied', 'no_changes', 'skipped_no_config', 'skipped', 'error'];
    assert.ok(validStatuses.includes(parsed.status), `status '${parsed.status}' should be one of: ${validStatuses.join(', ')}`);
  });

  // -----------------------------------------------------------------------
  // --base-url flag
  // -----------------------------------------------------------------------

  it('should accept --base-url flag', () => {
    const result = runDetectScript(['--apply-if-changes', '--base-url', 'http://192.168.1.100:1234']);
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (e) {
      assert.fail(`stdout is not valid JSON: ${result.stdout}`);
    }
    // Should complete without error (even if URL is unreachable)
    assert.ok(parsed.status, 'should have a status');
  });

  // -----------------------------------------------------------------------
  // Unknown arguments
  // -----------------------------------------------------------------------

  it('should fail on unknown arguments', () => {
    const result = runDetectScript(['--unknown-flag']);
    assert.equal(result.success, false, 'should fail on unknown argument');
    assert.ok(result.stderr.includes('Unknown argument') || result.status !== 0,
      'should report unknown argument');
  });

  // -----------------------------------------------------------------------
  // --dry-run (non-JSON mode)
  // -----------------------------------------------------------------------

  it('should not write file in --dry-run mode', () => {
    // Write a config file
    const config = {
      provider: {
        lmstudio: {
          models: { 'test-model': { name: 'Test', limit: { context: 1024 } } },
        },
      },
    };
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4), 'utf-8');

    const result = runDetectScript(['--dry-run']);
    // Check that the file was NOT modified (dry run)
    const afterConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    assert.equal(
      afterConfig.provider?.lmstudio?.models?.['test-model']?.limit?.context,
      1024,
      'config should not be modified in dry-run mode'
    );
  });

  // -----------------------------------------------------------------------
  // JSON parse error in config
  // -----------------------------------------------------------------------

  it('should report error when config file has invalid JSON', () => {
    // Write invalid JSON
    writeFileSync(CONFIG_PATH, '{ invalid json {{{', 'utf-8');

    const result = runDetectScript(['--apply-if-changes']);
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (e) {
      assert.fail(`stdout is not valid JSON: ${result.stdout}`);
    }

    assert.equal(parsed.status, 'error', 'status should be error');
    assert.ok(parsed.error, 'should have error message');
    assert.equal(parsed.configExists, true, 'configExists should be true');
  });
});
