# Glitch AI

Portable AI companion environment — one clone, one launch, Glitch is ready on any Windows PC.

## What's Inside

| Item | Description |
|------|-------------|
| `glitch-memorycore/` | Glitch's memory system — identity, personality, skills, session history. Git submodule of [Cothek/glitch-memorycore](https://github.com/Cothek/glitch-memorycore). |
| `handy-voice/` | [Handy](https://handy-voice.org) — offline voice-to-text with push-to-talk (Ctrl+Space). Types directly into OpenCode. |
| `opencode/` | [OpenCode](https://opencode.ai) — the AI coding agent that runs Glitch. Portable CLI binary. |
| `opencode.json` | Config pointing OpenCode at Glitch's CLAUDE.md + experimental settings. |
| `tui.json` | Terminal UI preferences for OpenCode. |
| `bootstrap.ps1` | First-run setup — downloads OpenCode and Handy binaries. |
| `launch.bat` / `launch.ps1` | One-click launchers — starts Handy in background, then opens OpenCode with Glitch loaded. |

## Quick Start

```powershell
git clone --recurse-submodules https://github.com/Cothek/glitch-ai.git
cd glitch-ai
.\bootstrap.ps1
.\launch.bat
```

**First run only:** `bootstrap.ps1` downloads the OpenCode CLI binary and Handy voice engine (if not found). Subsequent runs skip this.

## How It Works

1. **launch.bat** starts Handy (system tray, push-to-talk via Ctrl+Space)
2. OpenCode opens in the current terminal, loading `glitch-memorycore/CLAUDE.md` as its core instructions
3. Speak your query — Handy transcribes with Whisper (GPU) and pastes it into OpenCode's prompt
4. Glitch responds with full memory of who you are and what we've built together

When you close OpenCode, Handy stays running in the tray.

## Requirements

- Windows 10 or 11
- NVIDIA GPU with CUDA (recommended for Handy voice transcription speed)
- API key for an LLM provider (configured via OpenCode's `/connect` or environment variables)

## Repository Structure

```
glitch-ai/                    ← This repo (wrapper + launcher)
├── glitch-memorycore/        ← Submodule: Glitch's brain
├── handy-voice/              ← Portable voice-to-text binary
├── opencode/                 ← Portable OpenCode CLI binary
├── launch.bat                ← ⚡ Double-click to start
├── bootstrap.ps1             ← First-run installer
└── opencode.json             ← Config file
```
