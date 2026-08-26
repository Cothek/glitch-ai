// Debug model route — reads opencode.json + queries opencode.db for actual runtime models
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

// === Part 1: Read opencode.json config ===
console.log('=== OPENCODE.JSON CONFIG ===');
const configPath = join(ROOT_DIR, 'opencode.json');
if (!existsSync(configPath)) {
  console.log('opencode.json not found at:', configPath);
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const memModel = config.agent?.memory?.model;
console.log(`memory.model = "${memModel}"`);

const nvidiaModels = config.provider?.nvidia?.models || {};
const nvidiaKeys = Object.keys(nvidiaModels);
console.log(`provider.nvidia.models count = ${nvidiaKeys.length}`);

const stripped = memModel ? memModel.split('/').slice(1).join('/') : '';
const hasFull = nvidiaKeys.includes(memModel);
const hasStripped = nvidiaKeys.includes(stripped);
console.log(`Full key "${memModel}" exists: ${hasFull}`);
console.log(`Stripped key "${stripped}" exists: ${hasStripped}`);

// First 5 nvidia keys
console.log(`First 5 nvidia keys: ${nvidiaKeys.slice(0, 5).join(', ')}`);

// All agent models
console.log('\n=== ALL AGENT MODELS ===');
for (const [name, def] of Object.entries(config.agent || {})) {
  if (def?.model) {
    console.log(`  ${name}: ${def.model}`);
  }
}

// === Part 2: Query opencode.db ===
const dbPath = 'C:\\Users\\cothe\\.local\\share\\opencode\\opencode.db';
if (!existsSync(dbPath)) {
  console.log('\nopencode.db not found at:', dbPath);
  process.exit(0);
}

const db = new DatabaseSync(dbPath, { readOnly: true });

// Memory agent sessions — find sessions where agent name contains "memory"
console.log('\n=== MEMORY AGENT SESSIONS (last 30) ===');
try {
  const memSessions = db.prepare(`
    SELECT id, agent, model, parent_id, time_created, time_updated
    FROM session
    WHERE agent LIKE '%memory%'
    ORDER BY time_updated DESC
    LIMIT 30
  `).all();
  
  for (const s of memSessions) {
    const modelObj = typeof s.model === 'string' ? JSON.parse(s.model) : s.model;
    const modelId = modelObj?.id || 'null';
    const providerId = modelObj?.providerID || 'null';
    const variant = modelObj?.variant || '';
    const fullModel = `${providerId}/${modelId}${variant ? '/' + variant : ''}`;
    const date = new Date(s.time_updated * 1000).toISOString().slice(0, 19);
    console.log(`  ${s.id.slice(0, 20)}... | agent="${s.agent}" | model="${fullModel}" | updated=${date}`);
  }
  
  // Distinct models used by memory agent
  console.log('\n=== DISTINCT MODELS USED BY MEMORY AGENT ===');
  const memModels = db.prepare(`
    SELECT model, COUNT(*) as cnt
    FROM session
    WHERE agent LIKE '%memory%'
    GROUP BY model
    ORDER BY cnt DESC
  `).all();
  
  for (const r of memModels) {
    const modelObj = typeof r.model === 'string' ? JSON.parse(r.model) : r.model;
    const modelId = modelObj?.id || 'null';
    const providerId = modelObj?.providerID || 'null';
    const variant = modelObj?.variant || '';
    console.log(`  ${providerId}/${modelId}${variant ? '/' + variant : ''}: ${r.cnt} sessions`);
  }
} catch (e) {
  console.log('Memory session query failed:', e.message);
}

// All sessions with model (recent 20)
console.log('\n=== ALL RECENT SESSIONS WITH MODEL (last 20) ===');
try {
  const allSessions = db.prepare(`
    SELECT id, agent, model, time_updated
    FROM session
    WHERE model IS NOT NULL
    ORDER BY time_updated DESC
    LIMIT 20
  `).all();
  
  for (const s of allSessions) {
    const modelObj = typeof s.model === 'string' ? JSON.parse(s.model) : s.model;
    const modelId = modelObj?.id || 'null';
    const providerId = modelObj?.providerID || 'null';
    const variant = modelObj?.variant || '';
    const fullModel = `${providerId}/${modelId}${variant ? '/' + variant : ''}`;
    const date = new Date(s.time_updated * 1000).toISOString().slice(0, 19);
    console.log(`  ${s.id.slice(0, 20)}... | agent="${s.agent}" | model="${fullModel}" | updated=${date}`);
  }
} catch (e) {
  console.log('Recent sessions query failed:', e.message);
}

// Distinct models across ALL sessions
console.log('\n=== DISTINCT MODELS ACROSS ALL SESSIONS (top 20) ===');
try {
  const allModels = db.prepare(`
    SELECT model, COUNT(*) as cnt
    FROM session
    WHERE model IS NOT NULL
    GROUP BY model
    ORDER BY cnt DESC
    LIMIT 20
  `).all();
  
  for (const r of allModels) {
    const modelObj = typeof r.model === 'string' ? JSON.parse(r.model) : r.model;
    const modelId = modelObj?.id || 'null';
    const providerId = modelObj?.providerID || 'null';
    const variant = modelObj?.variant || '';
    console.log(`  ${providerId}/${modelId}${variant ? '/' + variant : ''}: ${r.cnt} sessions`);
  }
} catch (e) {
  console.log('All models query failed:', e.message);
}

// === Part 3: Grep data/launch.log for [DEBUG-MODEL] ===
console.log('\n=== [DEBUG-MODEL] LINES FROM LAUNCH.LOG ===');
const logPath = join(ROOT_DIR, 'data', 'launch.log');
if (!existsSync(logPath)) {
  console.log('launch.log not found at:', logPath);
} else {
  const logContent = readFileSync(logPath, 'utf-8');
  const debugLines = logContent.split('\n').filter(line => line.includes('[DEBUG-MODEL]'));
  if (debugLines.length === 0) {
    console.log('No [DEBUG-MODEL] lines yet — restart Glitch to generate them');
  } else {
    const last20 = debugLines.slice(-20);
    console.log(`Found ${debugLines.length} total [DEBUG-MODEL] lines (showing last ${last20.length}):`);
    for (const line of last20) {
      console.log(`  ${line}`);
    }
  }
}

db.close();
console.log('\nDone.');
