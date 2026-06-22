import fs from 'fs';
import path from 'path';
import http from 'http';
import readline from 'readline';

const COMFYUI_HOST = '127.0.0.1';
const COMFYUI_PORT = 8188;

// ─── Default SDXL txt2img workflow (ComfyUI API format) ───────────────────────

const DEFAULT_WORKFLOW = {
  "1": {
    "inputs": { "ckpt_name": "sd_xl_base_1.0.safetensors" },
    "class_type": "CheckpointLoaderSimple",
    "_meta": { "title": "Load Checkpoint" }
  },
  "2": {
    "inputs": {
      "text": "beautiful scenery nature glass bottle landscape, purple galaxy bottle",
      "clip": ["1", 1]
    },
    "class_type": "CLIPTextEncode",
    "_meta": { "title": "CLIP Text Encode (Prompt)" }
  },
  "3": {
    "inputs": {
      "text": "text, watermark",
      "clip": ["1", 1]
    },
    "class_type": "CLIPTextEncode",
    "_meta": { "title": "CLIP Text Encode (Prompt)" }
  },
  "4": {
    "inputs": { "width": 1024, "height": 1024, "batch_size": 1 },
    "class_type": "EmptyLatentImage",
    "_meta": { "title": "Empty Latent Image" }
  },
  "5": {
    "inputs": {
      "seed": 123456789,
      "steps": 20,
      "cfg": 7.0,
      "sampler_name": "euler",
      "scheduler": "normal",
      "denoise": 1.0,
      "model": ["1", 0],
      "positive": ["2", 0],
      "negative": ["3", 0],
      "latent_image": ["4", 0]
    },
    "class_type": "KSampler",
    "_meta": { "title": "KSampler" }
  },
  "6": {
    "inputs": {
      "samples": ["5", 0],
      "vae": ["1", 2]
    },
    "class_type": "VAEDecode",
    "_meta": { "title": "VAE Decode" }
  },
  "7": {
    "inputs": {
      "filename_prefix": "ComfyUI",
      "images": ["6", 0]
    },
    "class_type": "SaveImage",
    "_meta": { "title": "Save Image" }
  }
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', (err) => reject(err));
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function comfyuiGet(route) {
  return httpRequest({
    hostname: COMFYUI_HOST,
    port: COMFYUI_PORT,
    path: route,
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
}

async function comfyuiPost(route, body) {
  return httpRequest({
    hostname: COMFYUI_HOST,
    port: COMFYUI_PORT,
    path: route,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, body);
}

function findProjectRoot() {
  let dir = path.dirname(new URL(import.meta.url).pathname);
  // On Windows, import.meta.url starts with file:///C:/... so pathname starts with /C:/...
  // Remove leading slash on Windows
  if (process.platform === 'win32' && dir.startsWith('/')) {
    dir = dir.slice(1);
  }
  while (dir && dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'opencode.json')) || fs.existsSync(path.join(dir, 'scripts'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  // Fallback: assume we're in glitch-ai/.opencode/plugins/
  return path.resolve(dir, '..', '..');
}

function getTimestampString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}_${h}${min}${s}`;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ─── Workflow manipulation ─────────────────────────────────────────────────────

function loadWorkflow(projectRoot) {
  const workflowPath = path.join(projectRoot, 'data', 'comfyui', 'workflows', 'sdxl-default.json');
  if (fs.existsSync(workflowPath)) {
    try {
      const raw = fs.readFileSync(workflowPath, 'utf-8');
      console.error('[glitch-image-gen] Loaded workflow from', workflowPath);
      return JSON.parse(raw);
    } catch (e) {
      console.error('[glitch-image-gen] Failed to load workflow file, using default:', e.message);
    }
  }
  console.error('[glitch-image-gen] Workflow file not found, using built-in default');
  return JSON.parse(JSON.stringify(DEFAULT_WORKFLOW));
}

function modifyWorkflow(workflow, args) {
  const w = JSON.parse(JSON.stringify(workflow));

  // Find CLIPTextEncode nodes — first one is positive, second is negative
  const clipNodes = Object.entries(w)
    .filter(([, node]) => node.class_type === 'CLIPTextEncode')
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

  if (clipNodes.length >= 1) {
    clipNodes[0][1].inputs.text = args.prompt || '';
  }
  if (clipNodes.length >= 2) {
    clipNodes[1][1].inputs.text = args.negative_prompt || 'blurry, low quality, distorted';
  }

  // Find EmptyLatentImage
  for (const [, node] of Object.entries(w)) {
    if (node.class_type === 'EmptyLatentImage') {
      node.inputs.width = args.width ?? 1024;
      node.inputs.height = args.height ?? 1024;
    }
  }

  // Find KSampler
  for (const [, node] of Object.entries(w)) {
    if (node.class_type === 'KSampler') {
      node.inputs.steps = args.steps ?? 20;
      node.inputs.cfg = args.cfg ?? 7.0;
      if (args.seed !== undefined && args.seed !== null) {
        node.inputs.seed = args.seed;
      } else {
        node.inputs.seed = Math.floor(Math.random() * 9999999999);
      }
    }
  }

  return w;
}

// ─── Tool implementations ──────────────────────────────────────────────────────

async function handleGenerateImage(args) {
  // 1. Probe ComfyUI
  try {
    const probe = await comfyuiGet('/');
    if (probe.statusCode !== 200) {
      return {
        content: [{ type: 'text', text: 'ComfyUI is not responding at http://127.0.0.1:8188/. Please start ComfyUI first.' }]
      };
    }
  } catch (err) {
    console.error('[glitch-image-gen] ComfyUI probe failed:', err.message);
    return {
      content: [{ type: 'text', text: 'ComfyUI is not running at http://127.0.0.1:8188/. Please start it and try again.' }]
    };
  }

  const projectRoot = findProjectRoot();
  console.error('[glitch-image-gen] Project root:', projectRoot);

  // 2. Load workflow
  const workflow = loadWorkflow(projectRoot);

  // 3. Modify workflow
  const modified = modifyWorkflow(workflow, args);
  console.error('[glitch-image-gen] Modified workflow with prompt:', args.prompt);

  // 4. Queue prompt
  let promptId;
  try {
    const queueRes = await comfyuiPost('/prompt', { prompt: modified });
    if (!queueRes.body || !queueRes.body.prompt_id) {
      return {
        content: [{ type: 'text', text: `Failed to queue prompt. Response: ${JSON.stringify(queueRes.body)}` }]
      };
    }
    promptId = queueRes.body.prompt_id;
    console.error('[glitch-image-gen] Queued prompt_id:', promptId);
  } catch (err) {
    console.error('[glitch-image-gen] Failed to queue prompt:', err.message);
    return {
      content: [{ type: 'text', text: `Failed to queue prompt: ${err.message}` }]
    };
  }

  // 5. Poll history
  let historyData = null;
  const maxAttempts = 150; // 5 minutes max
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const histRes = await comfyuiGet(`/history/${promptId}`);
      if (histRes.body && Object.keys(histRes.body).length > 0) {
        historyData = histRes.body;
        console.error('[glitch-image-gen] History received for prompt_id:', promptId);
        break;
      }
    } catch (err) {
      console.error('[glitch-image-gen] Poll error:', err.message);
    }
  }

  if (!historyData) {
    return {
      content: [{ type: 'text', text: `Timed out waiting for ComfyUI to process prompt ${promptId}.` }]
    };
  }

  const entry = historyData[promptId];
  if (!entry) {
    return {
      content: [{ type: 'text', text: `No history entry found for prompt ${promptId}.` }]
    };
  }

  // Check for execution errors
  if (entry.status && entry.status.status_str === 'error') {
    const errorMsg = entry.status.messages?.find(m => m[0] === 'execution_error')?.[1]?.exception_message || 'Unknown execution error';
    return {
      content: [{ type: 'text', text: `ComfyUI execution error: ${errorMsg}` }]
    };
  }

  // 6. Collect output images
  const outputs = entry.outputs || {};
  const savedPaths = [];

  for (const [nodeId, nodeOutput] of Object.entries(outputs)) {
    const images = nodeOutput.images || [];
    for (const img of images) {
      const comfyOutputDir = img.subfolder
        ? path.join(projectRoot, 'output', img.subfolder)
        : path.join(projectRoot, 'output');
      const srcPath = path.join(comfyOutputDir, img.filename);

      if (!fs.existsSync(srcPath)) {
        // Try ComfyUI's default output location if project root doesn't have it
        const fallbackPath = path.join(process.env.USERPROFILE || process.env.HOME || '', 'ComfyUI', 'output', img.subfolder || '', img.filename);
        if (fs.existsSync(fallbackPath)) {
          console.error('[glitch-image-gen] Found image at fallback path:', fallbackPath);
        } else {
          console.error('[glitch-image-gen] Image not found:', srcPath);
          continue;
        }
      }

      const screenshotsDir = path.join(projectRoot, 'data', 'screenshots');
      ensureDir(screenshotsDir);

      const ext = path.extname(img.filename) || '.png';
      const destName = `gen_${getTimestampString()}${ext}`;
      const destPath = path.join(screenshotsDir, destName);

      try {
        fs.copyFileSync(srcPath, destPath);
        savedPaths.push(destPath);
        console.error('[glitch-image-gen] Saved image to:', destPath);
      } catch (err) {
        console.error('[glitch-image-gen] Failed to copy image:', err.message);
      }
    }
  }

  if (savedPaths.length === 0) {
    return {
      content: [{ type: 'text', text: 'Image generation completed but no output images were found. Check ComfyUI output directory.' }]
    };
  }

  return {
    content: savedPaths.map(p => ({ type: 'text', text: `Image saved to ${p}` }))
  };
}

async function handleComfyuiStatus() {
  let running = false;
  let queueLength = 0;
  let installStatus = 'unknown';

  try {
    const probe = await comfyuiGet('/');
    running = probe.statusCode === 200;
  } catch (err) {
    running = false;
  }

  if (running) {
    try {
      const queueRes = await comfyuiGet('/queue');
      if (queueRes.body) {
        queueLength = (queueRes.body.queue_running?.length || 0) + (queueRes.body.queue_pending?.length || 0);
      }
    } catch (err) {
      console.error('[glitch-image-gen] Failed to fetch queue:', err.message);
    }
    installStatus = 'installed_and_running';
  } else {
    // Check if ComfyUI directory exists as a heuristic for installation
    const comfyPaths = [
      path.join(process.env.USERPROFILE || process.env.HOME || '', 'ComfyUI'),
      path.join(findProjectRoot(), 'ComfyUI'),
    ];
    for (const p of comfyPaths) {
      if (fs.existsSync(p)) {
        installStatus = 'installed_but_not_running';
        break;
      }
    }
    if (installStatus === 'unknown') {
      installStatus = 'not_detected';
    }
  }

  return {
    content: [{
      type: 'text',
      text: `ComfyUI status: ${running ? 'running' : 'not_running'}\nQueue length: ${queueLength}\nInstall status: ${installStatus}`
    }]
  };
}

// ─── Request router ────────────────────────────────────────────────────────────

async function handleRequest(req) {
  const { id, method, params } = req;

  if (method === 'initialize') {
    respond(id, {
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'glitch-image-gen', version: '1.0.0' }
    });
    return;
  }

  if (method === 'tools/list') {
    respond(id, {
      tools: [
        {
          name: 'generate_image',
          description: 'Generate an image using a local ComfyUI instance with SDXL. Requires ComfyUI to be running at http://127.0.0.1:8188/.',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'Main positive prompt describing the desired image'
              },
              negative_prompt: {
                type: 'string',
                description: 'Negative prompt for things to avoid',
                default: 'blurry, low quality, distorted'
              },
              width: {
                type: 'integer',
                description: 'Image width in pixels',
                default: 1024
              },
              height: {
                type: 'integer',
                description: 'Image height in pixels',
                default: 1024
              },
              steps: {
                type: 'integer',
                description: 'Number of sampling steps',
                default: 20
              },
              cfg: {
                type: 'number',
                description: 'CFG scale (classifier-free guidance)',
                default: 7.0
              },
              seed: {
                type: 'integer',
                description: 'Random seed (omit for random)'
              }
            },
            required: ['prompt']
          }
        },
        {
          name: 'comfyui_status',
          description: 'Check whether ComfyUI is running and get queue information.',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ]
    });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    try {
      if (name === 'generate_image') {
        const result = await handleGenerateImage(args || {});
        respond(id, result);
      } else if (name === 'comfyui_status') {
        const result = await handleComfyuiStatus();
        respond(id, result);
      } else {
        respondError(id, -32601, `Unknown tool: ${name}`);
      }
    } catch (err) {
      console.error('[glitch-image-gen] Tool error:', err);
      respondError(id, -32603, `Internal error: ${err.message}`);
    }
    return;
  }

  // Unhandled method
  respondError(id, -32601, `Method not found: ${method}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const req = JSON.parse(line);
    handleRequest(req);
  } catch (e) {
    console.error('[glitch-image-gen] Parse error:', e.message);
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed.id !== 'undefined') {
        respondError(parsed.id, -32700, `Parse error: ${e.message}`);
      }
    } catch {
      // Not valid JSON at all — can't respond with an id
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } }) + '\n');
    }
  }
});

console.error('[glitch-image-gen] MCP server started. Waiting for JSON-RPC messages on stdin...');
