#!/usr/bin/env node

/**
 * Shared one-time migration helper for model-assignments.json.
 *
 * Background: the layered-config refactor moved model-assignments.json from
 * data/ to user/. Existing machines still have the legacy data/ file (gitignored
 * but present on disk). Without migration, the user's saved model assignments
 * would be silently lost because launch/serve/model-ui all read from user/.
 *
 * This helper copies data/model-assignments.json to user/model-assignments.json
 * exactly once per machine: after the copy, user/ exists and the condition is
 * false on every subsequent launch. No separate flag needed.
 *
 * The legacy data/ file is intentionally NOT deleted -- audit-data.mjs flags
 * it for cleanup on its own schedule.
 *
 * Usage:
 *   import { migrateModelAssignments } from './lib/migrate-assignments.mjs';
 *   migrateModelAssignments(ROOT_DIR, log);  // log(color, msg) optional
 */

import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';

const DARK_GREEN = '\x1b[32;2m';
const RESET = '\x1b[0m';

/**
 * Copy legacy data/model-assignments.json to user/model-assignments.json if
 * the user/ file doesn't exist yet. Safe to call on every startup -- it's a
 * no-op once the user/ file exists.
 *
 * @param {string} rootDir  Project root directory (absolute path).
 * @param {function(string, string): void} [log]  Optional logger matching the
 *   caller's color scheme. Signature: log(color, message).
 * @returns {boolean} true if a migration was performed this call.
 */
export function migrateModelAssignments(rootDir, log) {
  const legacyPath = join(rootDir, 'data', 'model-assignments.json');
  const targetPath = join(rootDir, 'user', 'model-assignments.json');

  if (existsSync(targetPath)) return false;
  if (!existsSync(legacyPath)) return false;

  try {
    const userDir = join(rootDir, 'user');
    if (!existsSync(userDir)) mkdirSync(userDir, { recursive: true });
    copyFileSync(legacyPath, targetPath);
    if (typeof log === 'function') {
      log(DARK_GREEN, '  Migrated model assignments from data/ to user/ (one-time)');
    }
    return true;
  } catch {
    // Non-fatal: if the copy fails, the caller will simply see no overrides
    // applied (same behavior as a fresh install with no assignments file).
    return false;
  }
}
