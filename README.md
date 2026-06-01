# Glitch AI

Portable AI companion environment — one clone, one setup, Glitch is ready on any Windows PC.

## Quick Start

### For New Users

```powershell
git clone https://github.com/Cothek/glitch-ai.git
cd glitch-ai
.\setup.bat          # Double-click or run in terminal — handles everything
.\launch-glitch.bat  # Start using Glitch
```

`setup.bat` initializes the engine submodule (`glitch-engine`) and launches a profile wizard (name, preferences). Your data stays local under `user/` — nothing shared.

### For Troy (Returning User)

```powershell
git clone https://github.com/Cothek/glitch-ai.git
cd glitch-ai
git submodule update --init --recursive
git clone https://cothek@github.com/Cothek/glitch-user-troy.git user/
.\launch-glitch.bat
```

The `cothek@` prefix tells Windows Credential Manager to auto-select your stored PAT — no login pop-up.

**If you get a GitHub login pop-up after `git submodule sync`**, the submodule remote got reset. Fix it:

```powershell
cd glitch-memorycore
git remote set-url origin https://cothek@github.com/Cothek/glitch-engine.git
```

## How It Works

Glitch is split into three layers:

| Layer | Repo | Contents |
|-------|------|----------|
| **Engine** | `Cothek/glitch-engine` (public) | Core identity, prompt rules, 23+ skills, plugins, library |
| **User Data** | `Cothek/glitch-user-troy` (private) | Personal memory, diary, decisions, projects, preferences |
| **Launcher** | `Cothek/glitch-ai` (public) | OpenCode binary, launch scripts, config, bootstrap |

### Launch Flow

1. `launch-glitch.bat` calls `scripts/launch.ps1`
2. Launch script detects your user profile (`user/main-memory.md` or `user/{name}/main-memory.md`)
3. Generates a runtime `opencode.json` with engine + user instruction paths (string-level regex, never re-serializes JSON — preserves escaping)
4. Starts OpenCode with the generated config
5. On exit, restores the engine-only base config

## Access from Anywhere (Phone / Other PC)

```powershell
.\scripts\setup-tunnel.ps1    # One-time: authenticate Cloudflare + create tunnel
.\serve-glitch.bat            # Each session: starts server + tunnel
```

This starts OpenCode as a web server proxied through Cloudflare Tunnel. No open ports, no VPN required. Login with username `opencode` and the auto-generated password shown in the terminal.

Configure your domain via `.env`: copy `.env.example` to `.env` and set `GLITCH_DOMAIN`.

## Repository Structure

```
glitch-ai/                    ← This repo (public)
├── glitch-memorycore/        ← Submodule: public engine (glitch-engine)
│   ├── core/                 ← Generic Glitch identity (no user data)
│   ├── plugins/glitch-skills/ ← 23 skills + registry
│   ├── library/              ← Knowledge library
│   └── users/_template/      ← New-user profile template
│
├── user/                     ← Your personal data (gitignored / private submodule)
│   ├── main-memory.md        ← Your profile, preferences, history
│   ├── current-session.md    ← Session context
│   ├── daily-diary/          ← Session diary
│   └── projects/             ← Active projects
│
├── scripts/                  ← Internal PowerShell scripts
│   ├── launch.ps1            ← User-aware launcher
│   ├── serve-glitch.ps1      ← Web server mode config generator
│   ├── bootstrap.ps1         ← Downloads dependencies
│   ├── setup.ps1             ← Profile wizard
│   ├── validate-config.ps1   ← Config + syntax validator
│   ├── check-updates.ps1     ← Dependency update checker
│   ├── check-models.ps1      ← New model discovery
│   ├── fix-paths.ps1/.mjs    ← SQLite path normalizer
│   └── query-opencode-db.*   ← Session DB query tools
│
├── config/                   ← Configuration files
│   ├── tui.json              ← Terminal UI preferences
│   ├── cloudflared-config.yml← Cloudflare Tunnel config
│   └── query                 ← (internal tool config)
│
├── data/                     ← Auto-generated runtime data (gitignored)
│   ├── update-status.json    ← Dependency check results
│   ├── model-update-status.json
│   ├── skills-lock.json
│   └── screenshots/          ← Vision agent screenshots
│
├── setup.bat                 ← First-time setup (double-click)
├── launch-glitch.bat         ← Local terminal mode
├── launch-glitch-free.bat    ← Free model emergency mode
├── launch-glitch-safe.bat    ← Safe mode for troubleshooting
├── serve-glitch.bat          ← Web server mode
├── opencode.json             ← Engine-only base config
├── .env.example              ← Domain/port configuration template
├── plugins/                  ← Auth proxy, helpers
├── opencode/                 ← OpenCode binary
├── handy-voice/              ← Offline voice-to-text
├── cloudflared.exe           ← Cloudflare Tunnel binary
└── tools/                    ← Debug utilities
```

## What's Inside

| Item | Description |
|------|-------------|
| `glitch-memorycore/` | Engine submodule — Glitch identity, rules, skills, plugins |
| `user/` | Your personal memory, diary, projects (gitignored) |
| `scripts/` | Launch, setup, validation, and utility scripts |
| `config/` | Terminal UI config, Cloudflare Tunnel config |
| `data/` | Auto-generated status files (gitignored) |
| `setup.bat` | First-time setup — inits engine + profile wizard |
| `launch-glitch.bat` | Local terminal mode |
| `launch-glitch-free.bat` | Emergency fallback using free models |
| `launch-glitch-safe.bat` | Minimal config for troubleshooting |
| `serve-glitch.bat` | Web server mode with Cloudflare Tunnel |
| `opencode.json` | Engine-only base config (user data added at runtime) |
| `.env.example` | Domain/port configuration template |
| `handy-voice/` | [Handy](https://handy-voice.org) — offline voice-to-text |
| `opencode/` | [OpenCode](https://opencode.ai) — AI agent runtime |
| `plugins/auth-proxy.mjs` | Basic auth proxy for mobile access |

## Modifying Config / Launch Scripts

Changes to `opencode.json`, `launch.ps1`, `serve-glitch.ps1`, or any `.bat` launcher require:
1. A review pass (@reviewer) before applying
2. `validate-config.ps1` passing after the change
3. A restart of OpenCode to pick up the new config

This is enforced by **R14** in `glitch-memorycore/prompt-rules.md` (immutable rule).

## Requirements

- Windows 10 or 11
- API key for an LLM provider (configured via OpenCode's `/connect` or env vars)
- GitHub account (for cloning)
- NVIDIA GPU with CUDA (recommended for Handy speed)
- [Cloudflare](https://cloudflare.com) account (free) — for remote access
