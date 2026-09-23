# Glitch Omni Developer Documentation: Context Detection

## New Module: `scripts/lib/lmstudio-context-detector.mjs`

### Purpose

Reusable module for detecting context window sizes of models served by LM Studio and compatible OpenAI-compatible local servers.

### Public API

| Function | Description |
|---|---|
| `detectContextSizes(baseUrl)` | Detects context sizes for all models at the given endpoint. Uses 3-tier strategy: API metadata → config file → binary search. Falls back to `DEFAULT_CONTEXT` (32768). |
| `probeContextSize(baseUrl, modelName, tokenCount)` | Probes if a server accepts a chat completion of approximately `tokenCount` tokens. Returns `boolean`. |
| `readConfigFile()` | Reads LM Studio config file from disk. Returns `{ config, path }` or `null`. |
| `extractContextFromModelMeta(model)` | Extracts context size from `/v1/models` metadata. Returns `number | null`. |
| `getModelsFromApi(baseUrl)` | Fetches model list from `/v1/models` endpoint. |

### 3-Tier Detection Strategy (Internal)

1. **Tier 1 - API Metadata**: Fetch `/v1/models`, extract `context_length` or `n_ctx` from each model object
2. **Tier 2 - Config File**: Read `%LOCALAPPDATA%\LM Studio\config.json` (Windows) and extract `n_ctx`
3. **Tier 3 - Binary Search**: Probe `/v1/chat/completions` with progressively larger prompts until server rejects

### Extending or Modifying Detection Logic

#### Adding a New Detection Tier

1. Export a new function following the existing pattern
2. Add it to the orchestrator `detectContextSizes()` function after the existing tiers
3. Ensure proper fallback behavior if the new tier returns no results

#### Modifying Binary Search Bounds

Edit the `KNOWN_CONTEXT_SIZES` array in `lmstudio-context-detector.mjs`:
- Contains: `[512, 1024, 2048, 4096, 8192, 16384, 24576, 32768, 49152, 65536, 98304, 131072, 262144, 524288, 1048576]`
- Add sizes outside this range if your models commonly have larger/smaller contexts
- The binary search will automatically use the new bounds

#### Changing Default Fallback

Modify `DEFAULT_CONTEXT` constant (line 33):
- Currently `32768`
- Used when all three tiers fail

#### Adding New Context Field Names

Update `extractContextFromModelMeta()` candidates array (lines 88-95):
- Currently checks: `context_length`, `n_ctx`, `context_length_max`, `max_context_length`, `max_tokens`, `ctx_length`
- Add any additional field names your server uses

#### Config File Structure Variations

Update `extractNctxFromConfig()` if your LM Studio version uses different JSON structure:
- Checks: `config.n_ctx`, `config.server.n_ctx`, `config.settings.n_ctx`
- Checks `config.loadedModels[].n_ctx` and `config.model.n_ctx`
- Add new paths as needed

### Test Coverage

The detector has implicit test coverage through `inject-providers.mjs` integration. To run manual verification:

1. Start LM Studio with a model loaded
2. Run: `node scripts/lib/inject-providers.mjs path/to/template.json`
3. Verify `providers.json` gets `auto_detect: true` and `last_detected` timestamps
4. Check that `limit.context` values are updated for detected models

#### Manual Test Steps

1. Start LM Studio, load a model
2. Note the model's actual context window (from LM Studio UI or model card)
3. Run detection and compare detected vs. actual values
4. Test all three tiers by:
   - Disabling API metadata (simulate server unreachable)
   - Disabling config file (move/rename config temporarily)
   - Testing binary search with known model limits

### Adding New Providers

To add context detection for a new local backend:

1. Add the provider to `config/providers.json` with:
   - `auto_detect: true` (or leave default behavior)
   - `options.baseURL` pointing to the backend
   - `models` entry for each model to detect
2. The `shouldDetect` logic in `inject-providers.mjs` line 123-127` checks:
   - `providerCfg.auto_detect === true`
   - Or `providerKey === 'lmstudio'`
   - Or `providerKey === 'freetoken-wsl'`
3. Add new backend keys to this condition as needed

### Best Practices

- **Never block provider injection** — context detection is best-effort (see `inject-providers.mjs` line 160-163)
- **Preserve existing limits** — only update `limit.context` if a reliable source is found OR if the model has no existing limit
- **Log detection source** — `sizeInfo.source` tells you which tier succeeded (helps debugging)
- **Cache results** — `last_detected` timestamp helps determine when to re-run detection