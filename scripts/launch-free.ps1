$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Split-Path -Parent $ScriptDir
$OpenCodeBin = "$RootDir\opencode\opencode.exe"
$ConfigPath = "$RootDir\opencode.json"
$BackupPath = "$RootDir\opencode.json.bak"

$ErrorActionPreference = "Continue"

#  Known free models  (OpenCode Zen + NVIDIA free endpoints)
#  NVIDIA models require connecting NVIDIA as a provider first via /connect
$FreeModels = @{
  "opencode/deepseek-v4-flash-free"                = "DeepSeek V4 Flash Free"
  "opencode/mimo-v2.5-free"                        = "Mimo v2.5 Free"
  "opencode/nemotron-3-super-free"                 = "Nemotron 3 Super Free"
  "opencode/big-pickle"                            = "Big Pickle"
  "opencode/qwen3.6-plus-free"                     = "Qwen 3.6 Plus Free"
  "opencode/minimax-m3-free"                       = "MiniMax M3 Free"
  "nvidia/qwen/qwen3-coder-480b-a35b-instruct"     = "NVIDIA Qwen3-Coder 480B"
  "nvidia/minimaxai/minimax-m2.7"                  = "NVIDIA MiniMax M2.7"
  "nvidia/z-ai/glm-5.1"                            = "NVIDIA GLM-5.1"
  "nvidia/stepfun-ai/step-3.7-flash"               = "NVIDIA Step 3.7 Flash"
  "nvidia/mistralai/mistral-large-3-675b-instruct-2512" = "NVIDIA Mistral Large 3"
}

#  Determine model 
$FreeModel = $env:GLITCH_FREE_MODEL
if (-not $FreeModel) {
  $FreeModel = "opencode/deepseek-v4-flash-free"
}

if (-not $FreeModels.ContainsKey($FreeModel)) {
  Write-Host ""
  Write-Host "ERROR: Unknown free model '$FreeModel'" -ForegroundColor Red
  Write-Host "Valid models:" -ForegroundColor Yellow
  foreach ($key in $FreeModels.Keys | Sort-Object) {
    Write-Host "  $key  - $($FreeModels[$key])" -ForegroundColor Yellow
  }
  Write-Host ""
  Write-Host "Set GLITCH_FREE_MODEL env var to one of the above, or unset to use default." -ForegroundColor Cyan
  Write-Host ""
  Write-Host "  `$env:GLITCH_FREE_MODEL=`"opencode/mimo-v2.5-free`"" -ForegroundColor Gray
  Write-Host "  `$env:GLITCH_FREE_MODEL=`"nvidia/qwen/qwen3-coder-480b-a35b-instruct`"" -ForegroundColor Gray
  Write-Host "  .\launch-glitch-free.bat" -ForegroundColor Gray
  Write-Host ""
  Write-Host "NOTE: NVIDIA models require connecting NVIDIA provider first:" -ForegroundColor Yellow
  Write-Host "  In TUI: run /connect, select NVIDIA, paste your nvapi-... key" -ForegroundColor Yellow
  exit 1
}

$ModelName = $FreeModels[$FreeModel]

Write-Host ""
Write-Host " Glitch Free Mode" -ForegroundColor Green
Write-Host "  Model: $FreeModel ($ModelName)" -ForegroundColor Cyan
Write-Host ""

#  Check opencode exists 
if (-not (Test-Path $OpenCodeBin)) {
  Write-Host "OpenCode not found. Run bootstrap.ps1 first." -ForegroundColor Red
  exit 1
}

#  Back up current config 
if (Test-Path $ConfigPath) {
  Write-Host "  Backing up opencode.json -> opencode.json.bak" -ForegroundColor Yellow
  Copy-Item $ConfigPath $BackupPath -Force
}

#  Generate free mode config 
$freePrompt = @"
You are Glitch running in FREE MODE. All agents are using the free model `"$FreeModel`" ($ModelName).

## Free Mode Rules
1. You have FULL permissions  same capabilities as normal mode.
2. ALL agents use `"$FreeModel`"  there are NO paid fallback models available.
3. Premium features are generally UNAVAILABLE in OpenCode Zen free models, but some NVIDIA free endpoint models may support image/vision analysis and stronger coding  capability depends on the specific model.
4. If the free model exhausts its quota, close this session and relaunch with a different model:
   - Set `$env:GLITCH_FREE_MODEL to one of the valid model IDs (opencode/... or nvidia/...)
   - Then run .\launch-glitch-free.bat again
5. Tell the user which model is active on session start so they know what to expect.
6. NVIDIA models require NVIDIA provider to be connected via /connect in the TUI first.

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
    "glitch-memorycore/master-memory.md",
    "glitch-memorycore/core/identity.md",
    "glitch-memorycore/plugins/glitch-skills/skills-registry.md",
    "user/main-memory.md",
    "user/current-session.md",
    "user/reminders.md",
    "user/session-dashboard.md"
  ],
  "agent": {
    "delegator": {
      "model": "$FreeModel",
      "mode": "primary",
      "description": "Free mode  orchestrates tasks using only free models ($ModelName).",
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
      "description": "General-purpose agent  bash commands, file ops, simple edits, standard code.",
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
      "description": "Codebase research  find files, search code, answer questions about the codebase. Read-only.",
      "temperature": 0.2
    },
    "plan": {
      "model": "$FreeModel",
      "mode": "primary",
      "description": "Planning mode  reason about architecture and designs without executing code.",
      "temperature": 0.2
    },
    "build": {
      "model": "$FreeModel",
      "mode": "subagent",
      "description": "Code scaffolding  generates code from prompts.",
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

#  Validate generated config 
Write-Host "  Validating generated config..." -ForegroundColor Cyan
try {
    $null = $freeConfig | ConvertFrom-Json
    Write-Host "  Config is valid JSON" -ForegroundColor DarkGreen
} catch {
    Write-Host "  ERROR: Generated free mode config is not valid JSON!" -ForegroundColor Red
    Write-Host "  $_" -ForegroundColor Red
    if (Test-Path $BackupPath) {
        Write-Host "  Restoring original config..." -ForegroundColor Yellow
        Move-Item $BackupPath $ConfigPath -Force
    }
    exit 1
}

Write-Host "  Writing free mode config..." -ForegroundColor Cyan
$freeConfig | Out-File -FilePath $ConfigPath -Encoding utf8 -Force

#  Initialize submodules if needed 
if (-not (Test-Path "$RootDir\glitch-memorycore\prompt-rules.md")) {
  Write-Host "  Initializing glitch-memorycore..." -ForegroundColor Yellow
  try {
    git submodule update --init --recursive 2>&1 | Out-Null
  } catch {
    Write-Host "  Could not initialize submodules" -ForegroundColor Red
  }
}

#  Launch opencode 
Write-Host ""
Write-Host "  Starting OpenCode in free mode..." -ForegroundColor Cyan
Write-Host "  Model: $FreeModel ($ModelName)" -ForegroundColor Green
Write-Host "  When you're done, exit normally and the original config will be restored."
  Write-Host "  To switch free models: `$env:GLITCH_FREE_MODEL=`"opencode/mimo-v2.5-free`"  or  `"nvidia/qwen/qwen3-coder-480b-a35b-instruct`"" -ForegroundColor Gray
Write-Host ""

Push-Location $RootDir
try {
  & $OpenCodeBin
} catch {
  Write-Host "  OpenCode exited with error: $_" -ForegroundColor Red
} finally {
  Pop-Location
}

#  Restore original config 
if (Test-Path $BackupPath) {
  Write-Host ""
  Write-Host "  Restoring original opencode.json..." -ForegroundColor Yellow
  Move-Item $BackupPath $ConfigPath -Force
  Write-Host "  Original config restored." -ForegroundColor Green
}

Write-Host ""
Write-Host "Free mode ended." -ForegroundColor Green
