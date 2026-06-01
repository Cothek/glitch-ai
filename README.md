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

`setup.bat` initializes the engine submodule and launches a profile wizard (name, preferences). Your data stays local — nothing shared.

### For Troy (Returning User)

```powershell
git clone https://github.com/Cothek/glitch-ai.git
cd glitch-ai
git submodule update --init --recursive
git clone https://cothek@github.com/Cothek/glitch-user-troy.git user/
.\launch-glitch.bat
```

The `cothek@` prefix in the clone URL tells Windows Credential Manager to auto-select your stored PAT — no login pop-up.

### First Run Only

After cloning, run `.\scripts\bootstrap.ps1` to download OpenCode and optional tools (Handy voice input, Cloudflare Tunnel). Subsequent runs skip this.

## How It Works

Glitch is split into three layers:

| Layer | Repo | Contents |
|-------|------|----------|
| **Engine** | `Cothek/glitch-engine` (public) | Core identity, prompt rules, skills, plugins, library — no user data |
| **User Data** | `Cothek/glitch-user-troy` (private) | Personal memory, diary, decisions, projects — Troy only |
| **Launcher** | This repo (public) | OpenCode binary, launch scripts, config, bootstrap |

On every launch, `launch.ps1` detects your user profile, generates a runtime config that loads both engine + user data, and restores the base config on exit.

## Access from Anywhere (Phone / Other PC)

```powershell
.\scripts\setup-tunnel.ps1    # One-time: authenticate Cloudflare + create tunnel
.\serve-glitch.bat            # Each session: starts server + tunnel
```

This starts OpenCode as a web server proxied through Cloudflare Tunnel. No open ports, no VPN required. Login with username `opencode` and the auto-generated password shown in the terminal.

Configure your domain via `.env`: copy `.env.example` to `.env` and set `GLITCH_DOMAIN`.

## What's Inside

| Item | Description |
|------|-------------|
| `glitch-memorycore/` | Engine submodule — Glitch identity, rules, skills, plugins |
| `user/` | Your personal data — memory, diary, preferences (gitignored) |
| `handy-voice/` | [Handy](https://handy-voice.org) — offline voice-to-text with push-to-talk |
| `opencode/` | [OpenCode](https://opencode.ai) — the AI agent runtime |
| `setup.bat` | First-time setup — initializes engine + profile wizard |
| `launch-glitch.bat` | Local terminal mode |
| `serve-glitch.bat` | Web server mode with Cloudflare Tunnel |
| `scripts/bootstrap.ps1` | Downloads OpenCode, Handy, and cloudflared |
| `opencode.json` | Base config (engine-only — user data added at runtime) |
| `.env.example` | Domain/port configuration template |
| `plugins/auth-proxy.mjs` | Basic auth proxy for mobile access |

## Requirements

- Windows 10 or 11
- API key for an LLM provider (configured via OpenCode's `/connect` or env vars)
- GitHub account (for cloning)
- NVIDIA GPU with CUDA (recommended for Handy speed)
- [Cloudflare](https://cloudflare.com) account (free) — for remote access

## Repository Structure

```
glitch-ai/                    ← This repo (public)
├── glitch-memorycore/        ← Submodule: engine (glitch-engine)
├── user/                     ← Your data (gitignored / private submodule)
├── scripts/                  ← Internal PowerShell scripts
├── config/                   ← Configuration files
├── data/                     ← Auto-generated data (gitignored)
├── setup.bat                 ← First-time setup
├── launch-glitch.bat         ← Local terminal
├── serve-glitch.bat          ← Web server
├── opencode.json             ← Engine-only base config
├── .env.example              ← Configuration template
├── plugins/                  ← Auth proxy, helpers
├── handy-voice/              ← Voice input
├── opencode/                 ← OpenCode binary
├── cloudflared.exe           ← Cloudflare Tunnel binary
└── tools/                    ← Debug utilities
```
