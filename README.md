# Glitch AI

Portable AI companion environment — one clone, one setup, Glitch is ready on Windows, Mac, or Linux.

## Quick Start

### Windows

```powershell
git clone https://github.com/Cothek/glitch-ai.git
cd glitch-ai
.\scripts\setup.ps1            # First-time: init engine + profile wizard
.\launch-glitch.bat            # Start using Glitch
```

Or use the Node.js launcher (works on all platforms):
```powershell
node scripts\launch.mjs        # Cross-platform launcher
```

### Mac / Linux

```bash
git clone https://github.com/Cothek/glitch-ai.git
cd glitch-ai
git submodule update --init --recursive
node scripts/setup.mjs         # First-time setup
./launch-glitch.sh             # Start using Glitch (unified launcher)
```

### For Troy (Returning User, cross-platform)

```bash
git clone https://github.com/Cothek/glitch-ai.git
cd glitch-ai
git submodule update --init --recursive
git clone https://cothek@github.com/Cothek/glitch-user-troy.git user/
./launch-glitch.sh
```

> **Note**: The `.sh` scripts require [Node.js](https://nodejs.org) 22+. The `.bat` scripts (Windows) are the legacy path — both call the same `.mjs` launcher under the hood.

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

1. `launch-glitch.bat` (Windows) or `launch-glitch.sh` (Mac/Linux) calls `scripts/launch.mjs`
2. The `.mjs` launcher detects your user profile (`user/main-memory.md` or `user/{name}/main-memory.md`)
3. Generates a runtime `opencode.json` with engine + user instruction paths from the `config/` template
4. Validates the generated config with `JSON.parse()`
5. Starts OpenCode with the generated config
6. On exit, the session ends — config is regenerated fresh on next launch

> **Legacy**: The original `.ps1` scripts still work on Windows for backward compatibility.

## Access from Anywhere (Phone / Other PC)

```powershell
.\scripts\setup-tunnel.ps1    # One-time: authenticate Cloudflare + create tunnel
.\launch-glitch.bat           # Each session: select server mode (option 4)
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
├── scripts/                  ← Launch & utility scripts
│   ├── launch.mjs            ← Cross-platform launcher (primary)
│   ├── launch-free.mjs       ← Free mode launcher
│   ├── launch-safe.mjs       ← Safe mode launcher
│   ├── serve.mjs             ← Web server mode
│   ├── validate-config.mjs   ← Config + syntax validator
│   ├── bootstrap.ps1         ← Downloads dependencies
│   ├── setup.ps1             ← Profile wizard
│   ├── check-updates.ps1     ← Dependency update checker
│   ├── check-models.ps1      ← New model discovery
│   ├── switch-branch.ps1     ← Git branch manager
│   ├── switch-model.ps1      ← Free model selector
│   ├── sync-user.ps1         ← User data sync helper
│   ├── fix-paths.mjs         ← SQLite path normalizer
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
├── launch-glitch.bat         ← Unified launcher (Windows) — all modes
├── launch-glitch.sh          ← Unified launcher (Mac/Linux) — all modes
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
| `scripts/` | Launch, setup, validation, and utility scripts (.mjs cross-platform, .ps1 legacy) |
| `config/` | Terminal UI config, Cloudflare Tunnel config |
| `data/` | Auto-generated status files (gitignored) |
| `launch-glitch.bat` / `.sh` | Unified launcher — all modes (normal, free, local, safe, server) |
| `opencode.json` | Engine-only base config (user data added at runtime) |
| `.env.example` | Domain/port configuration template |
| `handy-voice/` | [Handy](https://handy-voice.org) — offline voice-to-text |
| `opencode/` | [OpenCode](https://opencode.ai) — AI agent runtime |
| `plugins/auth-proxy.mjs` | Basic auth proxy for mobile access |

## Modifying Config / Launch Scripts

Changes to `opencode.json`, `scripts/launch.mjs`, `scripts/serve.mjs`, `config/` templates, or any launch script require:
1. A review pass (@reviewer) before applying
2. `validate-config.mjs` passing after the change
3. A restart of OpenCode to pick up the new config

This is enforced by **R14** in `glitch-memorycore/prompt-rules.md` (immutable rule).

## Requirements

- **Windows** 10 or 11, **macOS** 13+, or **Linux** (x86_64)
- **Node.js** 22+ (required for the cross-platform launcher)
- **API key** for an LLM provider (configured via OpenCode's `/connect` or env vars)
- **GitHub account** (for cloning)
- **NVIDIA GPU with CUDA** (recommended for Handy speed on Windows)
- **[Cloudflare](https://cloudflare.com)** account (free) — for remote access

> **Windows-only features**: Handy voice input, automatic binary sync from npm. All core features work cross-platform.
