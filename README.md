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
| `bootstrap.ps1` | First-run setup — downloads OpenCode, Handy, and Tailscale. |
| `launch-glitch.bat` / `launch.ps1` | Launches Handy + OpenCode TUI for local use. |
| `serve-glitch.bat` / `serve-glitch.ps1` | Launches OpenCode Web server (accessible from phone via Tailscale). |

## Quick Start (Local)

```powershell
git clone --recurse-submodules https://github.com/Cothek/glitch-ai.git
cd glitch-ai
.\bootstrap.ps1
.\launch-glitch.bat
```

**First run only:** `bootstrap.ps1` downloads OpenCode, Handy, and installs Tailscale. Subsequent runs skip setup.

## Access from Anywhere (Phone / Other PC)

```powershell
.\serve-glitch.bat
```

This starts OpenCode as a web server on port 4096 and uses [Tailscale Serve](https://tailscale.com/kb/1310/serve) to expose it on your tailnet. Access it from any device on your Tailscale network using:

```
http://bohemoth/
```

No port number needed — Tailscale Serve handles routing automatically. Login with username `opencode` and the auto-generated password shown in the terminal. The password is stored in `.server-password` (gitignored) with ACL lockdown — only your Windows user can read it.

### Setting a Custom Password

```powershell
set OPENCODE_SERVER_PASSWORD=your-password
.\serve-glitch.bat
```

### How It Works

`serve-glitch.ps1` binds OpenCode to `127.0.0.1:4096` (localhost only) and uses `tailscale serve` to proxy external traffic from your tailnet. This means:
- No Windows Firewall rules needed
- No port numbers to remember
- Works over Tailscale's encrypted network

## How It Works

### TUI Mode (`launch-glitch.bat`)
1. Starts Handy (system tray, push-to-talk via Ctrl+Space)
2. OpenCode opens in the terminal, loading `glitch-memorycore/CLAUDE.md`
3. Press **Ctrl+Space** and speak — Handy transcribes and pastes into the prompt
4. Glitch responds with full memory context

### Web Mode (`serve-glitch.bat`)
1. Starts Handy in the background for voice input
2. Starts OpenCode Web server on port 4096
3. Access from your phone or any device via Tailscale IP
4. Same Glitch memory and identity in every session

## Requirements

- Windows 10 or 11
- NVIDIA GPU with CUDA (recommended for Handy speed)
- API key for an LLM provider (configured via OpenCode's `/connect` or env vars)
- [Tailscale](https://tailscale.com) account (free) — installed automatically by bootstrap

## Repository Structure

```
glitch-ai/                    ← This repo
├── glitch-memorycore/        ← Submodule: Glitch's brain
├── handy-voice/              ← Portable voice-to-text binary
├── opencode/                 ← Portable OpenCode CLI binary
├── launch-glitch.bat         ← ⚡ TUI mode (local terminal)
├── serve-glitch.bat          ← 🌐 Web server mode (phone access)
├── bootstrap.ps1             ← First-run installer
├── opencode.json             ← Config file
└── tui.json                  ← Terminal UI config
```
