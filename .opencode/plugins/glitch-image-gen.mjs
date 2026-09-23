import fs from 'fs';
import path from 'path';
import http from 'http';
import readline from 'readline';
import { fileURLToPath } from 'url';

const COMFYUI_HOST = '127.0.0.1';
const COMFYUI_PORT = 8188;

// ─── Timeout configuration ──────────────────────────────────────────────────────
// FLUX.2-klein-4B on 8GB VRAM: model load + warmup + generation = 30-60s (distilled, 4 steps).
// Default 180s (3 min) accommodates first-generation cold start.
// Override via env: IMAGE_GEN_TIMEOUT_MS=300000 (5 min) for very slow GPUs.
const IMAGE_GEN_TIMEOUT_MS = parseInt(process.env.IMAGE_GEN_TIMEOUT_MS, 10) || 180_000;
const POLL_INTERVAL_MS = 2000;
const HTTP_REQUEST_TIMEOUT_MS = 30_000;

// ─── Default FLUX.2-klein-4B txt2img workflow (ComfyUI API format) ─────────────
// Distilled model: 4 steps, guidance_scale=1.0, BasicGuider (no CFG), no negative prompt.

const DEFAULT_WORKFLOW = {
  "1": {
    "inputs": {
      "unet_name": "flux-2-klein-4b-nvfp4.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader",
    "_meta": { "title": "Load Diffusion Model" }
  },
  "2": {
    "inputs": {
      "clip_name": "qwen_3_4b.safetensors",
      "type": "flux2",
      "device": "default"
    },
    "class_type": "CLIPLoader",
    "_meta": { "title": "Load CLIP" }
  },
  "3": {
    "inputs": {
      "vae_name": "flux2-vae.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": { "title": "Load VAE" }
  },
  "4": {
    "inputs": {
      "text": "",
      "clip": ["2", 0]
    },
    "class_type": "CLIPTextEncode",
    "_meta": { "title": "CLIP Text Encode (Prompt)" }
  },
  "5": {
    "inputs": {
      "conditioning": ["4", 0],
      "guidance": 1.0
    },
    "class_type": "FluxGuidance",
    "_meta": { "title": "Flux Guidance" }
  },
  "6": {
    "inputs": {
      "model": ["1", 0],
      "conditioning": ["5", 0]
    },
    "class_type": "BasicGuider",
    "_meta": { "title": "Basic Guider" }
  },
  "7": {
    "inputs": {
      "sampler_name": "euler"
    },
    "class_type": "KSamplerSelect",
    "_meta": { "title": "Sampler Select" }
  },
  "8": {
    "inputs": {
      "steps": 4,
      "width": 1024,
      "height": 1024
    },
    "class_type": "Flux2Scheduler",
    "_meta": { "title": "Flux2 Scheduler" }
  },
  "9": {
    "inputs": {
      "noise_seed": 0
    },
    "class_type": "RandomNoise",
    "_meta": { "title": "Random Noise" }
  },
  "10": {
    "inputs": {
      "width": 1024,
      "height": 1024,
      "batch_size": 1
    },
    "class_type": "EmptyFlux2LatentImage",
    "_meta": { "title": "Empty Flux2 Latent Image" }
  },
  "11": {
    "inputs": {
      "noise": ["9", 0],
      "guider": ["6", 0],
      "sampler": ["7", 0],
      "sigmas": ["8", 0],
      "latent_image": ["10", 0]
    },
    "class_type": "SamplerCustomAdvanced",
    "_meta": { "title": "SamplerCustomAdvanced" }
  },
  "12": {
    "inputs": {
      "samples": ["11", 0],
      "vae": ["3", 0]
    },
    "class_type": "VAEDecode",
    "_meta": { "title": "VAE Decode" }
  },
  "13": {
    "inputs": {
      "filename_prefix": "ComfyUI",
      "images": ["12", 0]
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
    const req = http.request({ ...options, timeout: HTTP_REQUEST_TIMEOUT_MS }, (res) => {
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
    req.on('timeout', () => {
      req.destroy(new Error(`HTTP request to ${options.hostname}:${options.port}${options.path} timed out after ${HTTP_REQUEST_TIMEOUT_MS}ms`));
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
  let dir = path.dirname(fileURLToPath(import.meta.url));
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
  const workflowPath = path.join(projectRoot, 'data', 'comfyui', 'workflows', 'flux2-klein-4b.json');
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

  // FLUX.2 distilled: only one CLIPTextEncode node (no negative prompt).
  const clipNodes = Object.entries(w)
    .filter(([, node]) => node.class_type === 'CLIPTextEncode')
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

  if (clipNodes.length >= 1) {
    clipNodes[0][1].inputs.text = args.prompt || '';
  }

  // EmptyFlux2LatentImage — set dimensions.
  for (const [, node] of Object.entries(w)) {
    if (node.class_type === 'EmptyFlux2LatentImage') {
      node.inputs.width = args.width ?? 1024;
      node.inputs.height = args.height ?? 1024;
    }
  }

  // Flux2Scheduler — set step count.
  for (const [, node] of Object.entries(w)) {
    if (node.class_type === 'Flux2Scheduler') {
      node.inputs.steps = args.steps ?? 4;
    }
  }

  // RandomNoise — set seed.
  for (const [, node] of Object.entries(w)) {
    if (node.class_type === 'RandomNoise') {
      if (args.seed !== undefined && args.seed !== null) {
        node.inputs.noise_seed = args.seed;
      } else {
        node.inputs.noise_seed = Math.floor(Math.random() * 9999999999);
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
  const maxAttempts = Math.ceil(IMAGE_GEN_TIMEOUT_MS / POLL_INTERVAL_MS);
  console.error(`[glitch-image-gen] Polling for up to ${IMAGE_GEN_TIMEOUT_MS / 1000}s (max ${maxAttempts} attempts)`);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
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
      content: [{ type: 'text', text: `Timed out waiting for ComfyUI to process prompt ${promptId} after ${IMAGE_GEN_TIMEOUT_MS / 1000}s. Increase IMAGE_GEN_TIMEOUT_MS env var if your GPU is slow.` }]
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
        ? path.join(projectRoot, 'data', 'comfyui', 'ComfyUI', 'output', img.subfolder)
        : path.join(projectRoot, 'data', 'comfyui', 'ComfyUI', 'output');
      let srcPath = path.join(comfyOutputDir, img.filename);

      if (!fs.existsSync(srcPath)) {
        // Try ComfyUI's default output location if project root doesn't have it
        const fallbackPath = path.join(process.env.USERPROFILE || process.env.HOME || '', 'ComfyUI', 'output', img.subfolder || '', img.filename);
        if (fs.existsSync(fallbackPath)) {
          console.error('[glitch-image-gen] Found image at fallback path:', fallbackPath);
          srcPath = fallbackPath;
        } else {
          console.error('[glitch-image-gen] Image not found:', srcPath);
          continue;
        }
      }

      const screenshotsDir = args.output_dir || process.env.IMAGE_OUTPUT_DIR || path.join(projectRoot, 'data', 'screenshots');
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
      path.join(findProjectRoot(), 'data', 'comfyui', 'ComfyUI'),
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
          description: 'Generate an image using a local ComfyUI instance with FLUX.2-klein-4B (distilled, NVFP4). Requires ComfyUI to be running at http://127.0.0.1:8188/. Uses natural language prompts (not Danbooru tags). Distilled model: 4 steps, guidance=1.0, no negative prompt.',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'Natural language prompt describing the desired image. 75-150 tokens recommended for best results. No negative prompt needed for this distilled model.'
              },
              negative_prompt: {
                type: 'string',
                description: 'DEPRECATED: FLUX.2-klein-4B is a guidance-distilled model and does not use a negative prompt. This parameter is ignored.',
                default: ''
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
                description: 'Number of sampling steps (distilled model uses 4; higher values do not improve quality)',
                default: 4
              },
              cfg: {
                type: 'number',
                description: 'DEPRECATED: FLUX.2-klein-4B uses guidance-distilled sampling via FluxGuidance (guidance=1.0). This parameter is ignored by the BasicGuider pipeline.',
                default: 1.0
              },
              seed: {
                type: 'integer',
                description: 'Random seed (omit for random)'
              },
              output_dir: {
                type: 'string',
                description: 'Absolute path to the directory where the generated image should be saved. If omitted, falls back to IMAGE_OUTPUT_DIR env var, then the default data/screenshots.'
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

console.error('[glitch-image-gen] MCP server started (FLUX.2-klein-4B). Waiting for JSON-RPC messages on stdin...');
console.error(`[glitch-image-gen] Timeouts: generation=${IMAGE_GEN_TIMEOUT_MS}ms, http=${HTTP_REQUEST_TIMEOUT_MS}ms, poll=${POLL_INTERVAL_MS}ms`);
