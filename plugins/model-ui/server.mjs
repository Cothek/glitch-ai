import http from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, exec, execFileSync } from 'node:child_process';
import { migrateModelAssignments } from '../../scripts/lib/migrate-assignments.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..', '..');
const PORT = parseInt(process.env.MODEL_UI_PORT || '4104', 10);
const TEMPLATE_PATH = join(ROOT_DIR, 'config', 'opencode-normal.json');
const ASSIGNMENTS_PATH = join(ROOT_DIR, 'user', 'model-assignments.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

let pendingChanges = [];
let lastBackupPath = null;

let registryCache = null;
let registryCacheTime = 0;
const REGISTRY_CACHE_TTL = 30_000; // 30 seconds

let configCache = null;
let configCacheTime = 0;
const CONFIG_CACHE_TTL = 5_000; // 5 seconds

let refreshState = { running: false, startedAt: null, finishedAt: null, error: null, result: null, output: null };
let refreshStdout = '';
let refreshStderr = '';

const REGISTRY_PATHS = [
  join(ROOT_DIR, 'config', 'model-registry.json'),
  join(ROOT_DIR, 'data', 'model-registry.json'),
];

function getRegistry() {
  const now = Date.now();
  if (registryCache && now - registryCacheTime < REGISTRY_CACHE_TTL) {
    return registryCache;
  }
  for (const p of REGISTRY_PATHS) {
    const d = readJson(p);
    if (d) { registryCache = d; break; }
  }
  registryCacheTime = now;
  return registryCache;
}

function getConfig() {
  const now = Date.now();
  if (configCache && now - configCacheTime < CONFIG_CACHE_TTL) {
    return configCache;
  }
  configCache = readJson(join(ROOT_DIR, 'opencode.json'));
  configCacheTime = now;
  return configCache;
}

function readJson(path) {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8');
    const cleaned = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function writeJson(path, data) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

const isWin = process.platform === 'win32';

function toPerMillion(perToken) {
  return perToken != null ? Math.max(0, Math.round(perToken * 1_000_000 * 100) / 100) : null;
}

/**
 * Find the real per-million-token cost for a model, even if it's free.
 * 1. If model has own nonzero pricing -> return it (NVIDIA native free models with real prices).
 * 2. Else if free-looking (tier==='free' or id endsWith '-free' or ':free'):
 *    strip suffix, look up paid sibling in the FULL registry, return sibling's pricing.
 * 3. Else null.
 */
function findUnderlyingCost(model, registryModels) {
  if (!model || !Array.isArray(registryModels)) return null;

  const pricing = model.pricing;
  const hasOwn = pricing && (
    (typeof pricing.prompt === 'number' && pricing.prompt > 0) ||
    (typeof pricing.completion === 'number' && pricing.completion > 0)
  );
  if (hasOwn) return pricing;

  const isFree = model.tier === 'free' || model.free === true
    || (typeof model.id === 'string' && (model.id.endsWith('-free') || model.id.endsWith(':free')));
  if (!isFree) return null;

  let siblingId = model.id;
  if (siblingId.endsWith('-free')) siblingId = siblingId.slice(0, -5);
  else if (siblingId.endsWith(':free')) siblingId = siblingId.slice(0, -5);

  const sibling = registryModels.find((m) => m.id === siblingId);
  const sp = sibling?.pricing;
  if (sp && (
    (typeof sp.prompt === 'number' && sp.prompt > 0) ||
    (typeof sp.completion === 'number' && sp.completion > 0)
  )) return sp;

  return null;
}

/**
 * Estimate pricing for models without direct pricing data by fuzzy-matching
 * against OpenRouter models. Returns { prompt, completion, estimated: true }
 * or null if no reasonable match found.
 * Coverage: ~89.5% of models with null/zero pricing.
 */
function findEstimatedCost(model, orModels) {
  if (!model || !Array.isArray(orModels) || orModels.length === 0) return null;
  // Skip if model already has pricing
  if (model.pricing && (
    (typeof model.pricing.prompt === 'number' && model.pricing.prompt > 0) ||
    (typeof model.pricing.completion === 'number' && model.pricing.completion > 0)
  )) return null;

  const skipWords = new Set(['nvidia','opencode','free','zen','go','openrouter','ai','the','and','for','with','batch','latest','instruct','flash','creative']);
  const tokens = model.id.toLowerCase().split(/[\s\/\-_.]+/).filter(t => t.length > 2 && !skipWords.has(t));
  if (tokens.length === 0) return null;

  let best = null, bestScore = 0;
  for (const or of orModels) {
    const orTokens = new Set(or.id.toLowerCase().split(/[\s\/\-_.]+/).filter(t => t.length > 2 && !skipWords.has(t)));
    let score = 0;
    for (const t of tokens) {
      if (orTokens.has(t)) score += 1;
      for (const ot of orTokens) {
        if (ot.includes(t) || t.includes(ot)) { score += 0.5; break; }
      }
    }
    if (score > bestScore) { bestScore = score; best = or; }
  }
  if (bestScore < 1 || !best?.pricing) return null;
  return { prompt: best.pricing.prompt, completion: best.pricing.completion, estimated: true };
}

function resolvePowerShell() {
  if (isWin) {
    try {
      const where = execFileSync('where.exe', ['pwsh'], { encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
      const first = where.split(/\r?\n/).find(l => l.trim().length > 0);
      if (first && existsSync(first.trim())) {
        try { if (statSync(first.trim()).size === 0) { /* WindowsApps 0-byte alias, skip */ } else return first.trim(); } catch {}
      }
    } catch {}
    const pf7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
    if (existsSync(pf7)) return pf7;
    const waPwsh = join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'pwsh.exe');
    if (existsSync(waPwsh)) {
      try { if (statSync(waPwsh).size > 0) return waPwsh; } catch {}
    }
    return 'powershell.exe';
  }
  try { execFileSync('which', ['pwsh'], { encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }); return 'pwsh'; } catch {}
  return 'powershell';
}

function backupConfig() {
  const backupDir = join(ROOT_DIR, 'data', 'backups');
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupDir, `opencode-pre-model-ui-${ts}.json`);
  copyFileSync(join(ROOT_DIR, 'opencode.json'), backupPath);
  // Also back up the template (source of truth for normal mode)
  const templatePath = TEMPLATE_PATH;
  if (existsSync(templatePath)) {
    const templateBackupPath = join(backupDir, `opencode-normal-pre-model-ui-${ts}.json`);
    copyFileSync(templatePath, templateBackupPath);
  }
  return backupPath;
}

function lookupModel(modelId, registry) {
  if (!registry?.models) return null;
  return registry.models.find((m) => m.id === modelId) || null;
}

function getAgentTier(agentName, modelId, registry) {
  const model = lookupModel(modelId, registry);
  return model?.tier || 'unknown';
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function parseUrl(req) {
  return new URL(req.url, `http://${req.headers.host || 'localhost'}`);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : null);
      } catch {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}

function extractAgents(config) {
  const agents = [];
  const agentBlock = config?.agent || {};
  for (const [name, def] of Object.entries(agentBlock)) {
    if (def && typeof def === 'object' && def.model) {
      agents.push({ name, model: def.model });
    }
  }
  return agents;
}

function restartOpenCode() {
  const restartFlagPath = join(ROOT_DIR, 'data', '.restart-flag');
  const pidFilePath = join(ROOT_DIR, 'data', 'opencode.pid');
  let pidStr;
  try {
    pidStr = readFileSync(pidFilePath, 'utf-8').trim();
  } catch (e) {
    return { ok: false, error: `PID file not found: ${e.message}`, code: 'NO_PID_FILE' };
  }
  const pid = parseInt(pidStr, 10);
  if (!pid || pid <= 0 || isNaN(pid)) {
    return { ok: false, error: `Invalid PID in file: "${pidStr}"`, code: 'INVALID_PID' };
  }
  // Write the PID into the restart flag so the supervisor can wait for the
  // old process tree to fully die before spawning the replacement (PM-034).
  writeFileSync(restartFlagPath, String(pid), 'utf-8');
  const logPath = join(ROOT_DIR, 'data', 'restart-kill.log');

  setTimeout(() => {
    try {
      const logMsg = `[${new Date().toISOString()}] Killing opencode PID ${pid}...\n`;
      writeFileSync(logPath, logMsg, 'utf-8');
      if (process.platform === 'win32') {
        const killProc = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        killProc.stdout.on('data', (d) => { stdout += d.toString(); });
        killProc.stderr.on('data', (d) => { stderr += d.toString(); });
        killProc.on('close', (code) => {
          writeFileSync(logPath, `exit code: ${code}\nstdout: ${stdout}\nstderr: ${stderr}\n`, 'utf-8');
        });
      } else {
        process.kill(pid, 'SIGTERM');
        writeFileSync(logPath, 'SIGTERM sent\n', 'utf-8');
      }
    } catch (e) {
      writeFileSync(logPath, `Error: ${e.message}\n`, 'utf-8');
    }
  }, 2000);

  return { ok: true };
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const url = parseUrl(req);
  const pathname = url.pathname;

  try {
    if (req.method === 'GET' && pathname === '/') {
      const htmlPath = join(ROOT_DIR, 'plugins', 'model-ui', 'index.html');
      if (!existsSync(htmlPath)) {
        sendJson(res, 404, { error: 'index.html not found' });
        return;
      }
      const html = readFileSync(htmlPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/plugins/glitch-ui/')) {
      const relPath = pathname.replace('/plugins/glitch-ui/', '');
      const filePath = join(ROOT_DIR, 'plugins', 'glitch-ui', relPath);
      if (!existsSync(filePath)) {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const content = readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/plugins') {
      const { listPlugins } = await import('../../scripts/lib/plugin-manager.mjs');
      const plugins = listPlugins();
      sendJson(res, 200, { plugins });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/plugins/toggle') {
      const body = await parseBody(req);
      const name = body?.name || 'model-ui';
      const { isEnabled, setEnabled } = await import('../../scripts/lib/plugin-manager.mjs');
      const currently = isEnabled(name);
      setEnabled(name, !currently);
      sendJson(res, 200, {
        name,
        enabled: !currently,
        message: `Plugin "${name}" ${!currently ? 'enabled' : 'disabled'}. Will take effect on next restart.`,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/agents') {
      const config = getConfig();
      if (!config) {
        sendJson(res, 500, { error: 'opencode.json not found or invalid' });
        return;
      }
      const registry = getRegistry();
      const rawAgents = extractAgents(config);
      const allModels = registry?.models || [];
      const orModels = allModels.filter(m => m.source === 'openrouter' && m.pricing && (m.pricing.prompt > 0 || m.pricing.completion > 0));
      const agents = rawAgents.map((a) => {
        const model = lookupModel(a.model, registry);
        const u = findUnderlyingCost(model, allModels);
        const e = u ? null : findEstimatedCost(model, orModels);
        return {
          name: a.name,
          current_model: a.model,
          model_name: model?.name || a.model,
          tier: model?.tier || 'unknown',
          capabilities: model?.capabilities || [],
          context_length: model?.context_length || null,
          cost_per_million_input: toPerMillion(model?.pricing?.prompt),
          cost_per_million_output: toPerMillion(model?.pricing?.completion),
          underlying_cost_per_million_input: u ? toPerMillion(u.prompt) : null,
          underlying_cost_per_million_output: u ? toPerMillion(u.completion) : null,
          estimated_cost_per_million_input: e ? toPerMillion(e.prompt) : null,
          estimated_cost_per_million_output: e ? toPerMillion(e.completion) : null,
        };
      });
      sendJson(res, 200, { agents });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/models') {
      const registry = getRegistry();
      if (!registry) {
        sendJson(res, 500, { error: 'config/model-registry.json not found' });
        return;
      }

      let models = registry.models || [];
      const search = url.searchParams.get('search');
      const tier = url.searchParams.get('tier');
      const provider = url.searchParams.get('provider');
      const capability = url.searchParams.get('capability');
      const agent = url.searchParams.get('agent');

      if (search) {
        const q = search.toLowerCase();
        models = models.filter(
          (m) =>
            m.id?.toLowerCase().includes(q) ||
            m.name?.toLowerCase().includes(q),
        );
      }
      if (tier) {
        const matchTier = tier === 'budget' ? ['budget', 'budget_paid'] : [tier];
        models = models.filter((m) => matchTier.includes(m.tier));
      }
      if (provider) {
        models = models.filter((m) => m.source === provider);
      }
      if (capability) {
        models = models.filter(
          (m) => Array.isArray(m.capabilities) && m.capabilities.includes(capability),
        );
      }
      if (agent === 'vision') {
        models = models.filter((m) => m.vision === true);
      }

      const providers = [...new Set((registry.models || []).map((m) => m.source).filter(Boolean))];
      const tiers = [...new Set((registry.models || []).map((m) => m.tier).filter(Boolean))];
      const capabilities = [...new Set((registry.models || []).flatMap(m => m.capabilities || []))].sort();

      const fullModels = registry.models || [];
      const orModels = fullModels.filter(m => m.source === 'openrouter' && m.pricing && (m.pricing.prompt > 0 || m.pricing.completion > 0));
      sendJson(res, 200, {
        models: models.map((m) => {
          const u = findUnderlyingCost(m, fullModels);
          const e = u ? null : findEstimatedCost(m, orModels);
          return {
            id: m.id,
            name: m.name,
            provider: m.source,
            source: m.source,
            tier: m.tier,
            context_length: m.context_length,
            capabilities: m.capabilities || [],
            vision: m.vision || false,
            cost_per_million_input: toPerMillion(m.pricing?.prompt),
            cost_per_million_output: toPerMillion(m.pricing?.completion),
            underlying_cost_per_million_input: u ? toPerMillion(u.prompt) : null,
            underlying_cost_per_million_output: u ? toPerMillion(u.completion) : null,
            estimated_cost_per_million_input: e ? toPerMillion(e.prompt) : null,
            estimated_cost_per_million_output: e ? toPerMillion(e.completion) : null,
          };
        }),
        total: models.length,
        providers,
        tiers,
        capabilities,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/assign') {
      const body = await parseBody(req);
      if (!body?.agent || !body?.model) {
        sendJson(res, 400, { error: 'agent and model are required' });
        return;
      }

      const config = getConfig();
      if (!config) {
        sendJson(res, 500, { error: 'opencode.json not found or invalid' });
        return;
      }

      const registry = getRegistry();
      const agentDef = config.agent?.[body.agent];
      if (!agentDef) {
        sendJson(res, 400, { error: `Agent "${body.agent}" not found in config` });
        return;
      }

      const model = lookupModel(body.model, registry);
      if (!model) {
        sendJson(res, 400, { error: `Model "${body.model}" not found in registry` });
        return;
      }

      if (pendingChanges.length === 0) {
        lastBackupPath = backupConfig();
      }

      const oldModel = agentDef.model;
      const tier = model.tier || 'unknown';

      const existing = pendingChanges.findIndex((c) => c.agent === body.agent);
      const change = {
        agent: body.agent,
        old_model: existing >= 0 ? pendingChanges[existing].old_model : oldModel,
        new_model: body.model,
        tier,
      };

      if (existing >= 0) {
        pendingChanges[existing] = change;
      } else {
        pendingChanges.push(change);
      }

      sendJson(res, 200, {
        success: true,
        change,
        backup_path: lastBackupPath ? lastBackupPath.replace(ROOT_DIR + '\\', '').replace(ROOT_DIR + '/', '') : null,
        pending: true,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/pending') {
      sendJson(res, 200, {
        pending: pendingChanges.length > 0,
        changes: pendingChanges,
        backup_path: lastBackupPath ? lastBackupPath.replace(ROOT_DIR + '\\', '').replace(ROOT_DIR + '/', '') : null,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/apply') {
      if (pendingChanges.length === 0) {
        sendJson(res, 400, { error: 'No pending changes to apply' });
        return;
      }

      // Write pending changes to model-assignments.json
      const assignments = readJson(ASSIGNMENTS_PATH) || {};
      for (const change of pendingChanges) {
        assignments[change.agent] = change.new_model;
      }
      writeJson(ASSIGNMENTS_PATH, assignments);

      const applied = pendingChanges.length;
      const changes = [...pendingChanges];
      pendingChanges = [];

      sendJson(res, 200, {
        success: true,
        applied,
        changes,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/apply-and-restart') {
      if (pendingChanges.length === 0) {
        sendJson(res, 400, { error: 'No pending changes to apply' });
        return;
      }
      const assignments = readJson(ASSIGNMENTS_PATH) || {};
      for (const change of pendingChanges) {
        assignments[change.agent] = change.new_model;
      }
      writeJson(ASSIGNMENTS_PATH, assignments);
      const applied = pendingChanges.length;
      const changes = [...pendingChanges];
      pendingChanges = [];

      const restartResult = restartOpenCode();
      if (!restartResult.ok) {
        sendJson(res, 503, { success: true, applied, changes, restarting: false, restart_error: restartResult.error, restart_code: restartResult.code });
        return;
      }
      sendJson(res, 200, { success: true, applied, changes, restarting: true });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/restart') {
      const restartResult = restartOpenCode();
      if (!restartResult.ok) {
        sendJson(res, 503, { ok: false, error: restartResult.error, code: restartResult.code });
        return;
      }
      sendJson(res, 200, { ok: true, restarting: true });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/rollback') {
      const rolledBack = pendingChanges.length;
      pendingChanges = [];
      lastBackupPath = null;
      sendJson(res, 200, { success: true, rolled_back: rolledBack });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/status') {
      const config = getConfig();
      const registry = getRegistry();
      const backupDir = join(ROOT_DIR, 'data', 'backups');

      let registryAgeHours = null;
      if (registry?.generated_at) {
        const generated = new Date(registry.generated_at);
        if (!isNaN(generated.getTime())) {
          registryAgeHours = Math.round((Date.now() - generated.getTime()) / 3600000 * 10) / 10;
        }
      }

      sendJson(res, 200, {
        opencode_config: config ? 'valid' : 'missing',
        registry: registry ? 'loaded' : 'missing',
        registry_models: registry?.models?.length || 0,
        registry_age_hours: registryAgeHours,
        pending_changes: pendingChanges.length,
        backup_dir: existsSync(backupDir) ? 'data/backups' : 'not created',
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/refresh-models') {
      if (refreshState.running) {
        sendJson(res, 409, { ok: false, error: 'Refresh already in progress', startedAt: refreshState.startedAt });
        return;
      }

      const scriptPath = join(ROOT_DIR, 'scripts', 'check-models.ps1');
      if (!existsSync(scriptPath)) {
        sendJson(res, 500, { ok: false, error: 'check-models.ps1 not found' });
        return;
      }

      const psExe = resolvePowerShell();
      if (!psExe) {
        sendJson(res, 500, { ok: false, error: 'No PowerShell found (tried pwsh, Program Files, WindowsApps, powershell.exe)' });
        return;
      }

      refreshState = { running: true, startedAt: new Date().toISOString(), finishedAt: null, error: null, result: null };

      let proc;
      try {
        proc = spawn(psExe, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-UpdateCache', '-Force'], {
          cwd: ROOT_DIR,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (spawnErr) {
        refreshState = { running: false, startedAt: refreshState.startedAt, finishedAt: new Date().toISOString(), error: `Failed to spawn ${psExe}: ${spawnErr.message}`, result: null };
        sendJson(res, 500, { ok: false, error: `Failed to spawn ${psExe}: ${spawnErr.message}` });
        return;
      }

      refreshStdout = '';
      refreshStderr = '';
      proc.stdout.on('data', (d) => { refreshStdout += d.toString(); });
      proc.stderr.on('data', (d) => { refreshStderr += d.toString(); });

      const REFRESH_TIMEOUT_MS = 600_000;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        try { proc.kill('SIGTERM'); } catch {}
      }, REFRESH_TIMEOUT_MS);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          const lastLines = refreshStderr.trim().split('\n').slice(-10).join('\n');
          const errorMsg = timedOut
            ? `check-models.ps1 timed out after ${REFRESH_TIMEOUT_MS / 1000}s`
            : `check-models.ps1 exited with code ${code}`;
          refreshState = { running: false, startedAt: refreshState.startedAt, finishedAt: new Date().toISOString(), error: errorMsg, result: null };
          return;
        }

        registryCacheTime = 0;
        const freshRegistry = getRegistry();
        const total = freshRegistry?.models?.length || 0;
        const nvidia = (freshRegistry?.models || []).filter((m) => m.id?.startsWith('nvidia/')).length;
        const generatedAt = freshRegistry?.generated_at || null;

        refreshState = {
          running: false,
          startedAt: refreshState.startedAt,
          finishedAt: new Date().toISOString(),
          error: null,
          result: { ok: true, total, nvidia, generatedAt, refreshedAt: new Date().toISOString() },
        };
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        refreshState = { running: false, startedAt: refreshState.startedAt, finishedAt: new Date().toISOString(), error: `Failed to spawn ${psExe}: ${err.message}`, result: null };
      });

      // Return immediately — client polls GET /api/refresh-status
      sendJson(res, 202, { ok: true, message: 'Refresh started', startedAt: refreshState.startedAt });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/refresh-status') {
      // Extract last non-empty line from stdout for client display
      const outputLines = refreshStdout.trim().split('\n').filter(l => l.trim());
      const lastLine = outputLines.length > 0 ? outputLines[outputLines.length - 1] : '';
      sendJson(res, 200, {
        running: refreshState.running,
        startedAt: refreshState.startedAt,
        finishedAt: refreshState.finishedAt,
        error: refreshState.error,
        result: refreshState.result,
        output: lastLine,
      });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Internal server error' });
  }
}

// One-time migration: copy legacy data/model-assignments.json to user/ if needed
migrateModelAssignments(ROOT_DIR, (color, msg) => console.log(`${color}${msg}\x1b[0m`));

const server = http.createServer(handler);
server.listen(PORT, () => {
  console.log(`Model UI server listening on :${PORT}`);
  console.log(`OpenCode config: ${join(ROOT_DIR, 'opencode.json')}`);
  const registry = getRegistry();
  console.log(`Registry: ${registry?.models?.length || 0} models loaded`);
});
