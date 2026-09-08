/**
 * Browser Use Plugin — Shared Helpers
 * Extracted from server.mjs for Phase 3: Advanced Features.
 * Contains: logging, config, history, actions, schedule, export utilities.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');

// ── Sensitive Data Masking ──

const SENSITIVE_KEYS = /key|token|password|secret|authorization|api_key|apikey|credential/i;

export function maskSensitive(value) {
  if (typeof value !== 'string') return value;
  if (value.length <= 8) return '***';
  return value.slice(0, 4) + '***' + value.slice(-4);
}

export function maskObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const masked = Array.isArray(obj) ? [] : {};
  for (const [key, val] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.test(key) && typeof val === 'string') {
      masked[key] = maskSensitive(val);
    } else if (typeof val === 'object' && val !== null) {
      masked[key] = maskObject(val);
    } else {
      masked[key] = val;
    }
  }
  return masked;
}

// ── File System ──

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Logging ──

export function createLogger(logPath) {
  return function log(level, message, data) {
    const ts = new Date().toISOString();
    const safeData = data ? maskObject(data) : null;
    const entry = safeData
      ? `[${ts}] [${level}] ${message} ${JSON.stringify(safeData)}`
      : `[${ts}] [${level}] ${message}`;
    console.log(entry);
    try {
      ensureDir(dirname(logPath));
      writeFileSync(logPath, entry + '\n', { flag: 'a', encoding: 'utf-8' });
    } catch { /* best effort */ }
  };
}

// ── JSON Read/Write ──

export function readJson(path) {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8');
    const cleaned = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
    return JSON.parse(cleaned);
  } catch { return null; }
}

export function writeJson(path, data) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Config ──

export function createConfigManager(configPath) {
  let cache = null;
  let cacheTime = 0;
  const TTL = 5000;

  function get() {
    const now = Date.now();
    if (cache && now - cacheTime < TTL) return cache;
    cache = readJson(configPath);
    cacheTime = now;
    return cache;
  }

  function set(config) {
    cache = config;
    cacheTime = Date.now();
    writeJson(configPath, config);
  }

  function validate(config) {
    const warnings = [];
    if (!config) return { valid: false, warnings: ['Config file not found or unparseable'] };
    if (!config.llm) warnings.push('Missing llm configuration');
    else {
      const hasProviders = config.llm.providers && Array.isArray(config.llm.providers) && config.llm.providers.length > 0;
      const hasLegacy = config.llm.apiKey || config.llm.model || config.llm.provider;
      if (!hasProviders && !hasLegacy) {
        warnings.push('No providers configured — add a provider via POST /api/providers or edit config.json');
      }
      if (hasProviders) {
        if (!config.llm.active_provider) warnings.push('No active_provider set in llm config');
        if (!config.llm.active_model) warnings.push('No active_model set in llm config');
        const activeProvider = config.llm.providers.find(p => p.id === config.llm.active_provider);
        if (config.llm.active_provider && !activeProvider) {
          warnings.push(`active_provider "${config.llm.active_provider}" not found in providers list`);
        }
      }
    }
    if (!config.browser) warnings.push('Missing browser configuration');
    else if (!config.browser.user_data_dir) warnings.push('Missing browser.user_data_dir');
    if (!config.session) warnings.push('Missing session configuration');
    if (config.retry && typeof config.retry.max_attempts !== 'number') warnings.push('retry.max_attempts must be a number');
    if (config.history && typeof config.history.max_entries !== 'number') warnings.push('history.max_entries must be a number');
    return { valid: true, warnings };
  }

  return { get, set, validate };
}

// ── History ──

export function createHistoryManager(historyPath) {
  function load() {
    return readJson(historyPath) || [];
  }

  function save(history, config) {
    const maxEntries = config?.history?.max_entries || 100;
    const trimmed = history.slice(-maxEntries);
    writeJson(historyPath, trimmed);
  }

  function add(entry, config) {
    const history = load();
    history.push({ ...entry, timestamp: new Date().toISOString() });
    save(history, config);
  }

  function clear() {
    writeJson(historyPath, []);
  }

  return { load, save, add, clear };
}

// ── Domain Restriction ──

export function isDomainAllowed(url, config) {
  const allowed = config?.browser?.allowed_domains;
  if (!allowed || allowed.length === 0) return true;
  try {
    const hostname = new URL(url).hostname;
    return allowed.some(domain => hostname === domain || hostname.endsWith('.' + domain));
  } catch { return false; }
}

// ── Custom Actions Registry ──

export function createActionRegistry(actionsPath) {
  function load() {
    return readJson(actionsPath) || [];
  }

  function save(actions) {
    writeJson(actionsPath, actions);
  }

  function register(action) {
    const actions = load();
    if (actions.some(a => a.name === action.name)) {
      return { success: false, error: `Action "${action.name}" already exists` };
    }
    const config = createConfigManager(join(dirname(actionsPath), '..', 'config.json')).get();
    const maxActions = config?.custom_actions?.max_actions || 20;
    if (actions.length >= maxActions) {
      return { success: false, error: `Maximum ${maxActions} actions reached` };
    }
    actions.push({
      name: action.name,
      description: action.description || '',
      parameters: action.parameters || { type: 'object', properties: {} },
      handler: action.handler,
      created: new Date().toISOString(),
    });
    save(actions);
    return { success: true };
  }

  function unregister(name) {
    const actions = load();
    const idx = actions.findIndex(a => a.name === name);
    if (idx === -1) return { success: false, error: `Action "${name}" not found` };
    actions.splice(idx, 1);
    save(actions);
    return { success: true };
  }

  function get(name) {
    const actions = load();
    return actions.find(a => a.name === name) || null;
  }

  return { load, save, register, unregister, get };
}

// ── Scheduler ──

export function createScheduler(schedulePath, log, runTaskFn) {
  let tasks = [];
  let timers = new Map();

  function load() {
    tasks = readJson(schedulePath) || [];
    return tasks;
  }

  function save() {
    writeJson(schedulePath, tasks);
  }

  function create(task) {
    if (tasks.length >= 10) {
      return { success: false, error: 'Maximum 10 scheduled tasks reached' };
    }
    const id = `sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry = {
      id,
      name: task.name,
      task: task.task,
      interval_minutes: task.interval_minutes || 60,
      enabled: task.enabled !== false,
      last_run: null,
      last_result: null,
      created: new Date().toISOString(),
    };
    tasks.push(entry);
    save();
    if (entry.enabled) scheduleTimer(entry);
    return { success: true, id, entry };
  }

  function update(id, changes) {
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return { success: false, error: `Task ${id} not found` };
    const prev = tasks[idx];
    Object.assign(tasks[idx], changes);
    save();
    // Reschedule if interval or enabled changed
    clearTimer(id);
    if (tasks[idx].enabled) scheduleTimer(tasks[idx]);
    return { success: true, entry: tasks[idx] };
  }

  function remove(id) {
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return { success: false, error: `Task ${id} not found` };
    clearTimer(id);
    tasks.splice(idx, 1);
    save();
    return { success: true };
  }

  function list() {
    return tasks.map(t => ({
      ...t,
      next_run: t.enabled ? getNextRun(t) : null,
    }));
  }

  function getNextRun(task) {
    if (!task.last_run) return new Date().toISOString();
    const next = new Date(task.last_run).getTime() + task.interval_minutes * 60 * 1000;
    return new Date(next).toISOString();
  }

  function scheduleTimer(task) {
    const intervalMs = task.interval_minutes * 60 * 1000;
    const timer = setInterval(async () => {
      await runTask(task);
    }, intervalMs);
    timers.set(task.id, timer);
  }

  function clearTimer(id) {
    if (timers.has(id)) {
      clearInterval(timers.get(id));
      timers.delete(id);
    }
  }

  async function runTask(task) {
    const start = Date.now();
    try {
      const result = await runTaskFn(task.task, {
        source: 'schedule',
        scheduleId: task.id,
        scheduleName: task.name,
      });
      const idx = tasks.findIndex(t => t.id === task.id);
      if (idx !== -1) {
        tasks[idx].last_run = new Date().toISOString();
        tasks[idx].last_result = { success: true, duration: Date.now() - start };
        save();
      }
      log('INFO', `Scheduled task "${task.name}" completed`, { id: task.id, duration: Date.now() - start });
      return result;
    } catch (err) {
      const idx = tasks.findIndex(t => t.id === task.id);
      if (idx !== -1) {
        tasks[idx].last_run = new Date().toISOString();
        tasks[idx].last_result = { success: false, error: err.message, duration: Date.now() - start };
        save();
      }
      log('ERROR', `Scheduled task "${task.name}" failed`, { id: task.id, error: err.message });
      throw err;
    }
  }

  function startAll() {
    for (const task of tasks) {
      if (task.enabled) scheduleTimer(task);
    }
    if (tasks.length > 0) {
      log('INFO', `Scheduler started with ${tasks.filter(t => t.enabled).length}/${tasks.length} tasks active`);
    }
  }

  function stopAll() {
    for (const [id] of timers) clearTimer(id);
    timers.clear();
  }

  return { load, save, create, update, remove, list, runTask, startAll, stopAll };
}

// ── Export ──

export function exportHistory(history, format, taskIds) {
  let entries = history;
  if (taskIds && taskIds.length > 0) {
    entries = history.filter(h => taskIds.includes(h.taskId));
  }

  switch (format) {
    case 'csv':
      return exportCsv(entries);
    case 'markdown':
      return exportMarkdown(entries);
    case 'json':
    default:
      return { content: JSON.stringify(entries, null, 2), mimeType: 'application/json', ext: 'json' };
  }
}

function exportCsv(entries) {
  const header = 'taskId,task,success,error,timestamp,duration,screenshotPath';
  const rows = entries.map(e => {
    const task = `"${(e.task || '').replace(/"/g, '""')}"`;
    const error = `"${(e.error || '').replace(/"/g, '""')}"`;
    return [
      e.taskId,
      task,
      e.success,
      error,
      e.timestamp,
      e.duration,
      e.screenshotPath || '',
    ].join(',');
  });
  return { content: [header, ...rows].join('\n'), mimeType: 'text/csv', ext: 'csv' };
}

function exportMarkdown(entries) {
  const header = '| Task ID | Task | Success | Error | Timestamp | Duration |';
  const sep = '|---------|------|---------|-------|-----------|----------|';
  const rows = entries.map(e =>
    `| ${e.taskId} | ${(e.task || '').slice(0, 50)} | ${e.success ? 'Yes' : 'No'} | ${(e.error || '-').slice(0, 30)} | ${e.timestamp} | ${e.duration}ms |`
  );
  return { content: [header, sep, ...rows].join('\n'), mimeType: 'text/markdown', ext: 'md' };
}

// ── Sleep ──

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { ROOT_DIR, __dirname };
