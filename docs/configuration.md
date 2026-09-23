# Glitch Omni Configuration Documentation: Context Detection

## `providers.json` New Fields

### `auto_detect` (Provider-Level)

**Location**: Top-level provider object in `providers.json`

**Example** (lmstudio provider):
```json
"lmstudio": {
  "auto_detect": true,
  "models": { ... }
}
```

**Behavior**:
- When `true`, context detection runs during provider injection
- Currently auto-enabled for `lmstudio` and `freetoken-wsl` providers
- Can be explicitly set on individual providers to opt-in
- When `false`, detection is skipped for that provider

### `last_detected` (Model-Level)

**Location**: Each model entry within a provider's `models` object

**Example** (qwen model in lmstudio):
```json
"qwen/qwen3.8-27b": {
  "limit": {
    "context": 32768,
    "output": 8192
  },
  "auto_detect": true,
  "last_detected": "2026-09-16T10:30:00.000Z",
  "backend": "lmstudio"
}
```

**Fields**:
- `last_detected`: ISO 8601 timestamp of when context detection last ran successfully
- Set automatically by `inject-providers.mjs` line 152 after successful detection
- Helps track when detection was last performed for re-detection decisions

### `limit` (Model-Level) — Updated by Detection

**Added/Updated fields** during context detection:
- `limit.context`: Detected context window size (number)
- `limit.output`: Calculated output limit (`Math.min(Math.floor(context / 4), 8192)`)

**Example**:
```json
"limit": {
  "context": 32768,
  "output": 8192
}
```

## Fallback Behavior When Detection Fails

If all three detection tiers fail, the following defaults apply:

| Scenario | Default Context | Source |
|---|---|---|
| No models found at API | `32768` (DEFAULT_CONTEXT) | `default_fallback` |
| Config file not found | `32768` (DEFAULT_CONTEXT) | `default_fallback` |
| Binary search inconclusive | `32768` (DEFAULT_CONTEXT) | `default_fallback` |
| Model already has `limit.context` set | Preserved (not overwritten) | N/A |

### When Detection Skips a Model

A model's context limit will **not** be updated if:
1. The model already has `limit.context > 0` (existing limit found)
2. The detection source is `default_fallback` (unreliable)
3. The `auto_detect` flag is `false` for the provider

### Manual Configuration Override

To override auto-detected values:

1. Edit `config/providers.json` directly
2. Set `limit.context` to your desired value
3. Set `auto_detect: false` on the provider or model to prevent re-detection
4. Set `last_detected` to any date or remove it (will be refreshed on next detection run)

### Example: Full lmstudio Provider Section After Detection

```json
"lmstudio": {
  "npm": "@ai-sdk/openai-compatible",
  "name": "LM Studio (local)",
  "auto_detect": true,
  "options": {
    "baseURL": "http://192.168.68.64:1234/v1"
  },
  "models": {
    "qwen/qwen3.8-27b": {
      "name": "Qwen/Qwen3.8 27b",
      "limit": {
        "context": 32768,
        "output": 8192
      },
      "auto_detect": true,
      "last_detected": "2026-09-16T10:30:00.000Z",
      "backend": "lmstudio",
      "last_seen": "2026-09-15T22:04:18.414Z"
    }
  }
}
```