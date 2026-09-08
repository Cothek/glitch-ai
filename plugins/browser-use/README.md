# Browser Use Plugin for Glitch

AI browser automation — navigate, click, type, extract data, and monitor websites like a human.

## What It Does

Browser Use gives Glitch the ability to control a real web browser. It can:

- Navigate to any URL and follow links
- Click buttons, fill forms, type text, select dropdowns
- Extract text, tables, links, and structured data from pages
- Use search engines and e-commerce sites
- Take screenshots for visual verification
- Handle multi-step workflows across pages
- **Manage multiple tabs** — open, switch, and compare across sites
- **Run scheduled monitoring** — cron-like recurring browser tasks
- **Execute custom actions** — register reusable JavaScript handlers
- **Multi-session isolation** — run up to 3 concurrent browser sessions
- **Export results** — CSV, JSON, or Markdown history dumps

## Installation

```powershell
.\scripts\install-browser-use.ps1
```

This will:
1. Install the `browser-use` npm package
2. Download Chromium via Playwright
3. Create the config file at `data/browser-use/config.json`
4. Register the plugin (disabled by default)

## Setup

1. **Add an LLM provider** via API or by editing `data/browser-use/config.json`:
   ```bash
   curl -X POST http://localhost:4105/api/providers \
     -H 'Content-Type: application/json' \
     -d '{
       "id": "openrouter",
       "type": "openrouter",
       "name": "OpenRouter",
       "apiKey": "sk-or-...",
       "baseUrl": "https://openrouter.ai/api/v1",
       "models": ["google/gemini-2.0-flash-001"],
       "vision": true
     }'
   ```
   Or set the API key as an environment variable (e.g. `OPENROUTER_API_KEY`).

2. **Select the active provider**:
   ```bash
   curl -X POST http://localhost:4105/api/llm/select \
     -H 'Content-Type: application/json' \
     -d '{"providerId": "openrouter", "model": "google/gemini-2.0-flash-001"}'
   ```

3. **Enable the plugin**:
   ```
   Enable browser-use plugin
   ```

4. **Restart Glitch** to load the plugin

## Configuration

Edit `data/browser-use/config.json`:

```json
{
  "headless": true,
  "llm": {
    "active_provider": "openrouter",
    "active_model": "google/gemini-2.0-flash-001",
    "providers": [
      {
        "id": "openrouter",
        "type": "openrouter",
        "name": "OpenRouter",
        "apiKey": "sk-or-...",
        "baseUrl": "https://openrouter.ai/api/v1",
        "models": ["google/gemini-2.0-flash-001"],
        "vision": true
      }
    ]
  },
  "browser": {
    "viewport": { "width": 1920, "height": 1080 },
    "allowed_domains": []
  },
  "scheduler": {
    "enabled": true,
    "max_tasks": 10,
    "check_interval_seconds": 60
  },
  "sessions": {
    "max_concurrent": 3
  },
  "custom_actions": {
    "enabled": true,
    "max_actions": 20
  }
}
```

### Multi-Provider LLM

Add any AI provider by configuring a provider entry. Supported types:

| Type | Description | API Key Env Var |
|------|-------------|-----------------|
| `openai` | OpenAI API | `OPENAI_API_KEY` |
| `openai-compatible` | Any OpenAI-compatible endpoint (OpenCode Go, NVIDIA, LM Studio, vLLM) | `OPENAI_API_KEY` |
| `openrouter` | OpenRouter multi-model gateway | `OPENROUTER_API_KEY` |
| `anthropic` | Anthropic Claude | `ANTHROPIC_API_KEY` |
| `google` | Google Gemini | `GOOGLE_API_KEY` |
| `deepseek` | DeepSeek | `DEEPSEEK_API_KEY` |
| `groq` | Groq fast inference | `GROQ_API_KEY` |
| `ollama` | Local Ollama | (none) |
| `mistral` | Mistral AI | `MISTRAL_API_KEY` |
| `cerebras` | Cerebras | `CEREBRAS_API_KEY` |
| `litellm` | LiteLLM proxy | `LITELLM_API_KEY` |
| `vercel` | Vercel AI SDK | `VERCEL_API_KEY` |
| `azure` | Azure OpenAI | `AZURE_OPENAI_API_KEY` |
| `aws` | AWS Bedrock | AWS env vars |
| `browser-use` | Browser Use Cloud | `BROWSER_USE_API_KEY` |

**Add a provider via API:**
```bash
curl -X POST http://localhost:4105/api/providers \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "anthropic",
    "type": "anthropic",
    "name": "Anthropic Claude",
    "apiKey": "sk-ant-...",
    "models": ["claude-sonnet-4-6"],
    "vision": true
  }'
```

**Add a provider by editing config.json directly:**
```json
{
  "id": "nvidia",
  "type": "openai-compatible",
  "name": "NVIDIA",
  "apiKey": "nvapi-...",
  "baseUrl": "https://integrate.api.nvidia.com/v1",
  "models": ["nvidia/llama-3.1-nemotron-70b-instruct"],
  "vision": false
}
```

**API key resolution priority:**
1. `provider.apiKey` in config (if set)
2. Environment variable (e.g. `OPENROUTER_API_KEY`)
3. Error if neither available

### Options

| Field | Default | Description |
|-------|---------|-------------|
| `headless` | `true` | Run browser without visible window |
| `llm.active_provider` | — | ID of the active provider |
| `llm.active_model` | — | Model to use for browser agent |
| `llm.providers[]` | — | Array of provider configurations |
| `browser.viewport` | `1920x1080` | Browser window size |
| `browser.allowed_domains` | `[]` | Restrict to specific domains (empty = all) |
| `session.max_steps` | `50` | Max agent steps per task |
| `session.timeout_seconds` | `300` | Task timeout in seconds |
| `scheduler.enabled` | `true` | Enable/disable scheduled tasks |
| `scheduler.max_tasks` | `10` | Max concurrent scheduled tasks |
| `sessions.max_concurrent` | `3` | Max parallel browser sessions |
| `custom_actions.enabled` | `true` | Enable/disable custom action registration |
| `custom_actions.max_actions` | `20` | Max registered custom actions |

## Usage

Once enabled, Glitch can use browser automation:

- "Find the cheapest RTX 3070 on eBay"
- "Fill out this form with my info"
- "Research topic X and compile sources"
- "Compare prices across Amazon, eBay, and Walmart"
- "Check my email and summarize unread messages"
- "Monitor this product page and alert me when price drops"
- "Open three tabs and compare these laptops side by side"

## API Reference

The plugin exposes an HTTP API on port 4105.

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Check if browser is running |
| `/api/run` | POST | Run a browser task |
| `/api/navigate` | POST | Navigate to a URL |
| `/api/screenshot` | POST | Take a screenshot |
| `/api/screenshot/analyze` | POST | Screenshot + @vision analysis |
| `/api/stop` | POST | Stop browser session |

### Tab Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tabs` | GET | List all open tabs |
| `/api/tabs/switch` | POST | Switch to a tab (by index or URL) |
| `/api/tabs/open` | POST | Open a new tab |
| `/api/tabs/close` | POST | Close a tab |

**Example: Multi-tab price comparison**
```bash
# Open two tabs
curl -X POST http://localhost:4105/api/tabs/open \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://amazon.com/dp/B0FOUND"}'

curl -X POST http://localhost:4105/api/tabs/open \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://ebay.com/itm/123456"}'

# List tabs
curl http://localhost:4105/api/tabs

# Switch between tabs
curl -X POST http://localhost:4105/api/tabs/switch \
  -H 'Content-Type: application/json' \
  -d '{"index": 0}'
```

### Custom Actions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/actions` | GET | List registered actions |
| `/api/actions/register` | POST | Register a custom action |
| `/api/actions/run` | POST | Execute a custom action |

**Example: Register a price extraction action**
```bash
curl -X POST http://localhost:4105/api/actions/register \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "extract_prices",
    "description": "Extract all visible prices from the page",
    "parameters": { "type": "object", "properties": {} },
    "handler": "return { prices: [\"$19.99\", \"$24.99\"] };"
  }'

# Run it
curl -X POST http://localhost:4105/api/actions/run \
  -H 'Content-Type: application/json' \
  -d '{"name": "extract_prices", "params": {}}'
```

> **Security Note**: Custom action handlers execute arbitrary JavaScript via `new Function()`. Only register actions you trust.

### Scheduled Tasks

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/schedule` | GET | List scheduled tasks |
| `/api/schedule` | POST | Create a scheduled task |
| `/api/schedule/:id` | PUT | Update a scheduled task |
| `/api/schedule/:id` | DELETE | Delete a scheduled task |
| `/api/schedule/:id/run` | POST | Manually trigger a task |

**Example: Monitor a product price**
```bash
# Create hourly price check
curl -X POST http://localhost:4105/api/schedule \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "price-monitor",
    "task": "Check the price of RTX 5090 on Amazon and report if below $2000",
    "interval_minutes": 60,
    "enabled": true
  }'

# Check scheduled tasks
curl http://localhost:4105/api/schedule

# Manually trigger
curl -X POST http://localhost:4105/api/schedule/sched-123456/run
```

### Export

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/export` | POST | Export task history |

**Example: Export as CSV**
```bash
curl -X POST http://localhost:4105/api/export \
  -H 'Content-Type: application/json' \
  -d '{"format": "csv"}' \
  --output history.csv
```

Formats: `csv`, `json`, `markdown`

### Multi-Session

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions` | GET | List all active sessions |
| `/api/session/create` | POST | Create a new browser session |
| `/api/session/:id/run` | POST | Run task on a specific session |
| `/api/session/:id/status` | GET | Get session status |
| `/api/session/:id/stop` | POST | Stop a specific session |

**Example: Parallel research**
```bash
# Create two isolated sessions
SESSION1=$(curl -s -X POST http://localhost:4105/api/session/create | jq -r '.session_id')
SESSION2=$(curl -s -X POST http://localhost:4105/api/session/create | jq -r '.session_id')

# Run different tasks concurrently
curl -X POST "http://localhost:4105/api/session/$SESSION1/run" \
  -H 'Content-Type: application/json' \
  -d '{"task": "Research CPU benchmarks"}' &

curl -X POST "http://localhost:4105/api/session/$SESSION2/run" \
  -H 'Content-Type: application/json' \
  -d '{"task": "Research GPU benchmarks"}' &

# Check status
curl http://localhost:4105/api/sessions
```

### History & Profiles

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/history` | GET | Last 20 task entries |
| `/api/history/:taskId` | GET | Task detail by ID |
| `/api/history` | DELETE | Clear all history |
| `/api/profile` | POST | List browser profiles |

### Provider Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/providers` | GET | List all providers (API keys masked) |
| `/api/providers` | POST | Add a new provider |
| `/api/providers/:id` | PUT | Update a provider (partial) |
| `/api/providers/:id` | DELETE | Remove a provider |
| `/api/providers/:id/test` | POST | Test provider connection |
| `/api/llm/select` | POST | Set active provider + model |
| `/api/llm/status` | GET | Current active provider info |

**Example: Add and test a provider**
```bash
# Add Anthropic
curl -X POST http://localhost:4105/api/providers \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "anthropic",
    "type": "anthropic",
    "name": "Anthropic",
    "apiKey": "sk-ant-...",
    "models": ["claude-sonnet-4-6"],
    "vision": true
  }'

# Test it
curl -X POST http://localhost:4105/api/providers/anthropic/test

# Switch to it
curl -X POST http://localhost:4105/api/llm/select \
  -H 'Content-Type: application/json' \
  -d '{"providerId": "anthropic", "model": "claude-sonnet-4-6"}'

# Check status
curl http://localhost:4105/api/llm/status
```

### Configuration

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config/domains` | POST | Update domain restrictions at runtime |

## File Structure

```
plugins/browser-use/
├── server.mjs              # HTTP API server (Phase 3)
├── helpers.mjs             # Shared utilities (logging, config, history, scheduler)
├── manifest.json           # Glitch plugin manifest
├── package.json            # npm dependencies
└── README.md               # This file

data/browser-use/
├── config.json             # User settings
├── history.json            # Task history (auto-created)
├── actions.json            # Custom actions registry (auto-created)
├── schedule.json           # Scheduled tasks (auto-created)
├── profiles/               # Persistent browser sessions
│   └── <session_id>/       # Per-session profiles (multi-session)
└── screenshots/            # Browser screenshots
```

## Requirements

- Node.js >= 18
- Glitch AI platform
- LLM API key (OpenRouter free tier works)

## Troubleshooting

**Plugin won't start:**
- Check `data/logs/browser-use.log` for errors
- Ensure `browser-use` is installed: `cd plugins/browser-use && npm install`
- Ensure Chromium is installed: `npx playwright install chromium`

**CAPTCHA appears:**
- Browser Use cannot solve CAPTCHAs automatically
- The agent will stop and ask for help
- Consider using Browser Use Cloud for CAPTCHA solving

**Browser crashes:**
- Check available memory (browser automation is memory-intensive)
- Reduce viewport size in config
- Set `max_steps` lower for complex tasks

**Scheduled tasks not running:**
- Check `scheduler.enabled` is `true` in config
- Verify task is enabled: `GET /api/schedule`
- Check logs for task execution errors

**Max sessions reached:**
- Default limit is 3 concurrent sessions
- Stop unused sessions: `POST /api/session/:id/stop`
- Increase limit in config: `sessions.max_concurrent`
