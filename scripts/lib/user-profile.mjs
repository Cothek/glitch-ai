#!/usr/bin/env node

/**
 * Shared user profile detection module.
 * Centralizes the duplicated user profile detection logic that was in all 4 launch scripts.
 *
 * Exports:
 *   detectUserProfile(rootDir, envVarNames)  -- Find user profile from env vars or auto-detect
 *   buildUserInstructions(rootDir, userName)  -- Build instruction file paths for opencode.json
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

// ===== Color constants =====
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DARK_GRAY = '\x1b[90m';
const DARK_GREEN = '\x1b[32;2m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function log(color, msg) {
  if (msg === undefined) {
    console.log(color);
  } else {
    console.log(`${color}${msg}${RESET}`);
  }
}

/**
 * Detect user profile from env vars or by scanning the user/ directory.
 *
 * @param {string} rootDir  - Project root directory
 * @param {string[]} envVarNames - Array of env var names to check in priority order
 * @returns {{ userName: string|null, userFound: boolean }}
 *   - userName: '' for flat profile (user/main-memory.md), string for subdirectory profile, null for none
 *   - userFound: true if a profile was found
 */
export function detectUserProfile(rootDir, envVarNames = ['GLITCH_USER']) {
  let UserName = null;
  let userFound = false;

  // Step 1: Check env vars
  for (const varName of envVarNames) {
    const val = process.env[varName] || null;
    if (val) {
      UserName = val;
      break;
    }
  }

  if (UserName) {
    const subdirPath = join(rootDir, 'user', UserName);
    if (existsSync(join(subdirPath, 'main-memory.md'))) {
      userFound = true;
      log(CYAN, `  User profile: ${UserName}`);
    } else if (existsSync(join(rootDir, 'user', 'main-memory.md'))) {
      // Env var specified but subdir doesn't exist; fall back to flat profile
      UserName = '';
      userFound = true;
      log(CYAN, '  User profile: (flat -- user/main-memory.md)');
    } else {
      log(YELLOW, `  WARNING: User '${UserName}' specified but no profile found at user/${UserName}`);
      log(YELLOW, `  Run: node setup.mjs --user ${UserName}`);
      UserName = null;
    }
  }

  // Step 2: Auto-detect from user/ directory
  if (!userFound) {
    const userBase = join(rootDir, 'user');
    if (existsSync(join(userBase, 'main-memory.md'))) {
      UserName = '';
      userFound = true;
      log(CYAN, '  User profile: (flat -- user/main-memory.md)');
    } else if (existsSync(userBase)) {
      let profiles;
      try {
        const entries = readdirSync(userBase, { withFileTypes: true });
        profiles = entries
          .filter(e => e.isDirectory())
          .map(e => e.name)
          .filter(name => existsSync(join(userBase, name, 'main-memory.md')));
      } catch {
        profiles = [];
      }

      if (profiles.length === 1) {
        UserName = profiles[0];
        userFound = true;
        log(CYAN, `  User profile: ${UserName}`);
      } else if (profiles.length > 1) {
        log(YELLOW, '  Multiple user profiles found:');
        profiles.forEach((name, i) => {
          log(CYAN, `    [${i + 1}] ${name}`);
        });
        log(DARK_GRAY, '  Set $env:GLITCH_USER=<name> to auto-select.');
        UserName = profiles[0];
        userFound = true;
        log(CYAN, `  Using: ${UserName}`);
      }
    }
  }

  // Step 3: No profile found
  if (!userFound) {
    log(YELLOW, '  No user profile found.');
    log(CYAN, '  Starting with engine defaults (no user profile loaded).');
  }

  return { userName: UserName, userFound };
}

/**
 * Build the user instruction file paths for a detected user profile.
 *
 * @param {string} rootDir  - Project root directory
 * @param {string|null} userName  - User name from detectUserProfile()
 * @returns {string[]} Array of instruction file paths relative to rootDir
 */
export function buildUserInstructions(rootDir, userName) {
  if (userName) {
    // Subdirectory profile: user/<name>/main-memory.md etc.
    return [
      `user/${userName}/main-memory.md`,
      `user/${userName}/current-session.md`,
      `user/${userName}/reminders.md`,
      `user/${userName}/session-dashboard.md`
    ];
  }

  if (userName === '') {
    // Flat profile: user/main-memory.md etc.
    if (existsSync(join(rootDir, 'user', 'main-memory.md'))) {
      return [
        'user/main-memory.md',
        'user/current-session.md',
        'user/reminders.md',
        'user/session-dashboard.md'
      ];
    }
  }

  // No profile
  return [];
}
