$RootDir = Split-Path -Parent $PSCommandPath
$OpenCodeBin = "$RootDir\opencode\opencode.exe"
$HandyBin = "$RootDir\handy-voice\Handy\handy.exe"

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host " Glitch AI - Launching..." -ForegroundColor Magenta
Write-Host ""

# ---- Check prerequisites ----
if (-not (Test-Path $OpenCodeBin)) {
  Write-Host "OpenCode not found. Run bootstrap.ps1 first." -ForegroundColor Red
  Write-Host "Or run: powershell -File bootstrap.ps1" -ForegroundColor Yellow
  exit 1
}

# ---- Self-heal: initialize git submodules if needed ----
if (-not (Test-Path "$RootDir\glitch-memorycore\prompt-rules.md")) {
  Write-Host "  Initializing glitch-memorycore submodule..." -ForegroundColor Cyan
  try {
    git submodule update --init --recursive 2>&1 | Out-Null
    if (Test-Path "$RootDir\glitch-memorycore\prompt-rules.md") {
      Write-Host "  glitch-memorycore ready!" -ForegroundColor Green
    } else {
      Write-Host "  WARNING: Could not load glitch-memorycore." -ForegroundColor Yellow
      Write-Host "  Run: git submodule update --init --recursive" -ForegroundColor Yellow
    }
  } catch {
    Write-Host "  WARNING: Could not initialize submodules. Error: $_" -ForegroundColor Yellow
    Write-Host "  OpenCode may not start correctly without memory files." -ForegroundColor Yellow
  }
} else {
  Write-Host "  glitch-memorycore found" -ForegroundColor DarkGreen
}

# ---- Detect leftover safe mode backup ----
$BackupPath = "$RootDir\opencode.json.bak"
if (Test-Path $BackupPath) {
  try {
    $currentConfig = Get-Content "$RootDir\opencode.json" -Raw | ConvertFrom-Json
    $agentCount = @($currentConfig.agent.PSObject.Properties).Count
    $isSafeModeConfig = ($agentCount -le 1)
  } catch {
    $isSafeModeConfig = $false
  }

  if ($isSafeModeConfig) {
    Write-Host "  Detected leftover safe mode config -- restoring opencode.json.bak..." -ForegroundColor Yellow
    Copy-Item $BackupPath "$RootDir\opencode.json" -Force
    Write-Host "  Backup restored." -ForegroundColor Green
  } else {
    Write-Host "  Cleaning up leftover backup from previous safe mode." -ForegroundColor DarkYellow
  }
  Remove-Item $BackupPath -Force
}

# ---- Ensure Handy portable flag ----
$portableFlag = "$RootDir\handy-voice\Handy\portable"
if (Test-Path $HandyBin) {
  if (-not (Test-Path $portableFlag)) {
    Set-Content -Path $portableFlag -Value "" -NoNewline
  }
}

# ---- Normalize backslash paths in session DB ----
try { & "$RootDir\fix-paths.ps1" } catch { }

# ---- Validate opencode.json before launch ----
Write-Host "  Validating opencode.json..." -ForegroundColor Cyan
try {
    $configContent = Get-Content "$RootDir\opencode.json" -Raw
    $null = $configContent | ConvertFrom-Json
    Write-Host "  Config is valid JSON" -ForegroundColor DarkGreen
} catch {
    Write-Host "  ERROR: opencode.json is not valid JSON!" -ForegroundColor Red
    Write-Host "  $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Launch was cancelled to prevent a crash." -ForegroundColor Yellow
    Write-Host "  Fix the config or run launch-glitch-safe.bat to enter safe mode." -ForegroundColor Yellow
    exit 1
}

# ---- Check for dependency updates ----
Write-Host "  Checking dependency updates..." -ForegroundColor Cyan
try {
  $statusFile = "$RootDir\update-status.json"
  & "$RootDir\check-updates.ps1" -CheckOnly *>$null
  if (Test-Path $statusFile) {
    $status = Get-Content $statusFile -Raw | ConvertFrom-Json
    if ($status.updates_available -gt 0) {
      Write-Host "  $($status.updates_available) update(s) available -- run .\check-updates.ps1 -Update" -ForegroundColor Yellow
    } else {
      Write-Host "  All dependencies up-to-date" -ForegroundColor DarkGreen
    }
  }
} catch {
  Write-Host "  Update check skipped (non-critical): $_" -ForegroundColor DarkYellow
}

# ---- Check for new models ----
try {
  $modelStatusFile = "$RootDir\model-update-status.json"
  & "$RootDir\check-models.ps1" -CheckOnly *>$null
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

# ---- Start Handy (if not already running) ----
$handyProcess = Get-Process -Name "handy" -ErrorAction SilentlyContinue
if (-not $handyProcess) {
  if (Test-Path $HandyBin) {
    Write-Host "  Starting Handy voice input..." -ForegroundColor Cyan
    Start-Process -FilePath $HandyBin -WindowStyle Minimized
    Start-Sleep -Seconds 1
  } else {
    Write-Host "  Handy not found (optional). Voice input disabled." -ForegroundColor DarkYellow
  }
} else {
  Write-Host "  Handy already running" -ForegroundColor DarkGreen
}

# ---- Launch OpenCode ----
Write-Host "  Starting OpenCode..." -ForegroundColor Cyan
Write-Host ""

Push-Location $RootDir
try {
  & $OpenCodeBin
} finally {
  Pop-Location
}

# ---- Done ----
Write-Host ""
Write-Host "Glitch session ended." -ForegroundColor Magenta