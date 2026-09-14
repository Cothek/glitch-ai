#!/usr/bin/env node

/**
 * Ensure Local Model - Ad-hoc refresh of local model discovery
 * 
 * This script can be called independently to refresh the local model list
 * without requiring a full Glitch restart.
 * 
 * Usage: node scripts/ensure-local-model.mjs [--force]
 *   --force: Force refresh even if cache is fresh
 */

import { discoverLocalModels, mergeIntoProviders } from './discover-local-models.mjs';

async function main() {
  const force = process.argv.includes('--force');
  
  console.log('[ensure-local-model] Starting local model discovery...');
  
  try {
    const models = await discoverLocalModels();
    const count = Object.keys(models).length;
    
    if (count === 0) {
      console.log('[ensure-local-model] No local models discovered');
      console.log('[ensure-local-model] Ensure LM Studio or FreeToken is running on port 1919');
      return;
    }
    
    console.log(`[ensure-local-model] Discovered ${count} model(s):`);
    for (const [key, model] of Object.entries(models)) {
      console.log(`  - ${key} (${model.backend}, last seen: ${model.last_seen})`);
    }
    
    // Persist to providers.json
    mergeIntoProviders(models);
    console.log('[ensure-local-model] Updated config/providers.json');
    
  } catch (error) {
    console.error('[ensure-local-model] Error:', error.message);
    process.exit(1);
  }
}

main();