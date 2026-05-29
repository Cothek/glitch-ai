# Glitch AI

Portable AI companion environment — one clone, one launch, Glitch is ready on any Windows PC.

## What's Inside

| Item | Description |
|------|-------------|
| `glitch-memorycore/` | Glitch's memory system — identity, personality, skills, session history. Git submodule of [Cothek/glitch-memorycore](https://github.com/Cothek/glitch-memorycore). |
| `handy-voice/` | [Handy](https://handy-voice.org) — offline voice-to-text with push-to-talk (Ctrl+Space). Types directly into OpenCode. |
| `opencode/` | [OpenCode](https://opencode.ai) — the AI coding agent that runs Glitch. Portable CLI binary. |
| `opencode.json` | Config pointing OpenCode at Glitch's CLAUDE.md + server + experimental settings. |
| `tui.json` | Terminal UI preferences for OpenCode. |
| `bootstrap.ps1` | First-run setup — downloads OpenCode, Handy, and cloudflared. |
| `launch-glitch.bat` / `launch.ps1` | Launches Handy + OpenCode TUI for local use. |
| `launch-glitch-free.bat` / `launch-free.ps1` | **Free mode** — emergency fallback using only free models. |
| `serve-glitch.bat` / `serve-glitch.ps1` | Launches OpenCode Web server + Cloudflare Tunnel for remote access. |
| `setup-tunnel.ps1` | One-time Cloudflare Tunnel setup — authenticate, create tunnel, configure DNS. |
| `plugins/auth-proxy.mjs` | Auth proxy — adds Basic Auth for transparent mobile login via Cloudflare Tunnel. |

## Quick Start (Local)

```powershell
git clone --recurse-submodules https://github.com/Cothek/glitch-ai.git
cd glitch-ai
.\bootstrap.ps1
.\launch-glitch.bat
```

**First run only:** `bootstrap.ps1` downloads OpenCode, Handy, and cloudflared. Subsequent runs skip setup.

## Access from Anywhere (Phone / Other PC)

```powershell
.\setup-tunnel.ps1    # One-time: authenticate Cloudflare + create tunnel
.\serve-glitch.bat    # Each session: starts server + tunnel
```

This starts OpenCode as a web server on **port 4102** (proxied through auth proxy on port 4100) via **Cloudflare Tunnel** on `glitch.cothekdesigns.com`. Access it from anywhere:

```
https://glitch.cothekdesigns.com/
```

No open ports, no VPN, no firewall rules required. Traffic routes through Cloudflare's edge network to your machine via an encrypted Tunnel connection.

Login with username `opencode` and the auto-generated password shown in the terminal. The password is stored in `.server-password` (gitignored) with ACL lockdown — only your Windows user can read it.

### Setting a Custom Password

```powershell
set OPENCODE_SERVER_PASSWORD=your-password
.\serve-glitch.bat
```

## How It Works

### TUI Mode (`launch-glitch.bat`)
1. Starts Handy (system tray, push-to-talk via Ctrl+Space)
2. OpenCode opens in the terminal, loading `glitch-memorycore/CLAUDE.md`
3. Press **Ctrl+Space** and speak — Handy transcribes and pastes into the prompt
4. Glitch responds with full memory context

### Web Mode (`serve-glitch.bat`)
1. Starts Handy in the background for voice input
2. Starts auth proxy on port 4100 (adds Basic Auth for transparent login)
3. Starts OpenCode Web server on port 4102
4. Opens Cloudflare Tunnel to `glitch.cothekdesigns.com`
5. Access from any device: `https://glitch.cothekdesigns.com/`
6. Same Glitch memory and identity in every session

## Requirements

- Windows 10 or 11
- NVIDIA GPU with CUDA (recommended for Handy speed)
- API key for an LLM provider (configured via OpenCode's `/connect` or env vars)
- [Cloudflare](https://cloudflare.com) account (free) — for Tunnel-based remote access

## Repository Structure

```
glitch-ai/                    ← This repo
├── glitch-memorycore/        ← Submodule: Glitch's brain
├── handy-voice/              ← Portable voice-to-text binary
├── opencode/                 ← Portable OpenCode CLI binary
├── launch-glitch.bat         ← ⚡ TUI mode (local terminal)
├── serve-glitch.bat          ← 🌐 Web server mode (remote access)
├── bootstrap.ps1             ← First-run installer
├── setup-tunnel.ps1          ← One-time Cloudflare Tunnel setup
├── plugins/auth-proxy.mjs    ← Auth proxy for Cloudflare Tunnel
├── cloudflared-config.yml    ← Cloudflare Tunnel configuration
├── opencode.json             ← Config file
├── tui.json                  ← Terminal UI config
├── tools/                    ← Debug utilities
└── query-opencode-db.*       ← OpenCode DB query scripts
```
