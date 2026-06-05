$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Split-Path -Parent $ScriptDir
$OpenCodeBin = "$RootDir\opencode\opencode.exe"
$HandyBin = "$RootDir\handy-voice\Handy\handy.exe"
$ConfigPath = "$RootDir\opencode.json"
$TemplatePath = "$RootDir\config\opencode-normal.json"
$BackupDir = "$RootDir\data\backups"
$ModeFile = "$BackupDir\.last-mode"

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host " Glitch AI - Normal Mode" -ForegroundColor Magenta
Write-Host ""

# ---- Auto-bootstrap: download OpenCode if missing ----
if (-not (Test-Path $OpenCodeBin)) {
  Write-Host "  OpenCode not found. Running bootstrap to download..." -ForegroundColor Yellow
  try {
    & "$RootDir\scripts\bootstrap.ps1"
    if (-not (Test-Path $OpenCodeBin)) {
      Write-Host "  ERROR: Bootstrap finished but OpenCode still not found." -ForegroundColor Red
      Write-Host "  Try running manually: .\scripts\bootstrap.ps1" -ForegroundColor Yellow
      exit 1
    }
    Write-Host "  OpenCode downloaded successfully." -ForegroundColor Green
  } catch {
    Write-Host "  ERROR: Bootstrap failed: $_" -ForegroundColor Red
    Write-Host "  Try running manually: .\scripts\bootstrap.ps1" -ForegroundColor Yellow
    exit 1
  }
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

# ---- Timestamped backup (preserved, never overwritten) ----
if (Test-Path $ConfigPath) {
  if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null }
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupFile = "$BackupDir\opencode-$timestamp.json"
  Copy-Item $ConfigPath $backupFile -Force
  Write-Host "  Previous config backed up -> data\backups\opencode-$timestamp.json" -ForegroundColor DarkGray
}

# ---- Check template exists ----
if (-not (Test-Path $TemplatePath)) {
  Write-Host "  ERROR: Normal mode template not found at config\opencode-normal.json" -ForegroundColor Red
  Write-Host "  Try launching with launch-glitch-safe.bat to repair." -ForegroundColor Yellow
  exit 1
}

# ---- User Profile Detection ----
$UserName = $env:GLITCH_USER
$UserDir = ""
$userFound = $false

if ($UserName) {
  # Explicit user via env var -- check both flat and subdirectory layouts
  $UserDir = "$RootDir\user\$UserName"
  if (Test-Path "$UserDir\main-memory.md") {
    $userFound = $true
    Write-Host "  User profile: $UserName" -ForegroundColor Cyan
  } elseif (Test-Path "$RootDir\user\main-memory.md") {
    # Flat layout exists, ignore explicit subdir username
    $UserName = ""  # signals flat layout
    $UserDir = "$RootDir\user"
    $userFound = $true
    Write-Host "  User profile: (flat -- user/main-memory.md)" -ForegroundColor Cyan
  } else {
    Write-Host "  WARNING: User '$UserName' specified but no profile found at user\$UserName" -ForegroundColor Yellow
    Write-Host "  Run: .\setup.ps1 --user $UserName" -ForegroundColor Yellow
    $UserName = $null
  }
}

if (-not $userFound) {
  # Auto-detect: check flat layout first, then subdirectory layout
  $userBase = "$RootDir\user"
  if (Test-Path "$userBase\main-memory.md") {
    $UserName = ""  # flat layout -- no subdirectory name
    $UserDir = $userBase
    $userFound = $true
    Write-Host "  User profile: (flat -- user/main-memory.md)" -ForegroundColor Cyan
  } elseif (Test-Path $userBase) {
    $profiles = Get-ChildItem -Directory $userBase | Where-Object {
      Test-Path "$($_.FullName)\main-memory.md"
    }
    if ($profiles.Count -eq 1) {
      $UserName = $profiles[0].Name
      $UserDir = $profiles[0].FullName
      $userFound = $true
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
      $userFound = $true
      Write-Host "  Using: $UserName" -ForegroundColor Cyan
    }
  }
}

if (-not $userFound) {
  Write-Host "  No user profile found." -ForegroundColor Yellow
  Write-Host "  First time? Run .\setup.bat (double-click, handles everything)" -ForegroundColor Cyan
  Write-Host "  Starting with engine defaults (no user profile loaded)." -ForegroundColor DarkYellow
}

# ---- Generate runtime config from template ----
Write-Host "  Generating runtime config from template..." -ForegroundColor Cyan

# Read template
$templateText = Get-Content $TemplatePath -Raw

# Build instruction list (engine files + user files)
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

# Build instruction JSON array string
$instrJson = ($allInstructions | ForEach-Object { "    `"$_`"" }) -join ",`n"
$instrBlock = "`"instructions`": [`n$instrJson`n  ]"

# Inject user instructions into template (replace the engine-only instructions array)
$runtimeJson = $templateText -replace '"[Ii]nstructions"\s*:\s*\[[^\]]*\]', $instrBlock

# Validate and write
try {
  $null = $runtimeJson | ConvertFrom-Json
  $runtimeJson | Out-File -FilePath $ConfigPath -Encoding utf8 -Force
  Write-Host "  Config written ($($allInstructions.Count) instruction files)" -ForegroundColor DarkGreen
} catch {
  Write-Host "  ERROR: Generated config is invalid JSON!" -ForegroundColor Red
  Write-Host "  $_" -ForegroundColor Red
  exit 1
}

# ---- Write mode marker ----
$modeInfo = @{
  mode = "normal"
  timestamp = (Get-Date).ToString("o")
  model = "opencode-go/deepseek-v4-flash"
} | ConvertTo-Json
$modeInfo | Out-File -FilePath $ModeFile -Encoding utf8 -Force

# ---- Ensure Handy portable flag ----
$portableFlag = "$RootDir\handy-voice\Handy\portable"
if (Test-Path $HandyBin) {
  if (-not (Test-Path $portableFlag)) {
    Set-Content -Path $portableFlag -Value "" -NoNewline
  }
}

# ---- Normalize backslash paths in session DB ----
try { & "$RootDir\scripts\fix-paths.ps1" } catch { }

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

# ---- Done ----
Write-Host ""
Write-Host "Glitch session ended." -ForegroundColor Magenta
