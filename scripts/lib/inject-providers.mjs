#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..', '..');
const PROVIDERS_PATH = join(ROOT_DIR, 'config', 'providers.json');

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
    const providers = JSON.parse(readFileSync(PROVIDERS_PATH, 'utf-8'));
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

  const config = JSON.parse(readFileSync(targetPath, 'utf-8'));
  injectProviders(config);
  writeFileSync(targetPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`Providers injected into ${targetPath}`);
}
