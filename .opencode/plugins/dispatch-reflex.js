export const DispatchReflexPlugin = async ({ directory, client }) => {
  const lastTaskTime = new Map();

  const CODE_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.rb', '.java',
    '.kt', '.swift', '.css', '.scss', '.sass', '.less', '.html', '.vue',
    '.svelte', '.astro', '.mjs', '.cjs', '.mts', '.cts'
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

  return {
    "tool.execute.after": async (input, output) => {
      if (input.tool === 'task') {
        const agentName = getAgentName(input);
        lastTaskTime.set(agentName, Date.now());
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
      }
    }
  };
};