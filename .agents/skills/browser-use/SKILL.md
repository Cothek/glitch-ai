---
name: browser-use
description: "MUST use when user says 'browse to', 'open website', 'search for', 'fill form', 'extract data from', 'check website', 'compare prices', 'research online', 'monitor website', or any task requiring real web browsing."
---

# Browser Use Skill

## Activation
When this skill activates, check if browser-use plugin is running (GET /api/status on port 4105).

## When to Use
- Web research across multiple sites
- Form filling with user data
- Price comparison across stores
- Data extraction from websites
- Site monitoring and alerts
- Multi-tab browsing workflows
- Scheduled monitoring tasks
- Any task requiring real browser interaction

## API Reference

### Core Endpoints

#### Run a Task (with automatic retry)
```
POST http://localhost:4105/api/run
{ "task": "natural language task description", "options": { "retry": true } }
```
- **retry** (boolean, default true): Retries up to `session.max_failures` times with exponential backoff
- Returns 202 with `taskId` — poll `/api/status` for completion

#### Take Screenshot
```
POST http://localhost:4105/api/screenshot
{ "saveTo": "data/browser-use/screenshots/task.png" }
```
- Saves to `data/browser-use/screenshots/` by default
- Returns `{ success, path }`

#### Screenshot + @vision Analysis
```
POST http://localhost:4105/api/screenshot/analyze
{ "saveTo": "optional-path.png" }
```
- Takes screenshot AND dispatches to @vision agent (port 4100) for analysis
- Returns `{ success, path, analysis }`

#### Navigate to URL
```
POST http://localhost:4105/api/navigate
{ "url": "https://example.com" }
```
- Respects domain restrictions from config

#### Stop Browser
```
POST http://localhost:4105/api/stop
```

#### Check Status
```
GET http://localhost:4105/api/status
```
Returns: running, session_active, sessions_count, browser_use_installed, config_valid, domain_restrictions, last_error, recent_tasks

### History Endpoints

#### Get Recent History
```
GET http://localhost:4105/api/history
```
- Returns last 20 task entries (FIFO, max 100 stored)

#### Get Task Detail
```
GET http://localhost:4105/api/history/:taskId
```

#### Clear History
```
DELETE http://localhost:4105/api/history
```

### Tab Management

All tab endpoints require an active session. Pass `session_id` in body or query params.

#### List Open Tabs
```
GET http://localhost:4105/api/tabs?session_id=default
```
- Returns list of open tabs with titles and URLs

#### Switch Tab
```
POST http://localhost:4105/api/tabs/switch
{ "session_id": "default", "index": 0 }
// or
{ "session_id": "default", "url": "https://example.com" }
```

#### Open New Tab
```
POST http://localhost:4105/api/tabs/open
{ "session_id": "default", "url": "https://example.com" }
```

#### Close Tab
```
POST http://localhost:4105/api/tabs/close
{ "session_id": "default", "index": 1 }
```

### Custom Actions

Register reusable browser actions with JavaScript handlers.

#### List Actions
```
GET http://localhost:4105/api/actions
```

#### Register Action
```
POST http://localhost:4105/api/actions/register
{
  "name": "extract_prices",
  "description": "Extract all prices from current page",
  "parameters": { "type": "object", "properties": {} },
  "handler": "return context.config;"
}
```
- **handler**: JavaScript function body (executed via `new Function()`)
- **context**: `{ log, config, history }` — server utilities available inside handler
- Max 20 actions (configurable via `custom_actions.max_actions`)

#### Run Action
```
POST http://localhost:4105/api/actions/run
{ "name": "extract_prices", "params": {} }
```

### Scheduled Tasks

Monitor websites or run recurring browser tasks.

#### List Scheduled Tasks
```
GET http://localhost:4105/api/schedule
```
- Returns tasks with `next_run` times

#### Create Scheduled Task
```
POST http://localhost:4105/api/schedule
{
  "name": "price-monitor",
  "task": "Check the price of RTX 5090 on Amazon and report if below $2000",
  "interval_minutes": 60,
  "enabled": true
}
```
- Max 10 scheduled tasks
- Each run is logged to history with `source: 'schedule'`

#### Update Scheduled Task
```
PUT http://localhost:4105/api/schedule/:id
{ "interval_minutes": 30, "enabled": false }
```

#### Delete Scheduled Task
```
DELETE http://localhost:4105/api/schedule/:id
```

#### Manually Trigger Task
```
POST http://localhost:4105/api/schedule/:id/run
```

### Export Results

Export task history in various formats.

#### Export History
```
POST http://localhost:4105/api/export
{ "format": "csv" }
// or
{ "format": "json", "taskIds": ["task-123", "task-456"] }
// or
{ "format": "markdown" }
```
- **csv**: taskId, task, success, error, timestamp, duration, screenshotPath
- **json**: full history array
- **markdown**: formatted table
- Returns file as downloadable attachment

### Multi-Session Management

Run multiple isolated browser sessions simultaneously (max 3 concurrent by default).

#### Create Session
```
POST http://localhost:4105/api/session/create
{ "config": { "headless": true } }
```
- Returns `{ session_id }` — use this ID for all session-specific calls

#### Run Task on Session
```
POST http://localhost:4105/api/session/:id/run
{ "task": "search for laptops on Amazon" }
```

#### Get Session Status
```
GET http://localhost:4105/api/session/:id/status
```

#### Stop Session
```
POST http://localhost:4105/api/session/:id/stop
```

#### List All Sessions
```
GET http://localhost:4105/api/sessions
```

### Profile Management

#### List Browser Profiles
```
POST http://localhost:4105/api/profile
```
- Lists files in the persistent profile directory

### Configuration Endpoints

#### Update Domain Restrictions
```
POST http://localhost:4105/api/config/domains
{ "domains": ["example.com", "trusted-site.org"] }
```

## Error Handling & Retry

- Tasks automatically retry on failure (configurable via `retry.enabled`, `retry.max_attempts`)
- Exponential backoff: 2s, 4s, 8s... between retries
- Each retry attempt is logged
- Failed tasks saved to history with error details

## Screenshot Workflow

1. `POST /api/screenshot` — captures and saves to disk
2. `POST /api/screenshot/analyze` — captures, saves, AND sends to @vision
3. @vision agent analyzes the screenshot (CAPTCHAs, layouts, visual elements)
4. Analysis result returned alongside screenshot path

## Multi-Tab Workflow

1. `POST /api/tabs/open` — open a new tab with a URL
2. `GET /api/tabs` — list all open tabs
3. `POST /api/tabs/switch` — switch between tabs by index or URL
4. `POST /api/tabs/close` — close tabs when done
5. Compare data across tabs (e.g., price comparison)

## Scheduling Workflow

1. `POST /api/schedule` — create a recurring monitoring task
2. Scheduler runs tasks automatically at specified intervals
3. `GET /api/schedule` — check status and next run times
4. `POST /api/schedule/:id/run` — manually trigger if needed
5. Task results logged to history with `source: 'schedule'`

## Multi-Session Workflow

1. `POST /api/session/create` — create isolated browser session
2. `POST /api/session/:id/run` — run task on that session
3. Multiple sessions can run concurrently (max 3 by default)
4. Each session has its own browser profile directory
5. `POST /api/session/:id/stop` — clean up when done

## Profile Management

- Profiles stored in `data/browser-use/profiles/`
- Persistent across server restarts (saved logins survive)
- Multi-session profiles stored in `data/browser-use/profiles/<session_id>/`
- Use `/api/profile` to inspect stored profiles

## Safety Rules
1. ALWAYS confirm before submitting forms with real personal data
2. NEVER enter passwords unless explicitly told to
3. Take a screenshot before any irreversible action (submit, purchase, delete)
4. If a CAPTCHA appears, stop and ask the user for help
5. Respect domain restrictions in config
6. Report back with screenshots for visual verification
7. Custom actions execute arbitrary JavaScript — only register trusted handlers

## Workflow
1. Load skill → check plugin status (GET /api/status)
2. Plan the browser steps
3. Execute via API (POST /api/run with retry enabled)
4. Take screenshots at key points (POST /api/screenshot/analyze for visual analysis)
5. Extract and summarize results
6. Review history if needed (GET /api/history)
7. Export results if needed (POST /api/export)
8. Report to user with findings

## Integration with @vision
- **Auto-analysis**: Use `POST /api/screenshot/analyze` to capture + analyze in one call
- **Manual dispatch**: Use `POST /api/screenshot` then dispatch to @vision separately
- Complex visual elements (CAPTCHAs, charts, layouts) → @vision
- DOM-level interaction → browser-use handles directly
- @vision must be running on port 4100 for integration to work

## Configuration Reference
```json
{
  "retry": { "enabled": true, "max_attempts": 3, "backoff_base_ms": 2000 },
  "vision": { "enabled": true, "dispatch_to_vision": true, "vision_port": 4100 },
  "history": { "enabled": true, "max_entries": 100 },
  "browser": { "allowed_domains": [], "user_data_dir": "data/browser-use/profiles" },
  "scheduler": { "enabled": true, "max_tasks": 10, "check_interval_seconds": 60 },
  "sessions": { "max_concurrent": 3 },
  "custom_actions": { "enabled": true, "max_actions": 20 }
}
```

### Multi-Provider LLM Configuration

The browser-use plugin supports multiple LLM providers. Configure them via API or by editing `data/browser-use/config.json`.

#### Supported Provider Types

| Type | Adapter | API Key Env Var | Notes |
|------|---------|-----------------|-------|
| `openai` | ChatOpenAI | `OPENAI_API_KEY` | OpenAI API |
| `openai-compatible` | ChatOpenAI | `OPENAI_API_KEY` | Any OpenAI-compatible endpoint (OpenCode Go, NVIDIA, LM Studio, vLLM) |
| `openrouter` | ChatOpenRouter | `OPENROUTER_API_KEY` | OpenRouter multi-model gateway |
| `anthropic` | ChatAnthropic | `ANTHROPIC_API_KEY` | Anthropic Claude models |
| `google` | ChatGoogle | `GOOGLE_API_KEY` | Google Gemini models |
| `deepseek` | ChatDeepSeek | `DEEPSEEK_API_KEY` | DeepSeek models |
| `groq` | ChatGroq | `GROQ_API_KEY` | Groq fast inference |
| `ollama` | ChatOllama | (none) | Local Ollama server |
| `mistral` | ChatMistral | `MISTRAL_API_KEY` | Mistral AI models |
| `cerebras` | ChatCerebras | `CEREBRAS_API_KEY` | Cerebras fast inference |
| `litellm` | ChatLiteLLM | `LITELLM_API_KEY` | LiteLLM proxy |
| `vercel` | ChatVercel | `VERCEL_API_KEY` | Vercel AI SDK |
| `azure` | ChatAzure | `AZURE_OPENAI_API_KEY` | Azure OpenAI |
| `aws` | ChatAnthropicBedrock | AWS env vars | AWS Bedrock |
| `browser-use` | ChatBrowserUse | `BROWSER_USE_API_KEY` | Browser Use Cloud |

#### Add a Provider
```
POST http://localhost:4105/api/providers
{
  "id": "my-provider",
  "type": "openai-compatible",
  "name": "My Custom LLM",
  "apiKey": "sk-...",
  "baseUrl": "https://my-llm.example.com/v1",
  "models": ["my-model"],
  "vision": false
}
```

#### Switch Active Provider/Model
```
POST http://localhost:4105/api/llm/select
{ "providerId": "my-provider", "model": "my-model" }
```

#### Test a Provider
```
POST http://localhost:4105/api/providers/my-provider/test
```
Returns `{ success: true }` or `{ success: false, error: "..." }`.

#### Check Current Provider
```
GET http://localhost:4105/api/llm/status
```
Returns: active_provider, active_model, provider_name, provider_type, vision, models

#### List All Providers
```
GET http://localhost:4105/api/providers
```
Returns all providers with masked API keys.

#### Update a Provider
```
PUT http://localhost:4105/api/providers/my-provider
{ "apiKey": "new-key", "models": ["model-a", "model-b"] }
```

#### Delete a Provider
```
DELETE http://localhost:4105/api/providers/my-provider
```
Cannot delete the active provider — switch first.

#### OpenCode Go / NVIDIA / Any OpenAI-Compatible Endpoint
Use type `openai-compatible` with a custom `baseUrl`:
```json
{
  "id": "opencode-go",
  "type": "openai-compatible",
  "name": "OpenCode Go",
  "apiKey": "your-key",
  "baseUrl": "https://opencode.ai/api/v1",
  "models": ["deepseek-v4-flash", "qwen3.7-plus"],
  "vision": false
}
```

#### API Key Resolution Priority
1. `provider.apiKey` in config (if set)
2. Environment variable (e.g. `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`)
3. Error thrown if neither is available
