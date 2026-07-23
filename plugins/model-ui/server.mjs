import http from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, exec } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..', '..');
const PORT = parseInt(process.env.MODEL_UI_PORT || '4104', 10);
const TEMPLATE_PATH = join(ROOT_DIR, 'config', 'opencode-normal.json');
const ASSIGNMENTS_PATH = join(ROOT_DIR, 'data', 'model-assignments.json');

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

function getRegistry() {
  const now = Date.now();
  if (registryCache && now - registryCacheTime < REGISTRY_CACHE_TTL) {
    return registryCache;
  }
  registryCache = readJson(join(ROOT_DIR, 'data', 'model-registry.json'));
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
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
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
      const agents = rawAgents.map((a) => {
        const model = lookupModel(a.model, registry);
        return {
          name: a.name,
          current_model: a.model,
          model_name: model?.name || a.model,
          tier: model?.tier || 'unknown',
          capabilities: model?.capabilities || [],
          context_length: model?.context_length || null,
        };
      });
      sendJson(res, 200, { agents });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/models') {
      const registry = getRegistry();
      if (!registry) {
        sendJson(res, 500, { error: 'model-registry.json not found' });
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
        models = models.filter((m) => m.tier === tier);
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

      sendJson(res, 200, {
        models: models.map((m) => ({
          id: m.id,
          name: m.name,
          provider: m.source,
          source: m.source,
          tier: m.tier,
          context_length: m.context_length,
          capabilities: m.capabilities || [],
          vision: m.vision || false,
          cost_per_million_input: m.cost_per_million_input ?? 0,
          cost_per_million_output: m.cost_per_million_output ?? 0,
        })),
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

      // Write pending changes to model-assignments.json (persistent overrides file)
      const assignments = readJson(ASSIGNMENTS_PATH) || {};
      for (const change of pendingChanges) {
        assignments[change.agent] = change.new_model;
      }
      writeJson(ASSIGNMENTS_PATH, assignments);

      const applied = pendingChanges.length;
      const changes = [...pendingChanges];
      pendingChanges = [];

      // Write restart flag so serve.mjs/launch.mjs knows to restart
      const restartFlagPath = join(ROOT_DIR, 'data', '.restart-flag');
      writeFileSync(restartFlagPath, '1', 'utf-8');

      // Send response first
      sendJson(res, 200, {
        success: true,
        applied,
        changes,
        restarting: true,
      });

      // Kill opencode after 2s delay
      const pidFilePath = join(ROOT_DIR, 'data', 'opencode.pid');
      const logPath = join(ROOT_DIR, 'data', 'restart-kill.log');
      setTimeout(() => {
        try {
          const pidStr = readFileSync(pidFilePath, 'utf-8').trim();
          const pid = parseInt(pidStr, 10);
          if (pid > 0) {
            const logMsg = `[${new Date().toISOString()}] Killing opencode PID ${pid}...\n`;
            writeFileSync(logPath, logMsg, 'utf-8');
            if (process.platform === 'win32') {
              const killProc = spawn('taskkill', ['/PID', String(pid), '/F'], {
                stdio: ['ignore', 'pipe', 'pipe'],
              });
              let stdout = '';
              let stderr = '';
              killProc.stdout.on('data', (d) => { stdout += d.toString(); });
              killProc.stderr.on('data', (d) => { stderr += d.toString(); });
              killProc.on('close', (code) => {
                const result = `exit code: ${code}\nstdout: ${stdout}\nstderr: ${stderr}\n`;
                writeFileSync(logPath, result, 'utf-8');
              });
            } else {
              process.kill(pid, 'SIGTERM');
              writeFileSync(logPath, 'SIGTERM sent\n', 'utf-8');
            }
          }
        } catch (e) {
          writeFileSync(logPath, `Error: ${e.message}\n`, 'utf-8');
        }
      }, 2000);
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

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Internal server error' });
  }
}

const server = http.createServer(handler);
server.listen(PORT, () => {
  console.log(`Model UI server listening on :${PORT}`);
  console.log(`OpenCode config: ${join(ROOT_DIR, 'opencode.json')}`);
  const registry = readJson(join(ROOT_DIR, 'data', 'model-registry.json'));
  console.log(`Registry: ${registry?.models?.length || 0} models loaded`);
});
