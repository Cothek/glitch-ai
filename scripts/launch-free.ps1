$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Split-Path -Parent $ScriptDir
$OpenCodeBin = "$RootDir\opencode\opencode.exe"
$ConfigPath = "$RootDir\opencode.json"
$BackupPath = "$RootDir\opencode.json.bak"
$PrefFile = "$RootDir\data\free-model-preference.json"
$FreeModelsFile = "$RootDir\data\free-models.json"

$ErrorActionPreference = "Continue"

# --- Hardcoded fallback models (used when free-models.json is missing/stale) ----
$FallbackModelGroups = @(
  @{
    Name = "OpenCode Zen (free tier)"
    Models = @(
      @{ ID = "opencode/deepseek-v4-flash-free"; Name = "DeepSeek V4 Flash"; Tag = "" }
      @{ ID = "opencode/qwen3.6-plus-free"; Name = "Qwen 3.6 Plus"; Tag = "" }
      @{ ID = "opencode/mimo-v2.5-free"; Name = "Mimo v2.5"; Tag = "" }
      @{ ID = "opencode/minimax-m3-free"; Name = "MiniMax M3"; Tag = "" }
      @{ ID = "opencode/nemotron-3-super-free"; Name = "Nemotron 3 Super"; Tag = "" }
      @{ ID = "opencode/big-pickle"; Name = "Big Pickle"; Tag = "" }
    )
  }
  @{
    Name = "NVIDIA (free endpoint, requires /connect)"
    Models = @(
      @{ ID = "nvidia/z-ai/glm-5.1"; Name = "GLM-5.1"; Tag = "default" }
      @{ ID = "nvidia/qwen/qwen3-coder-480b-a35b-instruct"; Name = "Qwen3-Coder 480B"; Tag = "" }
      @{ ID = "nvidia/minimaxai/minimax-m2.7"; Name = "MiniMax M2.7"; Tag = "" }
      @{ ID = "nvidia/stepfun-ai/step-3.7-flash"; Name = "Step 3.7 Flash"; Tag = "" }
      @{ ID = "nvidia/mistralai/mistral-large-3-675b-instruct-2512"; Name = "Mistral Large 3"; Tag = "" }
    )
  }
)

# --- Load model list from free-models.json (live cache) or fallback -------------
function Get-FreeModelGroups {
  param([string]$FilePath, [array]$Fallback)

  if (-not (Test-Path $FilePath)) { return $Fallback }

  try {
    $data = Get-Content $FilePath -Raw | ConvertFrom-Json

    # Check staleness: if older than 7 days, warn but still use it
    $genTime = [DateTime]::Parse($data.generated_at)
    $age = ((Get-Date) - $genTime).TotalDays

    if ($age -gt 7) {
      Write-Host " [WARN] free-models.json is $($age.ToString('F0')) days old. Run check-models.ps1 to refresh." -ForegroundColor Yellow
    }

    # Convert from cache format to the ModelGroups format
    $groups = @()
    foreach ($provider in $data.providers) {
      $group = @{
        Name = $provider.name
        Models = @()
      }
      foreach ($m in $provider.models) {
        # Mark default if it's the GLM-5.1 model
        $tag = if ($m.id -eq "nvidia/z-ai/glm-5.1") { "default" } else { "" }
        $group.Models += @{ ID = $m.id; Name = $m.name; Tag = $tag }
      }
      if ($group.Models.Count -gt 0) { $groups += $group }
    }

    if ($groups.Count -gt 0) { return $groups }
  } catch {
    Write-Host " [WARN] Could not parse free-models.json, using fallback list." -ForegroundColor Yellow
  }

  return $Fallback
}

# --- Run check-models.ps1 silently to refresh cache (if available) ---------------
if (Test-Path "$ScriptDir\check-models.ps1") {
  try {
    & "$ScriptDir\check-models.ps1" -Silent -CheckOnly 2>&1 | Out-Null
  } catch { }
}

# Load model groups (live cache > fallback)
$ModelGroups = Get-FreeModelGroups -FilePath $FreeModelsFile -Fallback $FallbackModelGroups

# Flat lookup table
$AllModels = @{}
foreach ($group in $ModelGroups) {
    foreach ($m in $group.Models) {
        $AllModels[$m.ID] = @{ Name = $m.Name; Group = $group.Name; Tag = $m.Tag }
    }
}

# --- Helper: Load preference ---------------------------------------------------
function Get-Preference {
    if (-not (Test-Path $PrefFile)) { return $null }
    try {
        $pref = Get-Content $PrefFile -Raw | ConvertFrom-Json
        if ($pref.model) { return $pref.model }
    } catch { }
    return $null
}

# --- Helper: Save preference ---------------------------------------------------
function Set-Preference($modelId) {
    $prefDir = Split-Path -Parent $PrefFile
    if (-not (Test-Path $prefDir)) { New-Item -ItemType Directory -Path $prefDir -Force | Out-Null }
    $pref = @{
        model = $modelId
        name = $AllModels[$modelId].Name
        set_at = (Get-Date).ToString("o")
    }
    $pref | ConvertTo-Json | Out-File -FilePath $PrefFile -Encoding utf8 -Force
}

# --- Determine model (priority: env var > --pick flag > preference file > menu) -
$ForcePick = $args -contains "--pick"
$FreeModel = $null

# 1. Environment variable overrides everything
if ($env:GLITCH_FREE_MODEL) {
    $FreeModel = $env:GLITCH_FREE_MODEL
    Write-Host ""
    Write-Host " Model from env var: $FreeModel" -ForegroundColor Cyan
}

# 2. If --pick flag, force interactive menu
if ($ForcePick -and -not $env:GLITCH_FREE_MODEL) {
    $FreeModel = $null  # will trigger menu below
}

# 3. Try saved preference
if (-not $FreeModel) {
    $saved = Get-Preference
    if ($saved -and $AllModels.ContainsKey($saved)) {
        $FreeModel = $saved
        Write-Host ""
        Write-Host " Model from preference: $FreeModel ($($AllModels[$saved].Name))" -ForegroundColor Cyan
        Write-Host " (run with --pick to change, or: .\scripts\switch-model.ps1)" -ForegroundColor DarkGray
    }
}

# 4. Interactive menu if no model determined yet
if (-not $FreeModel) {
    Write-Host ""
    Write-Host " Glitch Free Mode -- Model Picker" -ForegroundColor Green
    Write-Host " No saved preference. Pick a model:" -ForegroundColor DarkGray
    Write-Host ""

    $choices = @()
    $idx = 1
    foreach ($group in $ModelGroups) {
        Write-Host " $($group.Name)" -ForegroundColor Yellow
        foreach ($m in $group.Models) {
            $tagStr = if ($m.Tag) { " ($($m.Tag))" } else { "" }
            Write-Host "   [$idx] $($m.Name)$tagStr" -ForegroundColor White
            Write-Host "       $($m.ID)" -ForegroundColor DarkGray
            $choices += $m
            $idx++
        }
        Write-Host ""
    }

    $selection = Read-Host "Pick a model (1-$($choices.Count))"
    $num = 0
    if ([int]::TryParse($selection, [ref]$num) -and $num -ge 1 -and $num -le $choices.Count) {
        $FreeModel = $choices[$num - 1].ID
        # Save as preference for next time
        Set-Preference $FreeModel
        Write-Host ""
        Write-Host " Saved preference: $FreeModel ($($AllModels[$FreeModel].Name))" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host " Invalid selection. Exiting." -ForegroundColor Red
        exit 1
    }
}

# Validate model
if (-not $AllModels.ContainsKey($FreeModel)) {
    Write-Host ""
    Write-Host " ERROR: Unknown free model '$FreeModel'" -ForegroundColor Red
    Write-Host " Valid models:" -ForegroundColor Yellow
    foreach ($key in $AllModels.Keys | Sort-Object) {
        Write-Host "   $key - $($AllModels[$key].Name)" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host " Set GLITCH_FREE_MODEL, run with --pick, or use switch-model.ps1" -ForegroundColor Cyan
    exit 1
}

$ModelName = $AllModels[$FreeModel].Name

Write-Host ""
Write-Host " Glitch Free Mode" -ForegroundColor Green
Write-Host " Model: $FreeModel ($ModelName)" -ForegroundColor Cyan
Write-Host ""

# Check opencode exists
if (-not (Test-Path $OpenCodeBin)) {
    Write-Host " OpenCode not found. Run bootstrap.ps1 first." -ForegroundColor Red
    exit 1
}

# Back up current config
if (Test-Path $ConfigPath) {
    Write-Host " Backing up opencode.json -> opencode.json.bak" -ForegroundColor Yellow
    Copy-Item $ConfigPath $BackupPath -Force
}

# Generate free mode config
$freePrompt = @"
You are Glitch running in FREE MODE. All agents are using the free model `"$FreeModel`" ($ModelName).

## Free Mode Rules
1. You have FULL permissions same capabilities as normal mode.
2. ALL agents use `"$FreeModel`" there are NO paid fallback models available.
3. Premium features are generally UNAVAILABLE in OpenCode Zen free models, but some NVIDIA free endpoint models may support image/vision analysis and stronger coding capability depends on the specific model.
4. If the free model exhausts its quota, close this session and relaunch with a different model:
- Set `$env:GLITCH_FREE_MODEL to one of the valid model IDs (opencode/... or nvidia/...)
- Or run .\scripts\switch-model.ps1 to pick a new model
- Then run .\launch-glitch-free.bat again (or .\launch-glitch-free.bat --pick)
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
"description": "Free mode orchestrates tasks using only free models ($ModelName).",
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
"description": "General-purpose agent bash commands, file ops, simple edits, standard code.",
"permission": {
"read": "allow",
"edit": "allow",
"bash": "allow",
"glob": "allow",
"grep": "allow",
"list": "allow",
"webfetch": "allow",
"websearch": "deny",
"question": "allow",
"todowrite": "allow"
},
"temperature": 0.2
},
"explore": {
"model": "$FreeModel",
"mode": "subagent",
"description": "Codebase research find files, search code, answer questions about the codebase. Read-only.",
"temperature": 0.2
},
"plan": {
"model": "$FreeModel",
"mode": "primary",
"description": "Planning mode reason about architecture and designs without executing code.",
"temperature": 0.2
},
"build": {
"model": "$FreeModel",
"mode": "subagent",
"description": "Code scaffolding generates code from prompts.",
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

# Validate generated config
Write-Host " Validating generated config..." -ForegroundColor Cyan
try {
    $null = $freeConfig | ConvertFrom-Json
    Write-Host " Config is valid JSON" -ForegroundColor DarkGreen
} catch {
    Write-Host " ERROR: Generated free mode config is not valid JSON!" -ForegroundColor Red
    Write-Host " $_" -ForegroundColor Red
    if (Test-Path $BackupPath) {
        Write-Host " Restoring original config..." -ForegroundColor Yellow
        Move-Item $BackupPath $ConfigPath -Force
    }
    exit 1
}

Write-Host " Writing free mode config..." -ForegroundColor Cyan
$freeConfig | Out-File -FilePath $ConfigPath -Encoding utf8 -Force

# Initialize submodules if needed
if (-not (Test-Path "$RootDir\glitch-memorycore\prompt-rules.md")) {
    Write-Host " Initializing glitch-memorycore..." -ForegroundColor Yellow
    try {
        git submodule update --init --recursive 2>&1 | Out-Null
    } catch {
        Write-Host " Could not initialize submodules" -ForegroundColor Red
    }
}

# Launch opencode
Write-Host ""
Write-Host " Starting OpenCode in free mode..." -ForegroundColor Cyan
Write-Host " Model: $FreeModel ($ModelName)" -ForegroundColor Green
Write-Host " When done, exit normally and the original config will be restored." -ForegroundColor DarkGray
Write-Host " Switch models: .\scripts\switch-model.ps1  |  Relaunch with: .\launch-glitch-free.bat --pick" -ForegroundColor Gray
Write-Host ""

Push-Location $RootDir
try {
    & $OpenCodeBin
} catch {
    Write-Host " OpenCode exited with error: $_" -ForegroundColor Red
} finally {
    Pop-Location
}

# Restore original config
if (Test-Path $BackupPath) {
    Write-Host ""
    Write-Host " Restoring original opencode.json..." -ForegroundColor Yellow
    Move-Item $BackupPath $ConfigPath -Force
    Write-Host " Original config restored." -ForegroundColor Green
}

Write-Host ""
Write-Host "Free mode ended." -ForegroundColor Green
