# opencode → Cline Migration Guide

> **Date:** September 2026  
> **Author:** @coder (generated from Troy's specifications)  
> **Status:** Planning  
> **Scope:** Full migration from opencode to Cline as primary agent harness

---

## 1. Executive Summary

Troy has decided to migrate from opencode to Cline as the primary agent harness. The core driver is context window constraints: opencode's agent prompt payload (~27k tokens) exceeds what small local models can handle (4k-16k token context windows). There is no built-in context compression in opencode to mitigate this.

Cline offers a path forward with better local model support, SDK extensibility for custom tooling, chat connectors for phone access, and a plugin architecture built on MCP (Model Context Protocol). The Glitch memory system will be integrated via a custom MCP server, and Aider will be used alongside Cline for quick terminal-based edits where its repo map provides superior context management for small models.

This is a phased migration. opencode will remain available as a fallback until Cline workflows are validated.

---

## 2. Why Migrate

### The Context Problem

opencode's system prompt, combined with loaded memory files (`.md` files from `user/`), totals approximately 27,000 tokens. Small local models running via Ollama typically have context windows of 4k to 16k tokens. The prompt alone — before any user message, tool results, or conversation history — already exceeds what fits.

This means local models literally cannot run under opencode's architecture. The prompt is too large to even begin inference.

### No Context Compression

opencode has no built-in mechanism to reduce prompt size. There is no auto-compact, no conversation summarization, and no way to dynamically select which memory files to load based on relevance. Everything loads every time.

### Cline's Solution

- **Auto Compact**: Automatically summarizes conversation history when approaching context limits, using the provider's actual input-token count
- **Compact Prompt Mode**: Reduces prompt verbosity specifically for local inference
- **Subagents**: Spawn focused research agents that run in parallel, each with their own context window, keeping the main agent's context clean

### Aider's Solution

- **Repo Map with Graph Ranking**: Automatically selects the most relevant code for the current task, fitting large codebases into 4k-8k context windows
- **Graph-based relevance**: Uses AST parsing and structural analysis to rank code relevance, not just keyword matching

---

## 3. What We're Keeping

| Component | Status | Notes |
|---|---|---|
| Glitch memory files (`user/*.md`) | Preserved as-is | No changes to file format or content |
| Memory structure | Preserved as-is | `decisions.md`, `patterns.md`, `reminders.md`, `current-session.md`, `daily-diary/` |
| Memory triggers | Adapted | mulahazah system adapted to work via MCP tools |
| Git discipline | Unchanged | commit/push workflow operates the same way |
| Project knowledge | Preserved | All accumulated memory remains accessible |

---

## 4. What's Changing

| Aspect | opencode | Cline |
|---|---|---|
| Agent harness | opencode CLI + web UI | Cline CLI + TUI + IDE extension |
| Memory access | Custom memory agent | MCP server (`glitch-memory-mcp`) |
| Phone access | Web UI + Cloudflare tunnel | Chat connectors (Telegram/Slack/WhatsApp) |
| Model switching | Web app (Model Switcher) | Built-in picker + config profiles |
| Installation | PowerShell one-liner + Node runtime | `npm i -g cline` (compiled binaries) |
| Plugin system | opencode plugins | Cline SDK + MCP servers |

---

## 5. Installation

### Cline CLI

```bash
npm i -g cline
```

No Node runtime required after install — compiled binaries are shipped with the package.

### Aider (for quick terminal edits)

```powershell
# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://aider.chat/install.ps1 | iex"
```

### Desktop App (optional)

Download from `cline.bot/desktop`. Tauri-based (not Electron), lightweight, auto-updates.

---

## 6. Configuration

### Settings Location

```
~/.cline/
  data/
    globalState.json          # Global settings
    secrets.json              # API keys (mode 0o600)
    tasks/
      taskHistory.json        # Task history
    workspaces/
      <hash>/
        workspaceState.json   # Per-workspace state
```

### API Keys

- Stored in `~/.cline/data/secrets.json` with file mode `0o600`
- Environment variables also supported: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, etc.
- CLI setup: `cline auth [provider]` for interactive configuration

### Project Rules

- `.clinerules/` directory at project root
- All `.md` and `.txt` files in this directory are automatically loaded as context
- Conditional rules supported via YAML frontmatter `paths` globs:

```yaml
---
paths:
  - "src/api/**"
---
# API-specific rules go here
```

---

## 7. Model Switching (No Web App Needed)

### Built-in Model Picker

| Interface | Method |
|---|---|
| IDE Extension | Settings icon → API Provider dropdown → Model dropdown |
| CLI | `-m, --model <model-id>` and `-P, --provider <id>` flags |
| TUI | `/model` slash command mid-session |
| Desktop App | Provider + model selection before session start |

### Config Profiles (Quick Switch Pattern)

```bash
# Set up local profile
cline --config ~/.cline-local auth ollama --modelid qwen2.5-coder:32b

# Set up cloud profile
cline --config ~/.cline-cloud auth anthropic --modelid claude-sonnet-4-6

# Quick switch per invocation
cline --config ~/.cline-local "quick task with local model"
cline --config ~/.cline-cloud "complex task with cloud model"
```

### Model Orchestration (Multi-Model Pipeline)

```bash
# Phase 1: Quick summary with cheap model
echo "$ISSUE" | cline --config ~/.cline-haiku "summarize"

# Phase 2: Detailed plan with expensive model
echo "$SUMMARY" | cline --config ~/.cline-opus --thinking high "create plan"

# Phase 3: Execute with mid-tier model
echo "$PLAN" | cline --config ~/.cline-sonnet "implement"
```

### SDK Programmatic Switch

```typescript
const agent = new Agent({
  providerId: "anthropic",
  modelId: "claude-sonnet-4-6",
  apiKey: process.env.ANTHROPIC_API_KEY,
})
```

---

## 8. Glitch Memory Integration via MCP Server

### Architecture

```
glitch-memory-mcp/
├── server.mjs           # MCP server (stdio transport)
├── memory-reader.mjs    # Read Glitch memory files
├── memory-writer.mjs    # Append to memory files
└── memory-search.mjs    # FTS search via SQLite
```

### MCP Config (add to Cline's MCP settings)

```json
{
  "mcpServers": {
    "glitch-memory": {
      "command": "node",
      "args": ["path/to/glitch-memory-mcp/server.mjs"],
      "env": {}
    }
  }
}
```

### Exposed Tools

| Tool | Parameters | Description |
|---|---|---|
| `read_memory` | `file: string` | Read any Glitch memory file |
| `write_memory` | `file: string, content: string` | Append to memory files |
| `search_memory` | `query: string` | Full-text search across all memory files |
| `list_projects` | — | Get active project status |
| `get_decisions` | — | Retrieve recent decisions |
| `get_patterns` | — | Retrieve observed patterns |
| `check_memory_triggers` | — | Check for pending memory triggers |

### Cline Rules for Memory (add to `.clinerules/memory.md`)

```markdown
# Memory System Integration

At session start, use the glitch-memory MCP tools to:
1. Search memory for relevant context about this project
2. Read main-memory.md for identity and preferences
3. Read current-session.md for recent work
4. Read decisions.md for past choices
5. Read patterns.md for observed patterns

When making important decisions or discoveries:
- Use write_memory to record to decisions.md
- Use write_memory to record to patterns.md
- Use write_memory to update current-session.md

At session end:
- Use write_memory to update current-session.md with session summary
```

---

## 9. Phone Access via Chat Connectors

### Telegram Setup

```bash
cline connect telegram -k $TELEGRAM_BOT_TOKEN
```

Each conversation thread becomes a full Cline agent session. Chat from your phone like texting a colleague.

### Slack Setup

```bash
cline connect slack --bot-token $SLACK_BOT_TOKEN --signing-secret $SECRET --base-url $URL
```

### Other Connectors

| Platform | Command |
|---|---|
| WhatsApp | `cline connect whatsapp --base-url $URL` |
| Google Chat | `cline connect gchat --base-url $URL` |
| Discord | `cline connect discord` |
| Linear | `cline connect linear --api-key $LINEAR_API_KEY` |

### Why This Is Better Than Web UI + Tunnel

- No Cloudflare tunnel setup required
- Native mobile apps (Telegram, Slack, WhatsApp) — no browser needed
- Thread-based conversations = separate agent sessions
- Push notifications for agent responses
- Works on any device without browser access

---

### 9.5 Multi-Computer Workflow

**Does Cline have a web UI remoting mode?**

No — Cline does not have a web UI that you can expose via a tunnel like opencode's web server mode. But this turns out to be a non-issue, because **chat connectors solve the multi-computer problem more cleanly**.

**How your workflow maps:**

| Computer | Role | Setup |
|---|---|---|
| **Computer 1** (home office, GPU rig) | Runs Cline + the agent | `cline connect telegram -k $TELEGRAM_BOT_TOKEN` |
| **Computer 2** (laptop, work machine) | You work here | Open Telegram → chat with your agent |

That's it. One command on Computer 1, and you're accessible from any device with Telegram installed.

```
Computer 1 (where Cline runs):
$ cline connect telegram -k $TELEGRAM_BOT_TOKEN
# Agent is now live on Telegram

Computer 2 (where you work):
→ Open Telegram app
→ Start a conversation with your bot
→ Each message = a full Cline agent session
→ Each thread = a separate workspace
```

**Why this is actually better than opencode's web UI + Cloudflare tunnel:**

| Factor | opencode Web UI + Tunnel | Cline Chat Connectors |
|---|---|---|
| Setup complexity | Cloudflare tunnel config, DNS, port forwarding | One command: `cline connect telegram …` |
| Authentication | Tunnel auth or exposed web UI | Bot token — inherent to Telegram |
| Reliability | Tunnel drops, DNS propagation issues | Telegram's infrastructure — 99.9% uptime |
| Mobile experience | Browser-based, cramped UI | Native Telegram app — proper mobile UX |
| Session management | Single shared web session | Thread-per-session isolation |
| Offline resilience | Tunnel down = no access | Messages queue in Telegram, delivered on reconnect |
| Push notifications | None — must poll or refresh | Native push on every agent response |
| Multi-device | Same web URL from any device | Any Telegram client — desktop, mobile, web |

**Alternative: SSH CLI access**

If you don't want a chat connector at all, you can always SSH into Computer 1 and run Cline directly:

```bash
ssh computer1
cline --config ~/.cline-local "fix the bug in auth.ts"
```

This gives you terminal-native access without any intermediary. Pair it with tmux/screen for session persistence. The downside: no push notifications, and you're tied to a terminal.

**Bottom line:** opencode's web UI + tunnel was a workaround for "I need to access my agent from another device." Cline's chat connectors solve the same problem with less infrastructure, better security, native mobile UX, and push notifications. It's not a compromise — it's an upgrade.

---

## 10. Context Management for Small Models

### Cline's Auto Compact

- Automatically summarizes conversation when approaching context limit
- Uses provider's actual input-token count (fixed Sep 2026)
- Works with Ollama and local models

### Compact Prompt Mode

- Enable in Settings → Features → Use Compact Prompt
- Reduces prompt verbosity for local inference

### Subagents

- Spawn focused research agents that run in parallel
- Each subagent gets its own context window
- Keeps main agent's context clean
- Returns only relevant file paths

### Memory Bank (Optional)

- Documentation methodology for cross-session context
- Stored in `memory-bank/` directory
- Read at session start via custom instructions

---

## 11. Aider for Quick Local Edits

### Why Use Aider Alongside Cline

- Aider's repo map with graph ranking is best-in-class for small contexts
- Automatically selects most relevant code for 4k-8k windows
- One-line install matches opencode's simplicity
- CLI-native, works over SSH

### Aider + Ollama Setup

```bash
# Set context window
export OLLAMA_CONTEXT_LENGTH=8192

# Run with local model
aider --model ollama_chat/qwen2.5-coder:32b
```

### When to Use Which

| Task | Use | Why |
|---|---|---|
| Quick terminal edits (small model) | Aider | Repo map fits small contexts |
| Complex multi-file refactoring | Cline | Plan/Act mode, visual diffs |
| Phone access | Cline | Chat connectors |
| Architecture planning | Cline | Multi-agent teams |
| Routine coding with local model | Aider | Best context management |

---

## 12. Migration Checklist

### Phase 1: Install & Configure

- [ ] Install Cline CLI: `npm i -g cline`
- [ ] Install Aider: `irm https://aider.chat/install.ps1 | iex`
- [ ] Configure API keys: `cline auth`
- [ ] Set up Ollama provider for local models
- [ ] Configure config profiles for local/cloud switching

### Phase 2: Memory Integration

- [ ] Build glitch-memory MCP server
- [ ] Register MCP server in Cline config
- [ ] Add memory rules to `.clinerules/`
- [ ] Test memory read/write/search via MCP

### Phase 3: Phone Access

- [ ] Create Telegram bot via BotFather
- [ ] Configure Cline Telegram connector
- [ ] Test remote agent access from phone
- [ ] Set up additional connectors (Slack, WhatsApp) if needed

### Phase 4: Workflow Adaptation

- [ ] Adapt compaction checkpoint to Cline's Auto Compact
- [ ] Adapt mulahazah triggers to MCP tools
- [ ] Test local model workflow with Aider
- [ ] Test cloud model workflow with Cline
- [ ] Verify git discipline works unchanged

### Phase 5: Decommission opencode

- [ ] Export any remaining opencode config
- [ ] Archive opencode installation
- [ ] Update documentation to reflect Cline as primary harness
- [ ] Close opencode-related issues/reminders

---

## 13. What You Lose (Honest Assessment)

| Lost Capability | Replacement | Notes |
|---|---|---|
| Unified web server mode | Chat connectors | Arguably better for phone access |
| opencode's plugin ecosystem | Cline SDK + MCP | Different architecture, more flexible |
| Built-in model registry | Manual config | opencode's `check-models.ps1` auto-discovery |
| Launch scripts | Cline's startup flow | `launch.mjs`, `serve.mjs`, etc. no longer needed |
| Model Switcher web app | Built-in picker | No web app needed |
| Mulahazah trigger system | MCP tools | Needs adaptation |
| Compaction checkpoint | Auto Compact | Needs adaptation |

---

## 14. What You Gain

| Gained Capability | Details |
|---|---|
| Local models that actually work | Aider's repo map + Cline's Compact Prompt |
| Phone access without tunnels | Chat connectors are native |
| SDK for custom agents | `@cline/sdk` with 14 hook stages |
| Multi-agent teams | Coordinator + specialists pattern |
| Scheduled agents | Cron-based automation |
| Tauri desktop app | Lightweight, not Electron |
| ACP support | Works with Zed, Neovim, Emacs |

---

## 15. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| MCP server bugs | Medium | High | Thorough testing, fallback to file reads |
| Context management regression | Low | High | Test with actual local models early |
| Phone connector reliability | Low | Medium | Multiple connectors as backup |
| Migration disruption | Medium | Medium | Phased approach, keep opencode as fallback |

---

## 16. Timeline Estimate

| Week | Focus | Deliverables |
|---|---|---|
| Week 1 | Install & Configure | Cline + Aider installed, API keys configured, basic workflows tested |
| Week 2 | Memory Integration | MCP server built and tested, memory accessible via Cline tools |
| Week 3 | Phone Access | Telegram connector configured, remote workflows validated |
| Week 4 | Full Adaptation | Workflow fully adapted, opencode decommissioned |

---

## 17. Success Criteria

- [ ] Can run Cline with local Ollama model on 8k context window
- [ ] Memory files accessible via MCP tools
- [ ] Phone access working via Telegram connector
- [ ] Model switching works without web app
- [ ] All Glitch memory preserved and accessible
- [ ] Git discipline unchanged

---

*This document was generated from Troy's migration specifications. Update as implementation progresses.*
