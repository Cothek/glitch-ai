$RootDir = Split-Path -Parent $PSCommandPath
$OpenCodeBin = "$RootDir\opencode\opencode.exe"
$ConfigPath = "$RootDir\opencode.json"
$BackupPath = "$RootDir\opencode.json.bak"

$ErrorActionPreference = "Continue"

# ── Known free models ──
$FreeModels = @{
  "opencode/deepseek-v4-flash-free"    = "DeepSeek V4 Flash Free"
  "opencode/mimo-v2.5-free"            = "Mimo v2.5 Free"
  "opencode/nemotron-3-super-free"     = "Nemotron 3 Super Free"
  "opencode/big-pickle"                = "Big Pickle"
}

# ── Determine model ──
$FreeModel = $env:GLITCH_FREE_MODEL
if (-not $FreeModel) {
  $FreeModel = "opencode/deepseek-v4-flash-free"
}

if (-not $FreeModels.ContainsKey($FreeModel)) {
  Write-Host ""
  Write-Host "ERROR: Unknown free model '$FreeModel'" -ForegroundColor Red
  Write-Host "Valid models:" -ForegroundColor Yellow
  foreach ($key in $FreeModels.Keys | Sort-Object) {
    Write-Host "  $key  — $($FreeModels[$key])" -ForegroundColor Yellow
  }
  Write-Host ""
  Write-Host "Set GLITCH_FREE_MODEL env var to one of the above, or unset to use default." -ForegroundColor Cyan
  Write-Host ""
  Write-Host "  `$env:GLITCH_FREE_MODEL=`"opencode/mimo-v2.5-free`"" -ForegroundColor Gray
  Write-Host "  .\launch-glitch-free.bat" -ForegroundColor Gray
  exit 1
}

$ModelName = $FreeModels[$FreeModel]

Write-Host ""
Write-Host "⚡ Glitch Free Mode" -ForegroundColor Green
Write-Host "  Model: $FreeModel ($ModelName)" -ForegroundColor Cyan
Write-Host ""

# ── Check opencode exists ──
if (-not (Test-Path $OpenCodeBin)) {
  Write-Host "OpenCode not found. Run bootstrap.ps1 first." -ForegroundColor Red
  exit 1
}

# ── Back up current config ──
if (Test-Path $ConfigPath) {
  Write-Host "  Backing up opencode.json -> opencode.json.bak" -ForegroundColor Yellow
  Copy-Item $ConfigPath $BackupPath -Force
}

# ── Generate free mode config ──
$freePrompt = @"
You are Glitch running in FREE MODE. All agents are using the free model `"$FreeModel`" ($ModelName).

## Free Mode Rules
1. You have FULL permissions — same capabilities as normal mode.
2. ALL agents use `"$FreeModel`" — there are NO paid fallback models available.
3. Premium features are UNAVAILABLE: image/screenshot analysis, complex code review, and advanced code generation (qwen3.6-plus features).
4. If the free model exhausts its quota, close this session and relaunch with a different model:
   - Set `$env:GLITCH_FREE_MODEL to one of: opencode/mimo-v2.5-free, opencode/nemotron-3-super-free, opencode/big-pickle
   - Then run .\launch-glitch-free.bat again
5. Tell Troy which model is active on session start so he knows what to expect.

## Agent Selection (All Free)
| Task Type | Agent | Model |
|-----------|-------|-------|
| Bash, file ops, simple edits | @general | $FreeModel |
| Code (1-5 files, standard logic) | @general | $FreeModel |
| Codebase research | @explore | $FreeModel |
| Architecture / planning | @plan | $FreeModel |
| Code scaffolding | @build | $FreeModel |

No premium agents (@coder, @vision, @reviewer, @general-paid, @build-paid) are available in free mode.
"@

$freeConfig = @"
{
  "`$schema": "https://opencode.ai/config.json",
  "instructions": [
    "glitch-memorycore/prompt-rules.md",
    "glitch-memorycore/CLAUDE.md",
    "glitch-memorycore/main/current-session.md",
    "glitch-memorycore/main/main-memory.md",
    "glitch-memorycore/main/reminders.md",
    "glitch-memorycore/main/session-dashboard.md"
  ],
  "agent": {
    "delegator": {
      "model": "$FreeModel",
      "mode": "primary",
      "description": "Free mode — orchestrates tasks using only free models ($ModelName).",
      "color": "#22c55e",
      "temperature": 0.2,
      "permission": {
        "read": "allow",
        "edit": "allow",
        "glob": "allow",
        "grep": "allow",
        "list": "allow",
        "webfetch": "allow",
        "websearch": "allow",
        "question": "allow",
        "skill": "allow",
        "todowrite": "allow",
        "bash": { "git *": "allow", "*": "deny" },
        "external_directory": "deny",
        "task": "allow"
      },
      "prompt": "$($freePrompt.Replace('\', '\\').Replace('"', '\"').Replace("`n", '\n').Replace("`r", ''))"
    },
    "general": {
      "model": "$FreeModel",
      "mode": "subagent",
      "description": "General-purpose agent — bash commands, file ops, simple edits, standard code.",
      "permission": {
        "read": "allow", "edit": "allow", "bash": "allow",
        "glob": "allow", "grep": "allow", "list": "allow",
        "webfetch": "allow", "websearch": "deny",
        "question": "allow", "todowrite": "allow"
      },
      "temperature": 0.2
    },
    "explore": {
      "model": "$FreeModel",
      "mode": "subagent",
      "description": "Codebase research — find files, search code, answer questions about the codebase. Read-only.",
      "temperature": 0.2
    },
    "plan": {
      "model": "$FreeModel",
      "mode": "primary",
      "description": "Planning mode — reason about architecture and designs without executing code.",
      "temperature": 0.2
    },
    "build": {
      "model": "$FreeModel",
      "mode": "subagent",
      "description": "Code scaffolding — generates code from prompts.",
      "temperature": 0.2
    }
  },
  "attachment": {
    "image": {
      "auto_resize": true,
      "max_width": 2000,
      "max_height": 2000,
      "max_base64_bytes": 5242880
    }
  },
  "experimental": {
    "disable_paste_summary": true
  },
  "server": {
    "port": 4100,
    "hostname": "0.0.0.0"
  },
  "default_agent": "delegator",
  "compaction": {
    "auto": true,
    "tail_turns": 8
  }
}
"@

Write-Host "  Writing free mode config..." -ForegroundColor Cyan
$freeConfig | Out-File -FilePath $ConfigPath -Encoding utf8 -Force

# ── Initialize submodules if needed ──
if (-not (Test-Path "$RootDir\glitch-memorycore\prompt-rules.md")) {
  Write-Host "  Initializing glitch-memorycore..." -ForegroundColor Yellow
  try {
    git submodule update --init --recursive 2>&1 | Out-Null
  } catch {
    Write-Host "  Could not initialize submodules" -ForegroundColor Red
  }
}

# ── Launch opencode ──
Write-Host ""
Write-Host "  Starting OpenCode in free mode..." -ForegroundColor Cyan
Write-Host "  Model: $FreeModel ($ModelName)" -ForegroundColor Green
Write-Host "  When you're done, exit normally and the original config will be restored."
Write-Host "  To switch free models: `$env:GLITCH_FREE_MODEL=`"opencode/mimo-v2.5-free`"" -ForegroundColor Gray
Write-Host ""

Push-Location $RootDir
try {
  & $OpenCodeBin
} catch {
  Write-Host "  OpenCode exited with error: $_" -ForegroundColor Red
} finally {
  Pop-Location
}

# ── Restore original config ──
if (Test-Path $BackupPath) {
  Write-Host ""
  Write-Host "  Restoring original opencode.json..." -ForegroundColor Yellow
  Move-Item $BackupPath $ConfigPath -Force
  Write-Host "  Original config restored." -ForegroundColor Green
}

Write-Host ""
Write-Host "Free mode ended." -ForegroundColor Green
