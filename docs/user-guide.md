# Glitch Omni User Guide: Auto Model Context Detection

## How Auto-Detection Works

Glitch Omni can automatically detect the context window size of local models running through LM Studio or compatible local servers. This happens silently in the background when you start Glitch.

### What Happens Automatically

1. **On startup**, Glitch probes your local LM Studio server (if running) to discover available models
2. **For each local model**, it attempts to determine the maximum context window size using three methods:
   - First, it checks the model metadata from the server's API
   - Then, it reads the LM Studio configuration file from disk
   - Finally, if needed, it performs a binary search via chat completion requests
3. **The detected context size** is stored in your configuration so Glitch knows how much context each model can handle
4. **Output limits** are automatically calculated (`context / 4`, capped at 8192)

### What You'll See

- **No configuration needed** — just have LM Studio running with models loaded
- **Model limits are updated** the first time Glitch detects your local models
- **A timestamp** (`last_detected`) is recorded showing when detection last ran
- **Detection source** is logged (metadata, config file, binary search, or fallback)

### Troubleshooting

#### Detection Failed (using default 32768 context)

If auto-detection can't determine your model's context window, Glitch falls back to **32768 tokens** (a common default for many local models). This means:

- Your model may have a larger or smaller actual context window
- Output limits will be based on 32768 / 4 = 8192 tokens
- Check the logs for `[DETECT]` messages indicating which strategy was used

#### Detection Didn't Run

- Ensure LM Studio is running and accessible at your configured base URL
- Check that your model is loaded in LM Studio (not just downloaded)
- Verify network connectivity if LM Studio is on a different machine
- Look for `[DETECT]` log messages — if absent, detection was skipped (e.g., no `auto_detect` flag)

#### Manually Overriding Detected Context

If you need to set a different context limit:

1. Edit `config/providers.json` directly
2. Find your model under the `lmstudio` provider
3. Modify or remove the `limit.context` value
4. Set `auto_detect: false` to prevent overwriting on next startup

#### Changing the LM Studio Connection

If your LM Studio server moves to a different IP/port:

1. Update the `baseURL` in `config/providers.json` under the `lmstudio` provider
2. Re-run Glitch to re-detect models at the new endpoint
3. Or manually run: `node scripts/lib/discover-local-models.mjs --persist`