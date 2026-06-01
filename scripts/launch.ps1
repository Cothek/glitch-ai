$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Split-Path -Parent $ScriptDir
$OpenCodeBin = "$RootDir\opencode\opencode.exe"
$HandyBin = "$RootDir\handy-voice\Handy\handy.exe"
$ConfigPath = "$RootDir\opencode.json"
$BackupPath = "$RootDir\opencode.json.bak"

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
      Write-Host "  Engine ready!" -ForegroundColor Green
    } else {
      Write-Host "  WARNING: Could not load engine." -ForegroundColor Yellow
      Write-Host "  Run: git submodule update --init --recursive" -ForegroundColor Yellow
    }
  } catch {
    Write-Host "  WARNING: Could not initialize submodules. Error: $_" -ForegroundColor Yellow
    Write-Host "  OpenCode may not start correctly without engine files." -ForegroundColor Yellow
  }
} else {
  Write-Host "  Engine found" -ForegroundColor DarkGreen
}

# ---- Detect leftover safe mode backup ----
if (Test-Path $BackupPath) {
  try {
    $currentConfig = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    $agentCount = @($currentConfig.agent.PSObject.Properties).Count
    $isSafeModeConfig = ($agentCount -le 1)
  } catch {
    $isSafeModeConfig = $false
  }

  if ($isSafeModeConfig) {
    Write-Host "  Detected leftover safe mode config -- restoring opencode.json.bak..." -ForegroundColor Yellow
    Copy-Item $BackupPath $ConfigPath -Force
    Write-Host "  Backup restored." -ForegroundColor Green
  } else {
    Write-Host "  Cleaning up leftover backup from previous safe mode." -ForegroundColor DarkYellow
  }
  Remove-Item $BackupPath -Force
}

# ---- User Profile Detection ----
$UserName = $env:GLITCH_USER
$UserDir = ""

if ($UserName) {
  # Explicit user via env var - check both flat and subdirectory layouts
  $UserDir = "$RootDir\user\$UserName"
  if (Test-Path "$UserDir\main-memory.md") {
    Write-Host "  User profile: $UserName" -ForegroundColor Cyan
  } elseif (Test-Path "$RootDir\user\main-memory.md") {
    # Flat layout exists, ignore explicit subdir username
    $UserName = ""  # signals flat layout
    Write-Host "  User profile: (flat - user/main-memory.md)" -ForegroundColor Cyan
  } else {
    Write-Host "  WARNING: User '$UserName' specified but no profile found at user\$UserName" -ForegroundColor Yellow
    Write-Host "  Run: .\setup.ps1 --user $UserName" -ForegroundColor Yellow
    $UserName = $null
  }
}

if (-not $UserName) {
  # Auto-detect: check flat layout first, then subdirectory layout
  $userBase = "$RootDir\user"
  if (Test-Path "$userBase\main-memory.md") {
    $UserName = ""  # flat layout - no subdirectory name
    $UserDir = $userBase
    Write-Host "  User profile: (flat - user/main-memory.md)" -ForegroundColor Cyan
  } elseif (Test-Path $userBase) {
    $profiles = Get-ChildItem -Directory $userBase | Where-Object {
      Test-Path "$($_.FullName)\main-memory.md"
    }
    if ($profiles.Count -eq 1) {
      $UserName = $profiles[0].Name
      $UserDir = $profiles[0].FullName
      Write-Host "  User profile: $UserName" -ForegroundColor Cyan
    } elseif ($profiles.Count -gt 1) {
      Write-Host "  Multiple user profiles found:" -ForegroundColor Yellow
      $i = 1
      $profileNames = @()
      foreach ($p in $profiles) {
        Write-Host "    [$i] $($p.Name)" -ForegroundColor Cyan
        $profileNames += $p.Name
        $i++
      }
      Write-Host "  Set `$env:GLITCH_USER=<name> to auto-select." -ForegroundColor Gray
      # Default to first profile
      $UserName = $profileNames[0]
      $UserDir = "$RootDir\user\$UserName"
      Write-Host "  Using: $UserName" -ForegroundColor Cyan
    }
  }
}

if (-not $UserName) {
  Write-Host "  No user profile found." -ForegroundColor Yellow
  Write-Host "  First time? Run .\setup.bat (double-click, handles everything)" -ForegroundColor Cyan
  Write-Host "  Starting with engine defaults (no user profile loaded)." -ForegroundColor DarkYellow
}

# ---- Generate runtime config with user profile ----
Write-Host "  Generating runtime config..." -ForegroundColor Cyan

# Build instruction list
$engineInstructions = @(
  "glitch-memorycore/prompt-rules.md",
  "glitch-memorycore/CLAUDE.md",
  "glitch-memorycore/master-memory.md",
  "glitch-memorycore/core/identity.md",
  "glitch-memorycore/plugins/glitch-skills/skills-registry.md"
)

$userInstructions = @()
if ($UserName -and $UserName -ne "") {
  $userInstructions = @(
    "user/$UserName/main-memory.md",
    "user/$UserName/current-session.md",
    "user/$UserName/reminders.md",
    "user/$UserName/session-dashboard.md"
  )
} elseif (Test-Path "$RootDir\user\main-memory.md") {
  $userInstructions = @(
    "user/main-memory.md",
    "user/current-session.md",
    "user/reminders.md",
    "user/session-dashboard.md"
  )
}

$allInstructions = $engineInstructions + $userInstructions

# Build instruction JSON array string (preserve escaping — never parse/re-serialize JSON)
$instrJson = ($allInstructions | ForEach-Object { "    `"$_`"" }) -join ",`n"
$instrBlock = "`"instructions`": [`n$instrJson`n  ]"

# Read base config as text, replace instructions line by regex
$baseText = Get-Content $ConfigPath -Raw
$runtimeJson = $baseText -replace '"[Ii]nstructions"\s*:\s*\[[^\]]*\]', $instrBlock

# Back up current config
Copy-Item $ConfigPath $BackupPath -Force

try {
  $null = $runtimeJson | ConvertFrom-Json  # validate
  $runtimeJson | Out-File -FilePath $ConfigPath -Encoding utf8 -Force
  Write-Host "  Runtime config generated ($($allInstructions.Count) instruction files)" -ForegroundColor DarkGreen
} catch {
  Write-Host "  ERROR: Generated config is invalid JSON!" -ForegroundColor Red
  Write-Host "  $_" -ForegroundColor Red
  if (Test-Path $BackupPath) {
    Move-Item $BackupPath $ConfigPath -Force
  }
  exit 1
}

# ---- Validate opencode.json ----
Write-Host "  Validating config..." -ForegroundColor Cyan
try {
    $configContent = Get-Content $ConfigPath -Raw
    $null = $configContent | ConvertFrom-Json
    Write-Host "  Config is valid JSON" -ForegroundColor DarkGreen
} catch {
    Write-Host "  ERROR: Config is not valid JSON!" -ForegroundColor Red
    Write-Host "  $_" -ForegroundColor Red
    if (Test-Path $BackupPath) {
      Move-Item $BackupPath $ConfigPath -Force
    }
    exit 1
}

# ---- Ensure Handy portable flag ----
$portableFlag = "$RootDir\handy-voice\Handy\portable"
if (Test-Path $HandyBin) {
  if (-not (Test-Path $portableFlag)) {
    Set-Content -Path $portableFlag -Value "" -NoNewline
  }
}

# ---- Normalize backslash paths in session DB ----
try { & "$RootDir\scripts\fix-paths.ps1" } catch { }

# ---- Check for dependency updates ----
Write-Host "  Checking dependency updates..." -ForegroundColor Cyan
try {
  $statusFile = "$RootDir\data\update-status.json"
  & "$RootDir\scripts\check-updates.ps1" -CheckOnly *>$null
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
} catch {
  Write-Host "  OpenCode exited with error: $_" -ForegroundColor Red
} finally {
  Pop-Location
}

# ---- Restore engine-only config ----
if (Test-Path $BackupPath) {
  Write-Host ""
  Write-Host "  Restoring base config..." -ForegroundColor Yellow
  Move-Item $BackupPath $ConfigPath -Force
  Write-Host "  Base config restored." -ForegroundColor Green
}

# ---- Done ----
Write-Host ""
Write-Host "Glitch session ended." -ForegroundColor Magenta
