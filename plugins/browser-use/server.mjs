#!/usr/bin/env node

/**
 * Browser Use Plugin Server — Phase 4: Multi-Provider LLM
 * Wraps the browser-use npm package as an HTTP API for Glitch agents.
 *
 * Phase 1 Endpoints:
 *   GET  /api/status        — Check if browser session is active
 *   POST /api/run           — Run a browser task (body: { task, options? })
 *   POST /api/navigate      — Navigate to URL (body: { url })
 *   POST /api/screenshot    — Take screenshot (body: { saveTo? })
 *   POST /api/screenshot/analyze — Screenshot + @vision analysis
 *   POST /api/stop          — Stop browser session
 *   GET  /api/history       — Last 20 task history entries
 *   GET  /api/history/:taskId — Task detail by ID
 *   DELETE /api/history     — Clear all history
 *   POST /api/profile       — List browser profiles
 *   POST /api/config/domains — Update allowed domains at runtime
 *
 * Phase 3 Endpoints:
 *   GET  /api/tabs              — List open tabs (requires session)
 *   POST /api/tabs/switch       — Switch to tab by index or url
 *   POST /api/tabs/open         — Open new tab
 *   POST /api/tabs/close        — Close a tab
 *   GET  /api/actions           — List registered custom actions
 *   POST /api/actions/register  — Register a custom action
 *   POST /api/actions/run       — Run a custom action
 *   GET  /api/schedule          — List scheduled tasks
 *   POST /api/schedule          — Create a scheduled task
 *   PUT  /api/schedule/:id      — Update a scheduled task
 *   DELETE /api/schedule/:id    — Delete a scheduled task
 *   POST /api/schedule/:id/run  — Manually trigger a scheduled task
 *   POST /api/export            — Export task history (csv/json/markdown)
 *   POST /api/session/create    — Create a new browser session
 *   POST /api/session/:id/run   — Run task on specific session
 *   GET  /api/session/:id/status — Get specific session status
 *   POST /api/session/:id/stop  — Stop a specific session
 *   GET  /api/sessions          — List all active sessions
 *
 * Phase 4 Endpoints (Multi-Provider LLM):
 *   GET  /api/providers         — List all configured providers (apiKeys masked)
 *   POST /api/providers         — Add a new provider
 *   PUT  /api/providers/:id     — Update a provider (partial)
 *   DELETE /api/providers/:id   — Remove a provider
 *   POST /api/providers/:id/test — Test provider connection
 *   POST /api/llm/select        — Set active provider + model
 *   GET  /api/llm/status        — Current active provider/model info
 */

import http from 'node:http';
import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createLogger, ensureDir, readJson, writeJson,
  createConfigManager, createHistoryManager,
  createActionRegistry, createScheduler, exportHistory,
  isDomainAllowed, sleep, maskSensitive, maskObject, ROOT_DIR,
} from './helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = parseInt(process.env.BROWSER_USE_PORT || '4105', 10);
const CONFIG_PATH = join(ROOT_DIR, 'data', 'browser-use', 'config.json');
const LOG_PATH = join(ROOT_DIR, 'data', 'logs', 'browser-use.log');
const HISTORY_PATH = join(ROOT_DIR, 'data', 'browser-use', 'history.json');
const SCREENSHOTS_DIR = join(ROOT_DIR, 'data', 'browser-use', 'screenshots');
const ACTIONS_PATH = join(ROOT_DIR, 'data', 'browser-use', 'actions.json');
const SCHEDULE_PATH = join(ROOT_DIR, 'data', 'browser-use', 'schedule.json');

const log = createLogger(LOG_PATH);
const configManager = createConfigManager(CONFIG_PATH);
const historyManager = createHistoryManager(HISTORY_PATH);
const actionRegistry = createActionRegistry(ACTIONS_PATH);

// ── Browser Use Integration ──

let browserUseAvailable = false;
let Agent, BrowserSession, BrowserProfile;

async function loadBrowserUse() {
  try {
    const bu = await import('browser-use');
    Agent = bu.Agent;
    BrowserSession = bu.BrowserSession;
    BrowserProfile = bu.BrowserProfile;
    browserUseAvailable = true;
    log('INFO', 'browser-use package loaded successfully');
  } catch (err) {
    browserUseAvailable = false;
    log('WARN', 'browser-use package not installed — running in stub mode', { error: err.message });
  }
}

// ── Multi-Session Management ──

const sessions = new Map();
const DEFAULT_SESSION_ID = 'default';
let taskRunning = false;
let lastError = null;

function getSession(sessionId) {
  return sessions.get(sessionId || DEFAULT_SESSION_ID) || null;
}

function createSessionEntry(sessionId, config, session, agent) {
  return {
    id: sessionId,
    session,
    agent,
    config,
    taskRunning: false,
    lastError: null,
    tabs: [],
    created: new Date().toISOString(),
  };
}

async function stopSession(entry) {
  if (entry.session) {
    try { await entry.session.close(); } catch { /* best effort */ }
  }
  entry.session = null;
  entry.agent = null;
  entry.taskRunning = false;
}

// ── LLM & Session Creation ──

const SUPPORTED_PROVIDER_TYPES = [
  'openai', 'openai-compatible', 'openrouter', 'anthropic',
  'google', 'deepseek', 'groq', 'ollama', 'mistral',
  'cerebras', 'litellm', 'vercel', 'azure', 'aws', 'browser-use',
];

const ENV_KEY_MAP = {
  openrouter: 'OPENROUTER_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  litellm: 'LITELLM_API_KEY',
  vercel: 'VERCEL_API_KEY',
  azure: 'AZURE_OPENAI_API_KEY',
  'browser-use': 'BROWSER_USE_API_KEY',
};

function migrateLegacyConfig(config) {
  if (!config?.llm) return config;
  if (config.llm.providers && Array.isArray(config.llm.providers)) return config;

  const legacyProvider = config.llm.provider || 'openrouter';
  const legacyModel = config.llm.model || 'google/gemini-2.0-flash-001';
  const legacyApiKey = config.llm.apiKey || '';
  const legacyBaseUrl = config.llm.baseUrl || '';

  let type = legacyProvider;
  if (legacyProvider === 'openrouter') type = 'openrouter';
  else if (legacyProvider === 'openai') type = 'openai';
  else if (legacyProvider === 'ollama') type = 'ollama';
  else type = 'openai-compatible';

  const migrated = {
    id: legacyProvider,
    type,
    name: legacyProvider.charAt(0).toUpperCase() + legacyProvider.slice(1),
    apiKey: legacyApiKey,
    baseUrl: legacyBaseUrl,
    models: [legacyModel],
    vision: false,
  };

  config.llm = {
    active_provider: legacyProvider,
    active_model: legacyModel,
    providers: [migrated],
  };

  log('INFO', 'Migrated legacy LLM config to provider registry');
  return config;
}

function resolveApiKey(provider) {
  if (provider.apiKey && provider.apiKey.trim()) return provider.apiKey.trim();
  const envKey = ENV_KEY_MAP[provider.type];
  if (envKey && process.env[envKey]) return process.env[envKey];
  if (provider.type === 'openai-compatible' && process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  return '';
}

async function createLLM(config) {
  const rawConfig = config;
  const migrated = migrateLegacyConfig(rawConfig);
  if (migrated !== rawConfig) {
    configManager.set(migrated);
  }

  const llmConfig = migrated?.llm || {};
  const activeProviderId = llmConfig.active_provider || '';
  const activeModel = llmConfig.active_model || '';
  const providers = llmConfig.providers || [];

  const provider = providers.find(p => p.id === activeProviderId);
  if (!provider) {
    throw new Error(
      `Active provider "${activeProviderId}" not found in config. ` +
      `Available: ${providers.map(p => p.id).join(', ') || '(none)'}`
    );
  }

  const model = activeModel || (provider.models && provider.models[0]) || '';
  if (!model) throw new Error(`No model specified for provider "${provider.id}"`);

  const apiKey = resolveApiKey(provider);
  const envKey = ENV_KEY_MAP[provider.type];
  if (apiKey && envKey && !process.env[envKey]) {
    process.env[envKey] = apiKey;
  }

  const type = provider.type;

  if (!SUPPORTED_PROVIDER_TYPES.includes(type)) {
    throw new Error(
      `Unsupported provider type: ${type}. ` +
      `Supported: ${SUPPORTED_PROVIDER_TYPES.join(', ')}`
    );
  }

  switch (type) {
    case 'openai':
    case 'openai-compatible': {
      const { ChatOpenAI } = await import('browser-use/llm/openai');
      return new ChatOpenAI({ model, apiKey, baseURL: provider.baseUrl || undefined });
    }
    case 'openrouter': {
      const { ChatOpenRouter } = await import('browser-use/llm/openrouter');
      return new ChatOpenRouter({ model, apiKey, baseURL: provider.baseUrl || undefined });
    }
    case 'anthropic': {
      const { ChatAnthropic } = await import('browser-use/llm/anthropic');
      return new ChatAnthropic({ model, apiKey });
    }
    case 'google': {
      const { ChatGoogle } = await import('browser-use/llm/google');
      return new ChatGoogle(model);
    }
    case 'deepseek': {
      const { ChatDeepSeek } = await import('browser-use/llm/deepseek');
      return new ChatDeepSeek(model);
    }
    case 'groq': {
      const { ChatGroq } = await import('browser-use/llm/groq');
      return new ChatGroq(model);
    }
    case 'ollama': {
      const { ChatOllama } = await import('browser-use/llm/ollama');
      return new ChatOllama(model, provider.baseUrl || 'http://localhost:11434');
    }
    case 'mistral': {
      const { ChatMistral } = await import('browser-use/llm/mistral');
      return new ChatMistral(model);
    }
    case 'cerebras': {
      const { ChatCerebras } = await import('browser-use/llm/cerebras');
      return new ChatCerebras(model);
    }
    case 'litellm': {
      if (provider.baseUrl) process.env.LITELLM_BASE_URL = provider.baseUrl;
      const { ChatLiteLLM } = await import('browser-use/llm/litellm');
      return new ChatLiteLLM(model);
    }
    case 'vercel': {
      const { ChatVercel } = await import('browser-use/llm/vercel');
      return new ChatVercel(model);
    }
    case 'azure': {
      const { ChatAzure } = await import('browser-use/llm/azure');
      return new ChatAzure(model);
    }
    case 'aws': {
      const { ChatAnthropicBedrock } = await import('browser-use/llm/aws');
      return new ChatAnthropicBedrock({ model, region: provider.baseUrl || 'us-east-1' });
    }
    case 'browser-use': {
      const { ChatBrowserUse } = await import('browser-use/llm/browser-use');
      return new ChatBrowserUse({ model });
    }
    default:
      throw new Error(`Unsupported provider type: ${type}`);
  }
}

async function createBrowserSession(config, sessionId) {
  const browserConfig = config?.browser || {};
  const profileBase = browserConfig.user_data_dir || 'data/browser-use/profiles';
  const profileDir = sessionId
    ? join(ROOT_DIR, profileBase, sessionId)
    : join(ROOT_DIR, profileBase);
  ensureDir(profileDir);

  const profileOptions = {
    headless: config?.headless !== false,
    userDataDir: profileDir,
    viewport: browserConfig.viewport || { width: 1920, height: 1080 },
  };

  if (BrowserProfile) {
    const profile = new BrowserProfile(profileOptions);
    if (BrowserSession) return new BrowserSession({ profile });
  }
  return { ...profileOptions, _stub: true };
}

// ── Screenshot + @vision ──

async function captureScreenshot(session) {
  const screenshot = await session.screenshot();
  if (!screenshot) throw new Error('Screenshot returned no data');
  return screenshot;
}

async function dispatchToVision(imagePath, config) {
  const visionConfig = config?.vision || {};
  if (!visionConfig.enabled || !visionConfig.dispatch_to_vision) return null;
  const visionPort = visionConfig.vision_port || 4100;
  try {
    const resp = await fetch(`http://localhost:${visionPort}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imagePath }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// ── Retry Logic ──

async function runWithRetry(fn, config) {
  const retryConfig = config?.retry || {};
  const enabled = retryConfig.enabled !== false;
  const maxAttempts = retryConfig.max_attempts || 3;
  const backoffBase = retryConfig.backoff_base_ms || 2000;

  if (!enabled) return fn();

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const delay = backoffBase * Math.pow(2, attempt - 1);
        log('WARN', `Retry ${attempt}/${maxAttempts} after ${delay}ms`, { error: err.message });
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

// ── HTTP Helpers ──

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function sendFile(res, status, content, mimeType, filename) {
  res.writeHead(status, {
    'Content-Type': `${mimeType}; charset=utf-8`,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(content);
}

function parseUrl(req) {
  return new URL(req.url, `http://${req.headers.host || 'localhost'}`);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : null); }
      catch { resolve(null); }
    });
    req.on('error', reject);
  });
}

// ── Profile Management ──

function listProfiles(config) {
  const profileDir = join(ROOT_DIR, config?.browser?.user_data_dir || 'data/browser-use/profiles');
  if (!existsSync(profileDir)) return [];
  try {
    const entries = readdirSync(profileDir);
    return entries.map(name => {
      const entryPath = join(profileDir, name);
      try {
        const stats = statSync(entryPath);
        return { name, isDir: stats.isDirectory(), size: stats.size, modified: stats.mtime.toISOString() };
      } catch { return { name, isDir: false, size: 0, modified: null }; }
    });
  } catch { return []; }
}

// ── Scheduler ──

const scheduler = createScheduler(SCHEDULE_PATH, log, async (taskText, meta) => {
  const config = configManager.get();
  const taskId = `sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  log('INFO', `Scheduled task triggered: ${meta.scheduleName}`, { taskId, task: taskText.substring(0, 200) });

  // Run the task through the browser
  const result = await runBrowserTask(taskId, taskText, { source: meta.source, scheduleId: meta.scheduleId }, config, true);
  return result;
});

// ── Request Handler ──

async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const url = parseUrl(req);
  const pathname = url.pathname;
  const method = req.method;

  try {
    // ── GET /api/status ──
    if (method === 'GET' && pathname === '/api/status') {
      const config = configManager.get();
      const validation = configManager.validate(config);
      const entry = getSession(DEFAULT_SESSION_ID);
      sendJson(res, 200, {
        running: entry?.taskRunning || taskRunning,
        session_active: !!entry?.session,
        sessions_count: sessions.size,
        browser_use_installed: browserUseAvailable,
        config_loaded: !!config,
        config_valid: validation.valid,
        config_warnings: validation.warnings,
        headless: config?.headless !== false,
        domain_restrictions: config?.browser?.allowed_domains?.length > 0,
        last_error: entry?.lastError || lastError,
        recent_tasks: historyManager.load().slice(-5),
      });
      return;
    }

    // ── POST /api/run ──
    if (method === 'POST' && pathname === '/api/run') {
      const entry = getSession(DEFAULT_SESSION_ID);
      if (entry?.taskRunning || taskRunning) {
        sendJson(res, 409, { error: 'A task is already running. Wait for it to complete or POST /api/stop.' });
        return;
      }
      if (!browserUseAvailable) {
        sendJson(res, 503, {
          error: 'browser-use package is not installed.',
          hint: 'Run: cd plugins/browser-use && npm install && npx playwright install chromium',
        });
        return;
      }

      const body = await parseBody(req);
      const task = body?.task;
      if (!task || typeof task !== 'string' || task.trim().length === 0) {
        sendJson(res, 400, { error: 'task is required and must be a non-empty string' });
        return;
      }

      const config = configManager.get();
      if (!config) {
        sendJson(res, 500, { error: 'Config not found at data/browser-use/config.json' });
        return;
      }

      taskRunning = true;
      lastError = null;
      if (entry) { entry.taskRunning = true; entry.lastError = null; }

      const taskId = `task-${Date.now()}`;
      const retry = body?.options?.retry !== false;
      log('INFO', 'Task started', { taskId, task: task.substring(0, 200) });

      runBrowserTask(taskId, task, body.options, config, retry).catch((err) => {
        log('ERROR', 'Task failed', { taskId, error: err.message });
        lastError = err.message;
        taskRunning = false;
        if (entry) { entry.taskRunning = false; entry.lastError = err.message; }
      });

      sendJson(res, 202, { taskId, retry, message: 'Task started. Poll GET /api/status for progress.' });
      return;
    }

    // ── POST /api/navigate ──
    if (method === 'POST' && pathname === '/api/navigate') {
      const body = await parseBody(req);
      const urlTarget = body?.url;
      if (!urlTarget || typeof urlTarget !== 'string') {
        sendJson(res, 400, { error: 'url is required and must be a string' });
        return;
      }
      if (!browserUseAvailable) {
        sendJson(res, 503, { error: 'browser-use package is not installed.' });
        return;
      }
      const entry = getSession(DEFAULT_SESSION_ID);
      if (!entry?.session) {
        sendJson(res, 400, { error: 'No active browser session. Run a task first to start a session.' });
        return;
      }

      const config = configManager.get();
      if (!isDomainAllowed(urlTarget, config)) {
        sendJson(res, 403, { error: 'Navigation blocked by domain restriction', url: urlTarget, allowed: config?.browser?.allowed_domains });
        return;
      }

      try {
        await entry.session.navigate(urlTarget);
        log('INFO', 'Navigated to URL', { url: urlTarget });
        sendJson(res, 200, { success: true, url: urlTarget });
      } catch (err) {
        log('ERROR', 'Navigation failed', { url: urlTarget, error: err.message });
        sendJson(res, 500, { error: err.message });
      }
      return;
    }

    // ── POST /api/screenshot ──
    if (method === 'POST' && pathname === '/api/screenshot') {
      const body = await parseBody(req);
      const config = configManager.get();
      const saveDir = config?.screenshots?.save_dir || 'data/browser-use/screenshots';
      const saveTo = body?.saveTo || join(saveDir, `screenshot-${Date.now()}.png`);
      const fullPath = join(ROOT_DIR, saveTo);

      const entry = getSession(DEFAULT_SESSION_ID);
      if (!entry?.session) {
        sendJson(res, 400, { error: 'No active browser session. Run a task first.' });
        return;
      }

      try {
        ensureDir(dirname(fullPath));
        const screenshot = await captureScreenshot(entry.session);
        writeFileSync(fullPath, screenshot);
        log('INFO', 'Screenshot saved', { path: saveTo });
        sendJson(res, 200, { success: true, path: saveTo });
      } catch (err) {
        log('ERROR', 'Screenshot failed', { error: err.message });
        sendJson(res, 500, { error: err.message });
      }
      return;
    }

    // ── POST /api/screenshot/analyze ──
    if (method === 'POST' && pathname === '/api/screenshot/analyze') {
      const body = await parseBody(req);
      const config = configManager.get();
      const saveDir = config?.screenshots?.save_dir || 'data/browser-use/screenshots';
      const saveTo = body?.saveTo || join(saveDir, `screenshot-${Date.now()}.png`);
      const fullPath = join(ROOT_DIR, saveTo);

      const entry = getSession(DEFAULT_SESSION_ID);
      if (!entry?.session) {
        sendJson(res, 400, { error: 'No active browser session. Run a task first.' });
        return;
      }

      try {
        ensureDir(dirname(fullPath));
        const screenshot = await captureScreenshot(entry.session);
        writeFileSync(fullPath, screenshot);
        log('INFO', 'Screenshot saved for analysis', { path: saveTo });

        const analysis = await dispatchToVision(saveTo, config);
        sendJson(res, 200, {
          success: true,
          path: saveTo,
          analysis: analysis || { status: 'vision_unavailable', message: 'Could not reach @vision agent' },
        });
      } catch (err) {
        log('ERROR', 'Screenshot analysis failed', { error: err.message });
        sendJson(res, 500, { error: err.message });
      }
      return;
    }

    // ── POST /api/stop ──
    if (method === 'POST' && pathname === '/api/stop') {
      const entry = getSession(DEFAULT_SESSION_ID);
      if (!entry?.session && !taskRunning) {
        sendJson(res, 200, { message: 'No active session to stop' });
        return;
      }
      try {
        if (entry?.session) {
          await stopSession(entry);
        }
        taskRunning = false;
        log('INFO', 'Browser session stopped');
        sendJson(res, 200, { success: true, message: 'Browser session stopped' });
      } catch (err) {
        log('ERROR', 'Error stopping session', { error: err.message });
        if (entry) { entry.session = null; entry.agent = null; entry.taskRunning = false; }
        taskRunning = false;
        sendJson(res, 200, { success: true, message: 'Session cleared (close had error)' });
      }
      return;
    }

    // ── GET /api/history ──
    if (method === 'GET' && pathname === '/api/history') {
      const history = historyManager.load();
      sendJson(res, 200, { entries: history.slice(-20), total: history.length });
      return;
    }

    // ── GET /api/history/:taskId ──
    if (method === 'GET' && pathname.startsWith('/api/history/')) {
      const taskId = pathname.split('/api/history/')[1];
      const history = historyManager.load();
      const entry = history.find(h => h.taskId === taskId);
      if (!entry) {
        sendJson(res, 404, { error: `Task ${taskId} not found in history` });
        return;
      }
      sendJson(res, 200, entry);
      return;
    }

    // ── DELETE /api/history ──
    if (method === 'DELETE' && pathname === '/api/history') {
      historyManager.clear();
      log('INFO', 'History cleared');
      sendJson(res, 200, { success: true, message: 'History cleared' });
      return;
    }

    // ── POST /api/profile ──
    if (method === 'POST' && pathname === '/api/profile') {
      const config = configManager.get();
      const profiles = listProfiles(config);
      sendJson(res, 200, { profiles, profile_dir: config?.browser?.user_data_dir });
      return;
    }

    // ── POST /api/config/domains ──
    if (method === 'POST' && pathname === '/api/config/domains') {
      const body = await parseBody(req);
      const domains = body?.domains;
      if (!Array.isArray(domains)) {
        sendJson(res, 400, { error: 'domains must be an array of strings' });
        return;
      }

      const config = configManager.get();
      if (!config) {
        sendJson(res, 500, { error: 'Config not loaded' });
        return;
      }
      if (!config.browser) config.browser = {};
      config.browser.allowed_domains = domains;

      configManager.set(config);

      if (domains.length > 0) {
        log('WARN', 'Domain restrictions active', { domains });
      } else {
        log('INFO', 'Domain restrictions removed (all domains allowed)');
      }
      sendJson(res, 200, { success: true, allowed_domains: domains });
      return;
    }

    // ═══════════════════════════════════════════
    // Phase 3 Endpoints
    // ═══════════════════════════════════════════

    // ── GET /api/tabs ──
    if (method === 'GET' && pathname === '/api/tabs') {
      const sessionId = url.searchParams.get('session_id') || DEFAULT_SESSION_ID;
      const entry = getSession(sessionId);
      if (!entry) {
        sendJson(res, 400, { error: `No session found. Session ID: ${sessionId}` });
        return;
      }
      if (!entry.session) {
        sendJson(res, 400, { error: 'Session has no active browser. Run a task first.' });
        return;
      }
      try {
        // Try to get tabs from browser-use session
        let tabs = [];
        if (entry.session.tabs && typeof entry.session.tabs === 'function') {
          tabs = await entry.session.tabs();
        } else if (entry.tabs && entry.tabs.length > 0) {
          tabs = entry.tabs;
        }
        sendJson(res, 200, { session_id: sessionId, tabs });
      } catch (err) {
        log('ERROR', 'Failed to list tabs', { sessionId, error: err.message });
        sendJson(res, 500, { error: err.message });
      }
      return;
    }

    // ── POST /api/tabs/switch ──
    if (method === 'POST' && pathname === '/api/tabs/switch') {
      const body = await parseBody(req);
      const sessionId = body?.session_id || DEFAULT_SESSION_ID;
      const entry = getSession(sessionId);
      if (!entry) {
        sendJson(res, 400, { error: `No session found. Session ID: ${sessionId}` });
        return;
      }
      if (!entry.session) {
        sendJson(res, 400, { error: 'Session has no active browser.' });
        return;
      }

      const { index, url: tabUrl } = body || {};
      if (index === undefined && !tabUrl) {
        sendJson(res, 400, { error: 'Provide index (number) or url (string) to switch to' });
        return;
      }

      try {
        if (typeof index === 'number' && entry.session.switchTab) {
          await entry.session.switchTab(index);
          log('INFO', 'Switched to tab', { sessionId, index });
          sendJson(res, 200, { success: true, index });
        } else if (tabUrl && entry.session.switchToUrl) {
          await entry.session.switchToUrl(tabUrl);
          log('INFO', 'Switched to tab by URL', { sessionId, url: tabUrl });
          sendJson(res, 200, { success: true, url: tabUrl });
        } else {
          sendJson(res, 400, { error: 'Tab switching not supported by this browser-use version or invalid parameters' });
        }
      } catch (err) {
        log('ERROR', 'Tab switch failed', { sessionId, error: err.message });
        sendJson(res, 500, { error: err.message });
      }
      return;
    }

    // ── POST /api/tabs/open ──
    if (method === 'POST' && pathname === '/api/tabs/open') {
      const body = await parseBody(req);
      const sessionId = body?.session_id || DEFAULT_SESSION_ID;
      const entry = getSession(sessionId);
      if (!entry) {
        sendJson(res, 400, { error: `No session found. Session ID: ${sessionId}` });
        return;
      }
      if (!entry.session) {
        sendJson(res, 400, { error: 'Session has no active browser.' });
        return;
      }

      const tabUrl = body?.url;
      if (!tabUrl || typeof tabUrl !== 'string') {
        sendJson(res, 400, { error: 'url is required and must be a string' });
        return;
      }

      const config = configManager.get();
      if (!isDomainAllowed(tabUrl, config)) {
        sendJson(res, 403, { error: 'Domain not allowed', url: tabUrl, allowed: config?.browser?.allowed_domains });
        return;
      }

      try {
        if (entry.session.newTab) {
          await entry.session.newTab(tabUrl);
        } else if (entry.session.navigate) {
          await entry.session.navigate(tabUrl);
        }
        log('INFO', 'Opened new tab', { sessionId, url: tabUrl });
        sendJson(res, 200, { success: true, url: tabUrl });
      } catch (err) {
        log('ERROR', 'Failed to open tab', { sessionId, error: err.message });
        sendJson(res, 500, { error: err.message });
      }
      return;
    }

    // ── POST /api/tabs/close ──
    if (method === 'POST' && pathname === '/api/tabs/close') {
      const body = await parseBody(req);
      const sessionId = body?.session_id || DEFAULT_SESSION_ID;
      const entry = getSession(sessionId);
      if (!entry) {
        sendJson(res, 400, { error: `No session found. Session ID: ${sessionId}` });
        return;
      }
      if (!entry.session) {
        sendJson(res, 400, { error: 'Session has no active browser.' });
        return;
      }

      const { index, url: tabUrl } = body || {};
      if (index === undefined && !tabUrl) {
        sendJson(res, 400, { error: 'Provide index (number) or url (string) to close' });
        return;
      }

      try {
        if (typeof index === 'number' && entry.session.closeTab) {
          await entry.session.closeTab(index);
          log('INFO', 'Closed tab', { sessionId, index });
          sendJson(res, 200, { success: true, index });
        } else {
          sendJson(res, 400, { error: 'Tab closing not supported by this browser-use version' });
        }
      } catch (err) {
        log('ERROR', 'Tab close failed', { sessionId, error: err.message });
        sendJson(res, 500, { error: err.message });
      }
      return;
    }

    // ── GET /api/actions ──
    if (method === 'GET' && pathname === '/api/actions') {
      const actions = actionRegistry.load();
      sendJson(res, 200, { actions, count: actions.length });
      return;
    }

    // ── POST /api/actions/register ──
    if (method === 'POST' && pathname === '/api/actions/register') {
      const body = await parseBody(req);
      if (!body?.name || typeof body.name !== 'string') {
        sendJson(res, 400, { error: 'name is required and must be a string' });
        return;
      }
      if (!body?.handler || typeof body.handler !== 'string') {
        sendJson(res, 400, { error: 'handler is required and must be a string (JavaScript function body)' });
        return;
      }

      const config = configManager.get();
      if (config?.custom_actions?.enabled === false) {
        sendJson(res, 403, { error: 'Custom actions are disabled in config' });
        return;
      }

      const result = actionRegistry.register({
        name: body.name,
        description: body.description || '',
        parameters: body.parameters || { type: 'object', properties: {} },
        handler: body.handler,
      });

      if (!result.success) {
        sendJson(res, 409, { error: result.error });
        return;
      }
      log('INFO', 'Custom action registered', { name: body.name });
      sendJson(res, 201, { success: true, message: `Action "${body.name}" registered` });
      return;
    }

    // ── POST /api/actions/run ──
    if (method === 'POST' && pathname === '/api/actions/run') {
      const body = await parseBody(req);
      if (!body?.name || typeof body.name !== 'string') {
        sendJson(res, 400, { error: 'name is required' });
        return;
      }

      const action = actionRegistry.get(body.name);
      if (!action) {
        sendJson(res, 404, { error: `Action "${body.name}" not found` });
        return;
      }

      try {
        // SECURITY: handler is evaluated via new Function — documented as risky
        const fn = new Function('params', 'context', action.handler);
        const context = { log, config: configManager.get(), history: historyManager };
        const result = await fn(body.params || {}, context);
        log('INFO', 'Custom action executed', { name: body.name });
        sendJson(res, 200, { success: true, result });
      } catch (err) {
        log('ERROR', 'Custom action failed', { name: body.name, error: err.message });
        sendJson(res, 500, { error: `Action "${body.name}" failed: ${err.message}` });
      }
      return;
    }

    // ── GET /api/schedule ──
    if (method === 'GET' && pathname === '/api/schedule') {
      const tasks = scheduler.list();
      sendJson(res, 200, { tasks, count: tasks.length });
      return;
    }

    // ── POST /api/schedule ──
    if (method === 'POST' && pathname === '/api/schedule') {
      const body = await parseBody(req);
      if (!body?.name || typeof body.name !== 'string') {
        sendJson(res, 400, { error: 'name is required' });
        return;
      }
      if (!body?.task || typeof body.task !== 'string') {
        sendJson(res, 400, { error: 'task is required and must be a string' });
        return;
      }

      const config = configManager.get();
      if (config?.scheduler?.enabled === false) {
        sendJson(res, 403, { error: 'Scheduler is disabled in config' });
        return;
      }

      const result = scheduler.create({
        name: body.name,
        task: body.task,
        interval_minutes: body.interval_minutes || 60,
        enabled: body.enabled !== false,
      });

      if (!result.success) {
        sendJson(res, 400, { error: result.error });
        return;
      }
      log('INFO', 'Scheduled task created', { id: result.id, name: body.name });
      sendJson(res, 201, { success: true, id: result.id, entry: result.entry });
      return;
    }

    // ── PUT /api/schedule/:id ──
    if (method === 'PUT' && pathname.startsWith('/api/schedule/')) {
      const id = pathname.split('/api/schedule/')[1];
      if (!id) {
        sendJson(res, 400, { error: 'Task ID is required' });
        return;
      }

      const body = await parseBody(req);
      const changes = {};
      if (body?.name !== undefined) changes.name = body.name;
      if (body?.task !== undefined) changes.task = body.task;
      if (body?.interval_minutes !== undefined) changes.interval_minutes = body.interval_minutes;
      if (body?.enabled !== undefined) changes.enabled = body.enabled;

      if (Object.keys(changes).length === 0) {
        sendJson(res, 400, { error: 'No valid fields to update (name, task, interval_minutes, enabled)' });
        return;
      }

      const result = scheduler.update(id, changes);
      if (!result.success) {
        sendJson(res, 404, { error: result.error });
        return;
      }
      log('INFO', 'Scheduled task updated', { id, changes: Object.keys(changes) });
      sendJson(res, 200, { success: true, entry: result.entry });
      return;
    }

    // ── DELETE /api/schedule/:id ──
    if (method === 'DELETE' && pathname.startsWith('/api/schedule/')) {
      const id = pathname.split('/api/schedule/')[1];
      if (!id) {
        sendJson(res, 400, { error: 'Task ID is required' });
        return;
      }

      const result = scheduler.remove(id);
      if (!result.success) {
        sendJson(res, 404, { error: result.error });
        return;
      }
      log('INFO', 'Scheduled task deleted', { id });
      sendJson(res, 200, { success: true, message: `Task ${id} deleted` });
      return;
    }

    // ── POST /api/schedule/:id/run ──
    if (method === 'POST' && pathname.match(/^\/api\/schedule\/[^/]+\/run$/)) {
      const id = pathname.split('/api/schedule/')[1].split('/')[0];
      const tasks = scheduler.list();
      const task = tasks.find(t => t.id === id);
      if (!task) {
        sendJson(res, 404, { error: `Scheduled task ${id} not found` });
        return;
      }

      try {
        await scheduler.runTask(task);
        sendJson(res, 200, { success: true, message: `Task "${task.name}" executed` });
      } catch (err) {
        sendJson(res, 500, { error: `Task execution failed: ${err.message}` });
      }
      return;
    }

    // ── POST /api/export ──
    if (method === 'POST' && pathname === '/api/export') {
      const body = await parseBody(req);
      const format = body?.format || 'json';
      if (!['csv', 'json', 'markdown'].includes(format)) {
        sendJson(res, 400, { error: 'format must be csv, json, or markdown' });
        return;
      }

      const history = historyManager.load();
      const { content, mimeType, ext } = exportHistory(history, format, body?.taskIds);
      const filename = `browser-history-${new Date().toISOString().slice(0, 10)}.${ext}`;

      log('INFO', 'History exported', { format, entries: body?.taskIds?.length || history.length });
      sendFile(res, 200, content, mimeType, filename);
      return;
    }

    // ── POST /api/session/create ──
    if (method === 'POST' && pathname === '/api/session/create') {
      const config = configManager.get();
      const maxSessions = config?.sessions?.max_concurrent || 3;

      if (sessions.size >= maxSessions) {
        sendJson(res, 400, { error: `Maximum ${maxSessions} concurrent sessions reached` });
        return;
      }

      const sessionId = `session-${crypto.randomUUID().slice(0, 8)}`;
      const body = await parseBody(req);
      const sessionConfig = { ...config, ...(body?.config || {}) };

      try {
        const session = await createBrowserSession(sessionConfig, sessionId);
        const entry = createSessionEntry(sessionId, sessionConfig, session, null);
        sessions.set(sessionId, entry);

        log('INFO', 'Session created', { sessionId });
        sendJson(res, 201, { success: true, session_id: sessionId, message: `Session ${sessionId} created` });
      } catch (err) {
        log('ERROR', 'Session creation failed', { error: err.message });
        sendJson(res, 500, { error: err.message });
      }
      return;
    }

    // ── POST /api/session/:id/run ──
    if (method === 'POST' && pathname.match(/^\/api\/session\/[^/]+\/run$/)) {
      const sessionId = pathname.split('/api/session/')[1].split('/')[0];
      const entry = getSession(sessionId);
      if (!entry) {
        sendJson(res, 404, { error: `Session ${sessionId} not found` });
        return;
      }
      if (entry.taskRunning) {
        sendJson(res, 409, { error: `Session ${sessionId} already running a task` });
        return;
      }

      const body = await parseBody(req);
      const task = body?.task;
      if (!task || typeof task !== 'string' || task.trim().length === 0) {
        sendJson(res, 400, { error: 'task is required and must be a non-empty string' });
        return;
      }

      if (!browserUseAvailable) {
        sendJson(res, 503, { error: 'browser-use package is not installed.' });
        return;
      }

      entry.taskRunning = true;
      entry.lastError = null;

      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const retry = body?.options?.retry !== false;
      log('INFO', 'Session task started', { sessionId, taskId, task: task.substring(0, 200) });

      runBrowserTaskOnSession(entry, taskId, task, body.options, entry.config, retry).catch((err) => {
        log('ERROR', 'Session task failed', { sessionId, taskId, error: err.message });
        entry.lastError = err.message;
        entry.taskRunning = false;
      });

      sendJson(res, 202, { sessionId, taskId, retry, message: `Task started on session ${sessionId}` });
      return;
    }

    // ── GET /api/session/:id/status ──
    if (method === 'GET' && pathname.match(/^\/api\/session\/[^/]+\/status$/)) {
      const sessionId = pathname.split('/api/session/')[1].split('/')[0];
      const entry = getSession(sessionId);
      if (!entry) {
        sendJson(res, 404, { error: `Session ${sessionId} not found` });
        return;
      }
      sendJson(res, 200, {
        session_id: sessionId,
        running: entry.taskRunning,
        session_active: !!entry.session,
        last_error: entry.lastError,
        created: entry.created,
        tabs: entry.tabs || [],
      });
      return;
    }

    // ── POST /api/session/:id/stop ──
    if (method === 'POST' && pathname.match(/^\/api\/session\/[^/]+\/stop$/)) {
      const sessionId = pathname.split('/api/session/')[1].split('/')[0];
      const entry = getSession(sessionId);
      if (!entry) {
        sendJson(res, 404, { error: `Session ${sessionId} not found` });
        return;
      }
      try {
        await stopSession(entry);
        sessions.delete(sessionId);
        log('INFO', 'Session stopped and removed', { sessionId });
        sendJson(res, 200, { success: true, message: `Session ${sessionId} stopped` });
      } catch (err) {
        log('ERROR', 'Error stopping session', { sessionId, error: err.message });
        sessions.delete(sessionId);
        sendJson(res, 200, { success: true, message: `Session ${sessionId} cleared` });
      }
      return;
    }

    // ── GET /api/sessions ──
    if (method === 'GET' && pathname === '/api/sessions') {
      const list = [];
      for (const [id, entry] of sessions) {
        list.push({
          id,
          running: entry.taskRunning,
          session_active: !!entry.session,
          created: entry.created,
          last_error: entry.lastError,
        });
      }
      sendJson(res, 200, { sessions: list, count: list.length });
      return;
    }

    // ═══════════════════════════════════════════
    // Phase 4 Endpoints — Multi-Provider LLM
    // ═══════════════════════════════════════════

    // ── GET /api/providers ──
    if (method === 'GET' && pathname === '/api/providers') {
      const config = configManager.get();
      const migrated = migrateLegacyConfig(config);
      const providers = migrated?.llm?.providers || [];
      const masked = providers.map(p => ({
        ...p,
        apiKey: maskSensitive(p.apiKey || ''),
      }));
      sendJson(res, 200, {
        providers: masked,
        active_provider: migrated?.llm?.active_provider || null,
        active_model: migrated?.llm?.active_model || null,
        supported_types: SUPPORTED_PROVIDER_TYPES,
      });
      return;
    }

    // ── POST /api/providers ──
    if (method === 'POST' && pathname === '/api/providers') {
      const body = await parseBody(req);
      if (!body?.id || typeof body.id !== 'string') {
        sendJson(res, 400, { error: 'id is required and must be a string' });
        return;
      }
      if (!body?.type || typeof body.type !== 'string') {
        sendJson(res, 400, { error: 'type is required and must be a string' });
        return;
      }
      if (!SUPPORTED_PROVIDER_TYPES.includes(body.type)) {
        sendJson(res, 400, {
          error: `Unsupported provider type: ${body.type}`,
          supported: SUPPORTED_PROVIDER_TYPES,
        });
        return;
      }
      if (!body?.name || typeof body.name !== 'string') {
        sendJson(res, 400, { error: 'name is required and must be a string' });
        return;
      }

      const config = configManager.get();
      const migrated = migrateLegacyConfig(config);
      const providers = migrated.llm.providers || [];

      if (providers.some(p => p.id === body.id)) {
        sendJson(res, 409, { error: `Provider with id "${body.id}" already exists` });
        return;
      }

      const newProvider = {
        id: body.id,
        type: body.type,
        name: body.name,
        apiKey: body.apiKey || '',
        baseUrl: body.baseUrl || '',
        models: Array.isArray(body.models) ? body.models : [],
        vision: body.vision || false,
        notes: body.notes || '',
      };

      providers.push(newProvider);
      migrated.llm.providers = providers;
      configManager.set(migrated);

      log('INFO', 'Provider added', { id: newProvider.id, type: newProvider.type });
      sendJson(res, 201, {
        success: true,
        provider: { ...newProvider, apiKey: maskSensitive(newProvider.apiKey) },
      });
      return;
    }

    // ── PUT /api/providers/:id ──
    if (method === 'PUT' && pathname.startsWith('/api/providers/')) {
      const providerId = pathname.split('/api/providers/')[1];
      if (!providerId || providerId.includes('/')) {
        sendJson(res, 400, { error: 'Provider ID is required' });
        return;
      }

      const body = await parseBody(req);
      const config = configManager.get();
      const migrated = migrateLegacyConfig(config);
      const providers = migrated.llm.providers || [];
      const idx = providers.findIndex(p => p.id === providerId);

      if (idx === -1) {
        sendJson(res, 404, { error: `Provider "${providerId}" not found` });
        return;
      }

      const allowed = ['name', 'apiKey', 'baseUrl', 'models', 'vision', 'notes', 'type'];
      for (const key of allowed) {
        if (body[key] !== undefined) {
          providers[idx][key] = body[key];
        }
      }

      if (body.type && !SUPPORTED_PROVIDER_TYPES.includes(body.type)) {
        sendJson(res, 400, {
          error: `Unsupported provider type: ${body.type}`,
          supported: SUPPORTED_PROVIDER_TYPES,
        });
        return;
      }

      configManager.set(migrated);
      log('INFO', 'Provider updated', { id: providerId });
      sendJson(res, 200, {
        success: true,
        provider: { ...providers[idx], apiKey: maskSensitive(providers[idx].apiKey || '') },
      });
      return;
    }

    // ── DELETE /api/providers/:id ──
    if (method === 'DELETE' && pathname.startsWith('/api/providers/')) {
      const providerId = pathname.split('/api/providers/')[1];
      if (!providerId || providerId.includes('/')) {
        sendJson(res, 400, { error: 'Provider ID is required' });
        return;
      }

      const config = configManager.get();
      const migrated = migrateLegacyConfig(config);
      const providers = migrated.llm.providers || [];

      if (migrated.llm.active_provider === providerId) {
        sendJson(res, 400, { error: 'Cannot delete active provider. Switch active provider first.' });
        return;
      }

      const idx = providers.findIndex(p => p.id === providerId);
      if (idx === -1) {
        sendJson(res, 404, { error: `Provider "${providerId}" not found` });
        return;
      }

      providers.splice(idx, 1);
      migrated.llm.providers = providers;
      configManager.set(migrated);

      log('INFO', 'Provider deleted', { id: providerId });
      sendJson(res, 200, { success: true, message: `Provider "${providerId}" removed` });
      return;
    }

    // ── POST /api/providers/:id/test ──
    if (method === 'POST' && pathname.match(/^\/api\/providers\/[^/]+\/test$/)) {
      const providerId = pathname.split('/api/providers/')[1].split('/')[0];

      const config = configManager.get();
      const migrated = migrateLegacyConfig(config);
      const providers = migrated.llm.providers || [];
      const provider = providers.find(p => p.id === providerId);

      if (!provider) {
        sendJson(res, 404, { error: `Provider "${providerId}" not found` });
        return;
      }

      const model = provider.models?.[0] || '';
      if (!model) {
        sendJson(res, 400, { error: 'Provider has no models configured. Add at least one model before testing.' });
        return;
      }

      const testConfig = {
        ...migrated,
        llm: {
          ...migrated.llm,
          active_provider: providerId,
          active_model: model,
        },
      };

      try {
        const llm = await createLLM(testConfig);
        if (llm && typeof llm.ainvoke === 'function') {
          await Promise.race([
            llm.ainvoke([{ role: 'user', content: 'ping' }]),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timed out after 15s')), 15000)),
          ]);
        }
        log('INFO', 'Provider test succeeded', { id: providerId });
        sendJson(res, 200, { success: true, message: 'Connection successful' });
      } catch (err) {
        log('WARN', 'Provider test failed', { id: providerId, error: err.message });
        sendJson(res, 200, { success: false, error: err.message });
      }
      return;
    }

    // ── POST /api/llm/select ──
    if (method === 'POST' && pathname === '/api/llm/select') {
      const body = await parseBody(req);
      if (!body?.providerId || typeof body.providerId !== 'string') {
        sendJson(res, 400, { error: 'providerId is required' });
        return;
      }
      if (!body?.model || typeof body.model !== 'string') {
        sendJson(res, 400, { error: 'model is required' });
        return;
      }

      const config = configManager.get();
      const migrated = migrateLegacyConfig(config);
      const providers = migrated.llm.providers || [];
      const provider = providers.find(p => p.id === body.providerId);

      if (!provider) {
        sendJson(res, 404, { error: `Provider "${body.providerId}" not found` });
        return;
      }

      if (provider.models && provider.models.length > 0 && !provider.models.includes(body.model)) {
        sendJson(res, 400, {
          error: `Model "${body.model}" not in provider's model list`,
          available: provider.models,
        });
        return;
      }

      migrated.llm.active_provider = body.providerId;
      migrated.llm.active_model = body.model;
      configManager.set(migrated);

      log('INFO', 'Active provider changed', { provider: body.providerId, model: body.model });
      sendJson(res, 200, {
        success: true,
        active_provider: body.providerId,
        active_model: body.model,
        provider_name: provider.name,
      });
      return;
    }

    // ── GET /api/llm/status ──
    if (method === 'GET' && pathname === '/api/llm/status') {
      const config = configManager.get();
      const migrated = migrateLegacyConfig(config);
      const llmConfig = migrated?.llm || {};
      const providers = llmConfig.providers || [];
      const activeProvider = providers.find(p => p.id === llmConfig.active_provider);

      sendJson(res, 200, {
        active_provider: llmConfig.active_provider || null,
        active_model: llmConfig.active_model || null,
        provider_name: activeProvider?.name || null,
        provider_type: activeProvider?.type || null,
        vision: activeProvider?.vision || false,
        models: activeProvider?.models || [],
        provider_count: providers.length,
      });
      return;
    }

    // ── 404 ──
    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    log('ERROR', 'Unhandled error', { error: err.message, stack: err.stack });
    sendJson(res, 500, { error: err.message || 'Internal server error' });
  }
}

// ── Task Execution ──

async function runBrowserTask(taskId, task, options, config, useRetry = true) {
  const sessionConfig = config?.session || {};
  const maxSteps = options?.maxSteps || sessionConfig.max_steps || 50;
  const timeoutMs = (options?.timeoutSeconds || sessionConfig.timeout_seconds || 300) * 1000;
  const startTime = Date.now();

  try {
    const result = await runWithRetry(async () => {
      const llm = await createLLM(config);
      const session = await createBrowserSession(config);

      const initialUrl = options?.startUrl;
      if (initialUrl && !isDomainAllowed(initialUrl, config)) {
        throw new Error(`Domain restriction: ${new URL(initialUrl).hostname} is not in allowed domains`);
      }

      if (!Agent) throw new Error('Agent class not available — browser-use package not properly loaded');

      const agent = new Agent({
        task,
        llm,
        maxSteps,
        browserSession: session,
      });

      // Update default session state
      const entry = getSession(DEFAULT_SESSION_ID);
      if (entry) {
        entry.session = session;
        entry.agent = agent;
      } else {
        sessions.set(DEFAULT_SESSION_ID, createSessionEntry(DEFAULT_SESSION_ID, config, session, agent));
      }

      const resultPromise = agent.run();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Task timed out after ${timeoutMs / 1000}s`)), timeoutMs)
      );
      return Promise.race([resultPromise, timeoutPromise]);
    }, config);

    const duration = Date.now() - startTime;
    historyManager.add({
      taskId,
      task: task.substring(0, 200),
      success: true,
      duration,
      screenshotPath: null,
    }, config);
    log('INFO', 'Task completed', { taskId, duration });
    taskRunning = false;
    const entry = getSession(DEFAULT_SESSION_ID);
    if (entry) entry.taskRunning = false;
    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    historyManager.add({
      taskId,
      task: task.substring(0, 200),
      success: false,
      error: err.message,
      duration,
    }, config);
    lastError = err.message;
    taskRunning = false;
    const entry = getSession(DEFAULT_SESSION_ID);
    if (entry) { entry.taskRunning = false; entry.lastError = err.message; }
    throw err;
  }
}

async function runBrowserTaskOnSession(entry, taskId, task, options, config, useRetry = true) {
  const sessionConfig = config?.session || {};
  const maxSteps = options?.maxSteps || sessionConfig.max_steps || 50;
  const timeoutMs = (options?.timeoutSeconds || sessionConfig.timeout_seconds || 300) * 1000;
  const startTime = Date.now();

  try {
    const result = await runWithRetry(async () => {
      const llm = await createLLM(config);
      if (!entry.session) {
        entry.session = await createBrowserSession(config, entry.id);
      }

      const initialUrl = options?.startUrl;
      if (initialUrl && !isDomainAllowed(initialUrl, config)) {
        throw new Error(`Domain restriction: ${new URL(initialUrl).hostname} is not in allowed domains`);
      }

      if (!Agent) throw new Error('Agent class not available — browser-use package not properly loaded');

      entry.agent = new Agent({
        task,
        llm,
        maxSteps,
        browserSession: entry.session,
      });

      const resultPromise = entry.agent.run();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Task timed out after ${timeoutMs / 1000}s`)), timeoutMs)
      );
      return Promise.race([resultPromise, timeoutPromise]);
    }, config);

    const duration = Date.now() - startTime;
    historyManager.add({
      taskId,
      task: task.substring(0, 200),
      success: true,
      duration,
      screenshotPath: null,
      sessionId: entry.id,
    }, config);
    log('INFO', 'Session task completed', { sessionId: entry.id, taskId, duration });
    entry.taskRunning = false;
    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    historyManager.add({
      taskId,
      task: task.substring(0, 200),
      success: false,
      error: err.message,
      duration,
      sessionId: entry.id,
    }, config);
    entry.lastError = err.message;
    entry.taskRunning = false;
    throw err;
  }
}

// ── Graceful Shutdown ──

async function shutdown() {
  log('INFO', 'Shutting down...');
  scheduler.stopAll();
  for (const [id, entry] of sessions) {
    try { await stopSession(entry); } catch { /* best effort */ }
  }
  sessions.clear();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ── Start Server ──

await loadBrowserUse();
ensureDir(SCREENSHOTS_DIR);

// Initialize default session entry
sessions.set(DEFAULT_SESSION_ID, createSessionEntry(DEFAULT_SESSION_ID, configManager.get(), null, null));

const startupConfig = configManager.validate(configManager.get());
if (startupConfig.warnings.length > 0) {
  startupConfig.warnings.forEach(w => log('WARN', `Config issue: ${w}`));
}

// Load and start scheduler
scheduler.load();
scheduler.startAll();

const server = http.createServer(handler);
server.listen(PORT, () => {
  log('INFO', `Browser Use server listening on :${PORT}`);
  log('INFO', `Config: ${CONFIG_PATH}`);
  log('INFO', `browser-use installed: ${browserUseAvailable}`);

  if (!browserUseAvailable) {
    log('WARN', 'Running in stub mode — install browser-use to enable automation');
  }

  const config = configManager.get();
  if (config?.browser?.allowed_domains?.length > 0) {
    log('WARN', 'Domain restrictions active', { domains: config.browser.allowed_domains });
  }

  const profileDir = join(ROOT_DIR, config?.browser?.user_data_dir || 'data/browser-use/profiles');
  log('INFO', `Persistent profile: ${existsSync(profileDir) ? 'found' : 'will be created'}`, { dir: profileDir });

  if (config?.history?.enabled) {
    log('INFO', 'Task history enabled', { max_entries: config.history.max_entries || 100 });
  }

  if (config?.scheduler?.enabled !== false) {
    const scheduledCount = scheduler.list().filter(t => t.enabled).length;
    log('INFO', `Scheduler: ${scheduledCount} active tasks`);
  }

  const maxSessions = config?.sessions?.max_concurrent || 3;
  log('INFO', `Sessions: max ${maxSessions} concurrent`);
});
