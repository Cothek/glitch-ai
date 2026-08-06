import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REVIEW_PASS_SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'write-review-pass.mjs'
);
const MARKER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', '.review-pass.json'
);

export const DispatchReflexPlugin = async ({ directory, client }) => {
  const lastTaskTime = new Map();
  let pendingReview = false;
  let lastCodeTaskTime = 0;
  let lastReviewTaskTime = 0;

  const CODE_WRITING_AGENTS = new Set([
    'coder', 'coder-paid', 'ui-designer', 'ui-designer-paid',
    'testing', 'testing-paid', 'pentester', 'pentester-paid'
  ]);

  const REVIEW_AGENTS = new Set([
    'reviewer', 'reviewer-paid'
  ]);

  const CODE_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.rb', '.java',
    '.kt', '.swift', '.css', '.scss', '.sass', '.less', '.html', '.vue',
    '.svelte', '.astro', '.mjs', '.cjs', '.mts', '.cts',
    '.bat', '.ps1', '.sh'
  ]);

  const MEMORY_PATHS = [
    'user/',
    'glitch-memorycore/'
  ];

  const CONFIG_FILES = new Set([
    'opencode.json',
    'config/opencode-normal.json',
    'config/opencode-free.json',
    'config/opencode-local.json',
    'config/opencode-safe.json'
  ]);

  const READ_ONLY_BASH_COMMANDS = new Set([
    'git status', 'git diff', 'git log', 'git show', 'git branch',
    'git remote', 'git config', 'ls', 'dir', 'cat', 'type', 'grep',
    'rg', 'find', 'echo', 'pwd', 'whoami', 'date', 'time'
  ]);

  const DESTRUCTIVE_BASH_COMMANDS = new Set([
    'rm ', 'del ', 'remove-item', 'rmdir ', 'rd ', 'deltree',
    'rmdir /s', 'remove-item -recurse'
  ]);

  const GIT_OPERATIONS = new Set([
    'git add', 'git commit', 'git push', 'git pull', 'git fetch',
    'git merge', 'git rebase', 'git checkout', 'git switch',
    'git stash', 'git reset', 'git restore'
  ]);

  function isCodeFile(filePath) {
    const dotIndex = filePath.lastIndexOf('.');
    if (dotIndex === -1) return false;
    const ext = filePath.substring(dotIndex);
    return CODE_EXTENSIONS.has(ext.toLowerCase());
  }

  function isMemoryFile(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    return MEMORY_PATHS.some(path => normalized.startsWith(path)) && normalized.endsWith('.md');
  }

  function isConfigFile(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    return CONFIG_FILES.has(normalized) || normalized.startsWith('config/') && normalized.endsWith('.json');
  }

  function isExemptFile(filePath) {
    return isMemoryFile(filePath) || isConfigFile(filePath);
  }

  function isReadOnlyBashCommand(command) {
    const normalized = command.trim().toLowerCase();
    return READ_ONLY_BASH_COMMANDS.some(cmd => normalized.startsWith(cmd));
  }

  function isGitOperation(command) {
    const normalized = command.trim().toLowerCase();
    return GIT_OPERATIONS.some(cmd => normalized.startsWith(cmd));
  }

  function isDestructiveBashCommand(command) {
    const normalized = command.trim().toLowerCase();
    return DESTRUCTIVE_BASH_COMMANDS.some(cmd => normalized.includes(cmd));
  }

  function shouldBlockBashCommand(command) {
    if (isReadOnlyBashCommand(command)) return false;
    if (isGitOperation(command)) return false;
    return isDestructiveBashCommand(command);
  }

  function getAgentName(input) {
    return input.agent || input.subagent_type || 'unknown';
  }

  function extractResultText(output) {
    if (!output) return '';
    if (typeof output.result === 'string') return output.result;
    if (typeof output === 'string') return output;
    try {
      return JSON.stringify(output);
    } catch {
      return '';
    }
  }

  function isPassVerdict(text) {
    if (!text) return false;
    // Fail signals trump everything ("FIX THEN SHIP" contains "SHIP").
    const fail = /FIX THEN SHIP|FIX AND RESHIP|REJECTED|\bFAILED\b|\bREJECT\b|\bDENIED\b/i.test(text);
    if (fail) return false;
    return /\bPASSED\b|\bPASS\b|\bPROCEED\b|verdict\s*:\s*✅|\bSHIP\b|\bAPPROVED\b/i.test(text);
  }

  function writeReviewPassMarker(agentName) {
    try {
      const markerDir = dirname(MARKER_PATH);
      if (!existsSync(markerDir)) mkdirSync(markerDir, { recursive: true });
      // Delegate to the canonical writer script so the marker format stays in one place.
      execFileSync(process.execPath, [REVIEW_PASS_SCRIPT, '--verdict', 'PASS', '--agent', agentName], {
        cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'),
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 20000,
      });
      console.log(`[dispatch-reflex] ✅ Review PASS (${agentName}) — review-pass marker written`);
    } catch (e) {
      // Never break the session because the marker write failed.
      console.warn(`[dispatch-reflex] ⚠️ Could not write review-pass marker: ${(e && e.message) || e}`);
    }
  }

  return {
    "tool.execute.after": async (input, output) => {
      if (input.tool === 'task') {
        const agentName = getAgentName(input);
        lastTaskTime.set(agentName, Date.now());

        if (CODE_WRITING_AGENTS.has(agentName)) {
          pendingReview = true;
          lastCodeTaskTime = Date.now();
        }

        if (REVIEW_AGENTS.has(agentName)) {
          pendingReview = false;
          lastReviewTaskTime = Date.now();
          // Mechanical review gate (Layer B): auto-write the marker the pre-commit
          // hook requires when the reviewer verdict is PASS, so commits stop being
          // blocked by a stale/missing data/.review-pass.json.
          const text = extractResultText(output);
          if (isPassVerdict(text)) {
            writeReviewPassMarker(agentName);
          } else {
            console.warn(`[dispatch-reflex] Review verdict for ${agentName} not PASS — marker not written`);
          }
        }
      }
    },

    "tool.execute.before": async (input, output) => {
      const agentName = getAgentName(input);
      const isGlitchOmni = agentName === 'glitch-omni' || input.agent === 'glitch-omni';

      if (input.tool === 'edit' || input.tool === 'write') {
        const filePath = input.filePath || input.path || '';
        if (!filePath) return;

        if (isExemptFile(filePath)) return;

        if (isCodeFile(filePath)) {
          const lastTask = lastTaskTime.get(agentName) || 0;
          const timeSinceTask = Date.now() - lastTask;

          if (timeSinceTask > 120000) {
            if (isGlitchOmni) {
              console.warn(`[dispatch-reflex] Warning: Agent ${agentName} editing directly — glitch-omni mode`);
              return;
            }
            throw new Error(
              `⛔ Dispatch-First Violation: Direct edit on ${filePath} without prior task() dispatch.\n` +
              `You MUST dispatch to the appropriate sub-agent (task() with subagent_type: "coder" for code, "general" for bash) before editing files directly.\n` +
              `Exempt: memory files (user/*.md), config files (opencode.json), and git operations.`
            );
          }
        }
      }

      if (input.tool === 'bash') {
        const command = input.command || '';
        if (!command) return;

        const normalizedCmd = command.trim().toLowerCase();

        if (shouldBlockBashCommand(command)) {
          const lastTask = lastTaskTime.get(agentName) || 0;
          const timeSinceTask = Date.now() - lastTask;

          if (timeSinceTask > 120000) {
            if (isGlitchOmni) {
              console.warn(`[dispatch-reflex] Warning: Agent ${agentName} running destructive bash directly — glitch-omni mode`);
              return;
            }
            throw new Error(
              `⛔ Dispatch-First Violation: Direct destructive bash command without prior task() dispatch.\n` +
              `Command: ${command}\n` +
              `You MUST dispatch to the appropriate sub-agent (task() with subagent_type: "general" for bash) before running destructive commands.\n` +
              `Exempt: read-only commands (git status, ls, cat, grep, etc.), git operations (git add, commit, push, pull).`
            );
          }
        }

        // Review gate: block git commit when review is pending
        if (normalizedCmd.startsWith('git commit')) {
          // Allow explicit bypass with --no-verify
          if (normalizedCmd.includes('--no-verify')) {
            return; // Skip review gate for --no-verify commits
          }
          if (pendingReview && lastCodeTaskTime > lastReviewTaskTime) {
            throw new Error(
              `⛔ Review Gate: Code was written by a sub-agent but no review has been performed since.\n` +
              `Dispatch @reviewer first and get a PASS before committing.\n` +
              `Reviewer agents: @reviewer (free), @reviewer-paid (paid fallback)\n` +
              `To bypass: git commit --no-verify (only if you understand the risk)`
            );
          }
        }
      }
    }
  };
};