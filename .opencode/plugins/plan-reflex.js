import path from 'path';
import fs from 'fs';

export const PLAN_MARKER_PATH = (directory) =>
  path.join(directory, 'data', 'plans', 'current-plan.md');

const PLAN_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const COMPLEXITY_KEYWORDS = [
  'feature', 'build', 'migration', 'refactor', 'integrate',
  'architecture', 'auth', 'database', 'api route', 'multi-file',
  '5+ files', 'multiple files', 'complex', 'design system',
  'security', 'end-to-end', 'full-stack'
];

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
  return MEMORY_PATHS.some(p => normalized.startsWith(p)) && normalized.endsWith('.md');
}

function isConfigFile(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return CONFIG_FILES.has(normalized) || (normalized.startsWith('config/') && normalized.endsWith('.json'));
}

function isExemptFile(filePath) {
  return isMemoryFile(filePath) || isConfigFile(filePath);
}

function isGitOperation(command) {
  const normalized = command.trim().toLowerCase();
  return [...GIT_OPERATIONS].some(cmd => normalized.startsWith(cmd));
}

function hasValidPlanMarker(directory) {
  const markerPath = PLAN_MARKER_PATH(directory);
  try {
    if (!fs.existsSync(markerPath)) return false;
    const stat = fs.statSync(markerPath);
    const age = Date.now() - stat.mtimeMs;
    return age <= PLAN_MAX_AGE_MS;
  } catch {
    return false;
  }
}

export function isComplexTask(input) {
  const prompt = (input.prompt || '').toLowerCase();
  const filePath = input.filePath || input.path || '';

  if (prompt.includes('quick task') || prompt.includes('--no-plan')) return false;

  for (const kw of COMPLEXITY_KEYWORDS) {
    if (prompt.includes(kw)) return true;
  }

  const pathPattern = /(?:[\w.-]+\/){1,}[\w.-]+\.\w+/g;
  const matches = prompt.match(pathPattern) || [];
  if (matches.length >= 3) return true;

  const allPaths = prompt.match(/\S+\.\w+/g) || [];
  if (allPaths.length >= 3) return true;

  if (filePath && isCodeFile(filePath)) return true;

  return false;
}

export const PlanReflexPlugin = async ({ directory, client }) => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === 'task') {
        const prompt = input.prompt || '';
        const lowerPrompt = prompt.toLowerCase();

        if (lowerPrompt.includes('quick task') || lowerPrompt.includes('--no-plan')) return;

        if (!isComplexTask(input)) return;

        if (hasValidPlanMarker(directory)) return;

        throw new Error(
          '\u26d4 Plan-First Violation: Complex task without an up-front plan.\n' +
          'You MUST write a plan to data/plans/current-plan.md (via the plan-first skill) before dispatching or editing.\n' +
          'Plan template: Goal, Approach, Files to change, Risks, Verification.\n' +
          'To force-skip for an intentionally simple task: include "quick task" in the prompt (bypass flag).'
        );
      }

      if (input.tool === 'edit' || input.tool === 'write') {
        const filePath = input.filePath || input.path || '';
        if (!filePath) return;

        if (isExemptFile(filePath)) return;

        if (!isCodeFile(filePath)) return;

        if (hasValidPlanMarker(directory)) return;

        throw new Error(
          '\u26d4 Plan-First Violation: Code file edit without an up-front plan.\n' +
          `File: ${filePath}\n` +
          'You MUST write a plan to data/plans/current-plan.md (via the plan-first skill) before editing code files.\n' +
          'Plan template: Goal, Approach, Files to change, Risks, Verification.\n' +
          'Exempt: memory files (user/*.md), config files (config/*.json, opencode.json).\n' +
          'To force-skip for an intentionally simple task: use the task tool with "quick task" in the prompt.'
        );
      }

      if (input.tool === 'bash') {
        const command = input.command || '';
        if (isGitOperation(command)) return;
      }
    }
  };
};
