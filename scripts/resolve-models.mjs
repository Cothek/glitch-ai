#!/usr/bin/env node

/**
 * resolve-models.mjs — Model Budget Resolver
 *
 * Reads the model registry (from check-models.ps1) and the user's budget config
 * to resolve the best model for each agent. Detects changes from current
 * assignments in opencode.json and produces a diff for review or auto-apply.
 *
 * Usage:
 *   node scripts/resolve-models.mjs            # resolve + write model-assignment.json
 *   node scripts/resolve-models.mjs --dry-run  # resolve, check, but don't write
 *   node scripts/resolve-models.mjs --status   # quick: exit 0 (no changes) or 1 (changes)
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');

// ---- Paths ----
const REGISTRY_PATH = join(ROOT_DIR, 'data', 'model-registry.json');
const BUDGET_PATH = join(ROOT_DIR, 'user', 'model-budget.json');
const CONFIG_PATH = join(ROOT_DIR, 'opencode.json');
const CONFIG_BAK_PATH = join(ROOT_DIR, 'data', 'backups', 'opencode-pre-resolve.json');
const ASSIGNMENT_PATH = join(ROOT_DIR, 'data', 'model-assignment.json');
const PREF_PATH = join(ROOT_DIR, 'data', 'model-resolver-preference.json');

// ---- Tier ordering (low to high) ----
const TIER_ORDER = ['free', 'budget_paid', 'mid_paid', 'premium_paid'];
const TIER_RANK = Object.fromEntries(TIER_ORDER.map((t, i) => [t, i]));

// ---- Default budget config ----
const DEFAULT_BUDGET = {
  profile: 'balanced',
  agent_defaults: {
    general:     { max_tier: 'free' },
    explore:     { max_tier: 'free' },
    plan:        { max_tier: 'free' },
    build:       { max_tier: 'free' },
    coder:       { max_tier: 'mid_paid' },
    'ui-designer': { max_tier: 'budget_paid' },
    reviewer:    { max_tier: 'mid_paid' },
    testing:     { max_tier: 'budget_paid' },
    vision:      { max_tier: 'free' },
    pentester:   { max_tier: 'budget_paid' },
    'glitch-omni': { max_tier: 'free' }
  },
  overrides: {}
};

// ---- Profile tier overrides ----
const PROFILE_TIERS = {
  economy:     'free',
  balanced:    null,  // use agent_defaults as-is
  performance: 'premium_paid',
  custom:      null   // use agent_defaults + overrides
};

// ---- Helpers ----
function readJson(path, fallback = null) {
  try {
    if (!existsSync(path)) return fallback;
    let raw = readFileSync(path, 'utf-8');
    // Strip UTF-8 BOM (PowerShell 5.1 adds one by default)
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function log(msg, color = '') {
  process.stderr.write(`${color}${msg}\x1b[0m\n`);
}

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DARK_GRAY = '\x1b[90m';

// ---- Default compatible sources (providers we can actually use) ----
const DEFAULT_SOURCES = ['zen', 'go', 'nvidia'];

// ---- Resolve a single agent ----
function resolveAgent(agentName, maxTier, registry, budgetConfig, currentAssignments, compatibleSources = DEFAULT_SOURCES) {
  const override = budgetConfig.overrides?.[agentName];
  const currentModel = currentAssignments?.[agentName] || null;

  // 1. Check exact_model pin
  if (override?.exact_model) {
    const pinned = registry.find(m => m.id === override.exact_model);
    if (pinned) {
      return {
        agent: agentName,
        new_model: pinned.id,
        tier_used: pinned.tier,
        reason: `exact_model pin: ${pinned.id}`
      };
    }
    log(` ${YELLOW}[WARN]${DARK_GRAY} ${agentName}: exact_model '${override.exact_model}' not found in registry, falling back to tier`, DARK_GRAY);
  }

  const maxRank = TIER_RANK[maxTier];
  if (maxRank === undefined) {
    log(` ${YELLOW}[WARN]${DARK_GRAY} ${agentName}: unknown max_tier '${maxTier}', keeping current`, DARK_GRAY);
    return { agent: agentName, new_model: currentModel, tier_used: null, reason: 'unknown tier, unchanged', unchanged: true };
  }

  // 2. Determine capability requirements
  const needsVision = agentName === 'vision';

  // 3. Find all models within tier limit
  //    Start at max tier and work down
  for (let rank = maxRank; rank >= 0; rank--) {
    const tier = TIER_ORDER[rank];
    const candidates = registry.filter(m => {
      if (m.tier !== tier) return false;
      if (m.tier === 'unknown') return false;
      if (needsVision && !m.vision) return false;
      if (!compatibleSources.includes(m.source)) return false;
      return true;
    });

    if (candidates.length === 0) continue;

    // Sort: prefer current model > code-capable (for coder) > larger context > name
    const isCoder = agentName === 'coder';
    candidates.sort((a, b) => {
      // 1. Prefer the currently-assigned model (continuity)
      if (currentModel) {
        if (a.id === currentModel) return -1;
        if (b.id === currentModel) return 1;
      }
      // 2. For @coder, prefer code-capable models
      if (isCoder) {
        const aCode = a.capabilities?.includes?.('code') ?? false;
        const bCode = b.capabilities?.includes?.('code') ?? false;
        if (aCode !== bCode) return bCode - aCode;
      }
      // 3. Prefer larger context length
      const aCtx = a.context_length ?? 0;
      const bCtx = b.context_length ?? 0;
      if (aCtx !== bCtx) return bCtx - aCtx;
      // 4. Stable sort by name
      return a.id.localeCompare(b.id);
    });

    return {
      agent: agentName,
      new_model: candidates[0].id,
      tier_used: tier,
      reason: `tier: ${tier}, best available${needsVision ? ', vision required' : ''}`
    };
  }

  // 4. Nothing found — keep current
  log(` ${YELLOW}[WARN]${DARK_GRAY} ${agentName}: no model found at tier '${maxTier}' or below, keeping current`, DARK_GRAY);
  return { agent: agentName, new_model: currentModel, tier_used: null, reason: 'no model found in tier range', unchanged: true };
}

// ---- Main ----
async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const isStatus = process.argv.includes('--status');

  // Read registry
  const registry = readJson(REGISTRY_PATH, null);
  if (!registry || !registry.models) {
    log(`${RED}[ERROR]${DARK_GRAY} model-registry.json not found or invalid. Run check-models.ps1 first.`, RED);
    process.exit(2);
  }

  // Read budget config (or use defaults)
  const budgetConfig = readJson(BUDGET_PATH, DEFAULT_BUDGET);
  if (!existsSync(BUDGET_PATH)) {
    log(`${DARK_GRAY}[INFO] model-budget.json not found, using defaults`, DARK_GRAY);
  }

  // Read current opencode.json assignments
  const config = readJson(CONFIG_PATH, {});
  const currentAssignments = {};
  if (config.agent) {
    for (const [name, def] of Object.entries(config.agent)) {
      if (def.model) currentAssignments[name] = def.model;
    }
  }

  // Determine effective tier per agent
  const profile = budgetConfig.profile || 'balanced';
  const profileForce = PROFILE_TIERS[profile];
  const agentDefaults = budgetConfig.agent_defaults || DEFAULT_BUDGET.agent_defaults;

  const assignments = {};
  const changes = [];

  // All known agents (union of defaults + current config)
  const allAgents = new Set([
    ...Object.keys(agentDefaults),
    ...Object.keys(currentAssignments)
  ]);

  for (const agentName of allAgents) {
    // Effective max_tier for this agent
    let maxTier;
    const override = budgetConfig.overrides?.[agentName];

    if (override?.exact_model) {
      // exact_model bypasses tier for resolution (handled inside resolveAgent)
      maxTier = 'premium_paid';  // dummy — resolveAgent handles exact_model first
    } else if (profileForce) {
      maxTier = profileForce;
    } else if (override?.max_tier) {
      maxTier = override.max_tier;
    } else if (agentDefaults[agentName]?.max_tier) {
      maxTier = agentDefaults[agentName].max_tier;
    } else {
      // Agent not in config — skip
      continue;
    }

    const includeOpenRouter = process.argv.includes('--include-openrouter');
    const sources = includeOpenRouter ? [...DEFAULT_SOURCES, 'openrouter'] : DEFAULT_SOURCES;
    const result = resolveAgent(agentName, maxTier, registry.models, budgetConfig, currentAssignments, sources);
    assignments[agentName] = result.new_model;

    if (!result.unchanged && result.new_model !== currentAssignments[agentName]) {
      changes.push({
        agent: agentName,
        old_model: currentAssignments[agentName] || null,
        new_model: result.new_model,
        reason: result.reason
      });
    }
  }

  // ---- Output ----
  const output = {
    resolved_at: new Date().toISOString(),
    profile_used: profile,
    has_changes: changes.length > 0,
    changes,
    assignments
  };

  if (isStatus) {
    process.exit(changes.length > 0 ? 1 : 0);
  }

  if (isDryRun) {
    log(`\n${CYAN} Resolver Dry Run${DARK_GRAY}`);
    log(` Profile: ${profile}${DARK_GRAY}`);
    log(` Registry: ${registry.models.length} models${DARK_GRAY}`);
    log(` Agents resolved: ${Object.keys(assignments).length}${DARK_GRAY}`);
    if (changes.length > 0) {
      log(`\n${YELLOW} Changes detected:${DARK_GRAY}`);
      for (const c of changes) {
        log(`   ${YELLOW}@${c.agent}:${DARK_GRAY} ${c.old_model || '(none)'} ${GREEN}->${DARK_GRAY} ${c.new_model}`);
        log(`     ${DARK_GRAY}Reason: ${c.reason}${DARK_GRAY}`);
      }
    } else {
      log(`\n${GREEN} No changes from current assignments${DARK_GRAY}`);
    }
    process.exit(0);
  }

  // ---- --apply: modify opencode.json in place ----
  if (process.argv.includes('--apply')) {
    if (changes.length === 0) {
      log(`\n${GREEN} No changes to apply${DARK_GRAY}`);
      process.exit(0);
    }

    // Backup current config
    const backupDir = dirname(CONFIG_BAK_PATH);
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
    writeFileSync(CONFIG_BAK_PATH, JSON.stringify(config, null, 2), 'utf-8');

    // Apply model changes to config
    for (const c of changes) {
      if (!config.agent[c.agent]) {
        log(` ${YELLOW}[WARN]${DARK_GRAY} Agent @${c.agent} not found in config, creating`, DARK_GRAY);
        config.agent[c.agent] = {};
      }
      config.agent[c.agent].model = c.new_model;
    }

    // Write updated config
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');

    log(`\n${GREEN} Config updated${DARK_GRAY}`);
    for (const c of changes) {
      log(`   @${c.agent}: ${c.old_model || '(none)'} ${GREEN}->${DARK_GRAY} ${c.new_model}`);
    }
    log(` Backup: data/backups/opencode-pre-resolve.json${DARK_GRAY}`);
    process.exit(0);
  }

  // Write assignment file
  const dataDir = dirname(ASSIGNMENT_PATH);
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  writeFileSync(ASSIGNMENT_PATH, JSON.stringify(output, null, 2), 'utf-8');

  log(`\n${CYAN} Model Assignment${DARK_GRAY}`);
  log(` Profile: ${profile}${DARK_GRAY}`);
  if (changes.length > 0) {
    log(` ${YELLOW}${changes.length} change(s) detected${DARK_GRAY}`);
    for (const c of changes) {
      log(`   @${c.agent}: ${c.old_model || '(none)'} ${GREEN}->${DARK_GRAY} ${c.new_model}`);
    }
  } else {
    log(` ${GREEN}No changes from current assignments${DARK_GRAY}`);
  }
  log(` Written to: data/model-assignment.json${DARK_GRAY}`);

  process.exit(0);
}

main().catch(err => {
  log(`${RED}[ERROR]${DARK_GRAY} ${err.message}`, RED);
  process.exit(2);
});
