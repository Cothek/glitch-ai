$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Split-Path -Parent $ScriptDir
$OpenCodeBin = "$RootDir\opencode\opencode.exe"
$ConfigPath = "$RootDir\opencode.json"
$TemplatePath = "$RootDir\config\opencode-free.json"
$BackupDir = "$RootDir\data\backups"
$ModeFile = "$BackupDir\.last-mode"
$PrefFile = "$RootDir\user\free-model-preference.json"
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

# --- Determine model (priority: env var > --pick flag > menu with default) -----
$ForcePick = $args -contains "--pick"
$FreeModel = $null

# 1. Environment variable overrides everything (no menu)
if ($env:GLITCH_FREE_MODEL) {
    $FreeModel = $env:GLITCH_FREE_MODEL
    Write-Host ""
    Write-Host " Model from env var: $FreeModel" -ForegroundColor Cyan
}

# 2. If --pick flag, force interactive menu (ignore saved preference)
if ($ForcePick -and -not $env:GLITCH_FREE_MODEL) {
    $FreeModel = $null
}

# 3. If no model yet, show interactive menu (with saved preference as default)
if (-not $FreeModel) {
    $saved = Get-Preference
    $hasDefault = $saved -and $AllModels.ContainsKey($saved)

    Write-Host ""
    Write-Host " Glitch Free Mode -- Model Picker" -ForegroundColor Green
    if ($hasDefault) {
        Write-Host " Current: $saved ($($AllModels[$saved].Name))" -ForegroundColor Cyan
        Write-Host " Press Enter to keep current, or pick a number:" -ForegroundColor DarkGray
    } else {
        Write-Host " No saved preference. Pick a model:" -ForegroundColor DarkGray
    }
    Write-Host ""

    $choices = @()
    $idx = 1
    foreach ($group in $ModelGroups) {
        Write-Host " $($group.Name)" -ForegroundColor Yellow
        foreach ($m in $group.Models) {
            $marker = if ($m.ID -eq $saved) { " *" } else { "" }
            $tagStr = if ($m.Tag) { " ($($m.Tag))" } else { "" }
            Write-Host "   [$idx] $($m.Name)$tagStr$marker" -ForegroundColor $(if ($m.ID -eq $saved) { "Green" } else { "White" })
            Write-Host "       $($m.ID)" -ForegroundColor DarkGray
            $choices += $m
            $idx++
        }
        Write-Host ""
    }

    $selection = Read-Host "Pick a model (1-$($choices.Count), or Enter for current)"
    $num = 0

    if ([string]::IsNullOrWhiteSpace($selection) -and $hasDefault) {
        # Enter with no selection -- keep current preference
        $FreeModel = $saved
        Write-Host ""
        Write-Host " Keeping current: $FreeModel ($($AllModels[$FreeModel].Name))" -ForegroundColor Green
    } elseif ([int]::TryParse($selection, [ref]$num) -and $num -ge 1 -and $num -le $choices.Count) {
        $FreeModel = $choices[$num - 1].ID
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

# Backup previous config (timestamped, never overwritten)
if (Test-Path $ConfigPath) {
    if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null }
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupFile = "$BackupDir\opencode-$timestamp.json"
    Copy-Item $ConfigPath $backupFile -Force
    Write-Host "  Previous config backed up -> data\backups\opencode-$timestamp.json" -ForegroundColor DarkGray
}

# Check template exists
if (-not (Test-Path $TemplatePath)) {
    Write-Host "  ERROR: Free mode template not found at config\opencode-free.json" -ForegroundColor Red
    exit 1
}

# Build the free mode prompt
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

# Read template, replace placeholders
$templateText = Get-Content $TemplatePath -Raw
$configWithModel = $templateText.Replace('__MODEL__', $FreeModel)
$escapedPrompt = $freePrompt.Replace('\', '\\').Replace('"', '\"').Replace("`n", '\n').Replace("`r", '')
$finalConfig = $configWithModel.Replace('__PROMPT__', $escapedPrompt)

# Validate
try {
    $null = $finalConfig | ConvertFrom-Json
    Write-Host "  Free mode config is valid JSON" -ForegroundColor DarkGreen
} catch {
    Write-Host "  ERROR: Generated free mode config is invalid JSON!" -ForegroundColor Red
    Write-Host "  $_" -ForegroundColor Red
    exit 1
}

# Write config
Write-Host "  Writing free mode config..." -ForegroundColor Cyan
$finalConfig | Out-File -FilePath $ConfigPath -Encoding utf8 -Force

# ---- Write mode marker ----
$modeInfo = @{
    mode = "free"
    timestamp = (Get-Date).ToString("o")
    model = $FreeModel
} | ConvertTo-Json
$modeInfo | Out-File -FilePath $ModeFile -Encoding utf8 -Force

# Initialize submodules if needed
if (-not (Test-Path "$RootDir\glitch-memorycore\prompt-rules.md")) {
    Write-Host " Initializing glitch-memorycore..." -ForegroundColor Yellow
    try {
        git submodule update --init --recursive 2>&1 | Out-Null
    } catch {
        Write-Host " Could not initialize submodules" -ForegroundColor Red
    }
}

# ---- Check for dependency updates & offer interactive update ----
Write-Host "  Checking dependency updates..." -ForegroundColor Cyan
try {
    $statusFile = "$RootDir\data\update-status.json"
    & "$RootDir\scripts\check-updates.ps1" -CheckOnly *>$null
    if (Test-Path $statusFile) {
        $status = Get-Content $statusFile -Raw | ConvertFrom-Json
        if ($status.updates_available -gt 0) {
            Write-Host ""
            Write-Host "  ===== Updates Available =====" -ForegroundColor Yellow
            $updateItems = $status.items | Where-Object { $_.update_available }

            $i = 1
            foreach ($item in $updateItems) {
                Write-Host "  [$i] $($item.name)" -ForegroundColor Cyan
                Write-Host "      $($item.current) -> $($item.latest)" -ForegroundColor DarkYellow
                $i++
            }

            Write-Host ""
            Write-Host "  Enter numbers to select (e.g. '1,3')," -ForegroundColor White
            Write-Host "  press Enter to apply all, or type 's' to skip:" -ForegroundColor White
            $selection = Read-Host "  > "

            if ($selection.Trim().ToLower() -eq "s") {
                Write-Host "  Skipping updates." -ForegroundColor DarkYellow
            } else {
                $selectedNames = @()
                if (-not [string]::IsNullOrWhiteSpace($selection)) {
                    $indices = $selection.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d+$' }
                    foreach ($idx in $indices) {
                        $num = [int]$idx - 1
                        if ($num -ge 0 -and $num -lt $updateItems.Count) {
                            $selectedNames += $updateItems[$num].name
                        }
                    }
                }

                if ($selectedNames.Count -gt 0) {
                    Write-Host "  Applying selected updates..." -ForegroundColor Cyan
                    & "$RootDir\scripts\check-updates.ps1" -Update -Filter $selectedNames
                } else {
                    Write-Host "  Applying all updates..." -ForegroundColor Cyan
                    & "$RootDir\scripts\check-updates.ps1" -Update
                }
                Write-Host "  Updates complete." -ForegroundColor Green
            }
        } else {
            Write-Host "  All dependencies up-to-date" -ForegroundColor DarkGreen
        }
    }
} catch {
    Write-Host "  Update check skipped (non-critical): $_" -ForegroundColor DarkYellow
}

# ---- Check for new models ----
try {
    $modelStatusFile = "$RootDir\data\model-update-status.json"
    & "$RootDir\scripts\check-models.ps1" -CheckOnly *>$null
    if (Test-Path $modelStatusFile) {
        $modelStatus = Get-Content $modelStatusFile -Raw | ConvertFrom-Json
        if ($modelStatus.new_models_count -gt 0) {
            Write-Host "  $($modelStatus.new_models_count) new model(s) available" -ForegroundColor Yellow
            foreach ($nm in $modelStatus.new_models) {
                Write-Host "    + $($nm.model)" -ForegroundColor Green
            }
            if ($modelStatus.related_to_current_agents.Count -gt 0) {
                Write-Host "  (some may be relevant to current agents -- check session brief)" -ForegroundColor DarkYellow
            }
        } else {
            Write-Host "  Models up-to-date" -ForegroundColor DarkGreen
        }
    }
} catch {
    Write-Host "  Model check skipped (non-critical): $_" -ForegroundColor DarkYellow
}

# ---- Sync user memory data from private repo ----
$userDir = "$RootDir\user"
if (Test-Path "$userDir\.git") {
  try {
    Push-Location $userDir
    $null = & "git" "fetch" "origin" "main" 2>&1
    $behindRaw = & "git" "rev-list" "--count" "HEAD..origin/main" 2>&1
    $behindInt = 0
    if ($behindRaw -match '^\d+$') { $behindInt = [int]$behindRaw.Trim() }

    if ($behindInt -gt 0) {
      $dirtyRaw = & "git" "status" "--porcelain" 2>&1
      $dirtyCount = ($dirtyRaw | Where-Object { $_ -match '.' }).Count
      if ($dirtyCount -eq 0) {
        Write-Host "  Syncing user data ($behindInt commit(s) behind)..." -ForegroundColor Cyan
        $null = & "git" "pull" "origin" "main" 2>&1
        Write-Host "  User data synced" -ForegroundColor Green
      } else {
        Write-Host "  User data: $behindInt commit(s) behind, but working tree has $dirtyCount dirty file(s)" -ForegroundColor Yellow
        Write-Host "  Run '.\scripts\sync-user.ps1 -Pull' manually or commit changes first." -ForegroundColor Yellow
      }
    }
    Pop-Location
  } catch {
    Write-Host "  User data sync skipped (non-critical): $_" -ForegroundColor DarkYellow
    try { Pop-Location } catch {}
  }
}

# ---- Auto-sync local opencode binary ----
try {
    $npmRoot = & "npm" "root" "-g" 2>$null
    if ($npmRoot) {
        $globalBin = Join-Path ($npmRoot.Trim()) "opencode-ai\bin\opencode.exe"
        if ((Test-Path $globalBin) -and (Test-Path $OpenCodeBin)) {
            $globalVer = (& $globalBin "--version" 2>$null)
            $localVer = (& $OpenCodeBin "--version" 2>$null)
            if ($globalVer -and $localVer -and ($localVer.Trim() -ne $globalVer.Trim())) {
                Write-Host "  Syncing local opencode.exe ($($localVer.Trim()) -> $($globalVer.Trim()))..." -ForegroundColor Cyan
                Copy-Item -Path $globalBin -Destination $OpenCodeBin -Force
                Write-Host "  Done." -ForegroundColor Green
            }
        }
    }
} catch {
    Write-Host "  WARNING: Binary sync failed: $_" -ForegroundColor Yellow
}

# Launch opencode
Write-Host ""
Write-Host " Starting OpenCode in free mode..." -ForegroundColor Cyan
Write-Host " Model: $FreeModel ($ModelName)" -ForegroundColor Green
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

Write-Host ""
Write-Host "Free mode ended." -ForegroundColor Green
