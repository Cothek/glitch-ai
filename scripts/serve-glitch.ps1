$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Split-Path -Parent $ScriptDir
$OpenCodeBin = "$RootDir\opencode\opencode.exe"
$Cloudflared = "$RootDir\cloudflared.exe"
$ConfigPath = "$RootDir\opencode.json"
$TemplatePath = "$RootDir\config\opencode-normal.json"
$BackupDir = "$RootDir\data\backups"
$ModeFile = "$BackupDir\.last-mode"

Write-Host ""
Write-Host "Glitch AI - Server Mode" -ForegroundColor Magenta
Write-Host ""

$TargetPort = 4102
$AuthProxyPort = 4100

# ---- Load .env if present ----
$envFile = "$RootDir\.env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)\s*$') {
      $key = $matches[1].Trim()
      $val = $matches[2].Trim().Trim('"', "'")
      Set-Item -Path "env:$key" -Value $val
    }
  }
  Write-Host "  Loaded .env config" -ForegroundColor Green
}

# Check prerequisites
if (-not (Test-Path $OpenCodeBin)) {
  Write-Host "OpenCode not found. Run bootstrap.ps1 first." -ForegroundColor Red
  exit 1
}

# Normalize backslash paths in session DB
& "$RootDir\scripts\fix-paths.ps1"

# Check port availability (zombie socket prevention)
try {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $r = $tcp.BeginConnect('127.0.0.1', $TargetPort, $null, $null)
  $w = $r.AsyncWaitHandle.WaitOne(500)
  if ($tcp.Connected) {
    $tcp.Close()
    Write-Host "  ERROR: Port $TargetPort is in use (likely orphan TCP socket from previous crash)." -ForegroundColor Red
    Write-Host "  Fix: Run PowerShell as Admin and execute: net stop winnat; net start winnat" -ForegroundColor Yellow
    exit 1
  }
  $tcp.Close()
} catch {}
Write-Host "  Port $TargetPort is free" -ForegroundColor Cyan

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
  Write-Host "  Try running .\scripts\launch-safe.ps1 to repair." -ForegroundColor Yellow
  exit 1
}

# ---- User Profile Detection ----
$UserName = $env:GLITCH_USER
$UserDir = ""
$userFound = $false
$userBase = "$RootDir\user"

if (-not $userFound) {
  # Auto-detect: check flat layout first, then subdirectory layout
  if (Test-Path "$userBase\main-memory.md") {
    $UserName = ""  # flat layout — no subdirectory name
    $UserDir = $userBase
    $userFound = $true
    Write-Host "  User profile: (flat — user/main-memory.md)" -ForegroundColor Cyan
  } elseif (Test-Path $userBase) {
    $profiles = Get-ChildItem -Directory $userBase | Where-Object {
      Test-Path "$($_.FullName)\main-memory.md"
    }
    if ($profiles.Count -ge 1) {
      $UserName = $profiles[0].Name
      $UserDir = $profiles[0].FullName
      $userFound = $true
      Write-Host "  User profile: $UserName" -ForegroundColor Cyan
    }
  }
}

# ---- Generate runtime config from template ----
Write-Host "  Generating runtime config..." -ForegroundColor Cyan

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
$instrJson = ($allInstructions | ForEach-Object { "    `"$_`"" }) -join ",`n"
$instrBlock = "`"instructions`": [`n$instrJson`n  ]"

# Read template and inject user instructions
$templateText = Get-Content $TemplatePath -Raw
$runtimeJson = $templateText -replace '"[Ii]nstructions"\s*:\s*\[[^\]]*\]', $instrBlock

try {
  $null = $runtimeJson | ConvertFrom-Json
  $runtimeJson | Out-File -FilePath $ConfigPath -Encoding utf8 -Force
  Write-Host "  Config generated from template" -ForegroundColor DarkGreen
} catch {
  Write-Host "  ERROR: Generated config is invalid JSON!" -ForegroundColor Red
  exit 1
}

# Write mode marker
$modeInfo = @{
    mode = "normal"
    timestamp = (Get-Date).ToString("o")
    model = "opencode-go/deepseek-v4-flash"
} | ConvertTo-Json
$modeInfo | Out-File -FilePath $ModeFile -Encoding utf8 -Force

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

# ---- Cloudflare Tunnel status ----
$cloudflareOk = $false
$cloudflareDomain = $env:GLITCH_DOMAIN
if (Test-Path $Cloudflared) {
  $tunnelConfig = "$RootDir\config\cloudflared-config.yml"
  if (Test-Path $tunnelConfig) {
    $cloudflareOk = $true
    if ($cloudflareDomain) {
      Write-Host "  Cloudflare Tunnel: $cloudflareDomain" -ForegroundColor Green
    } else {
      Write-Host "  Cloudflare Tunnel: configured" -ForegroundColor Green
    }
  } else {
    Write-Host "  Cloudflare Tunnel: not configured. Run setup-tunnel.ps1 first." -ForegroundColor Yellow
  }
} else {
  Write-Host "  Cloudflare Tunnel: cloudflared.exe not found" -ForegroundColor Yellow
}

# ---- Start Cloudflare Tunnel ----
if ($cloudflareOk) {
  Write-Host "  Starting Cloudflare Tunnel..." -ForegroundColor Cyan
  $cloudflaredProcess = Start-Process -NoNewWindow -FilePath $Cloudflared -ArgumentList "tunnel", "--config", "`"$RootDir\config\cloudflared-config.yml`"", "run" -PassThru
  Start-Sleep -Seconds 2
  if ($cloudflareDomain) {
    Write-Host "  Tunnel running: https://$cloudflareDomain" -ForegroundColor Green
  }
}

# ---- Handy ----
$HandyBin = "$RootDir\handy-voice\Handy\handy.exe"
$handyProcess = Get-Process -Name "handy" -ErrorAction SilentlyContinue
if (-not $handyProcess -and (Test-Path $HandyBin)) {
  Write-Host "  Starting Handy voice input..." -ForegroundColor Cyan
  Start-Process -FilePath $HandyBin -WindowStyle Minimized
  Start-Sleep -Seconds 1
} elseif ($handyProcess) {
  Write-Host "  Handy already running" -ForegroundColor DarkGreen
}

# ---- Auth Proxy (adds Basic Auth for transparent mobile auth) ----
Write-Host "  Starting auth proxy (port $AuthProxyPort -> $TargetPort)..." -ForegroundColor Cyan
$proxyProcess = Start-Process -NoNewWindow -FilePath "node" -ArgumentList "`"$RootDir\plugins\auth-proxy.mjs`"", "$AuthProxyPort", "http://localhost:$TargetPort" -PassThru
Start-Sleep -Seconds 1

# ---- Password (ACL-locked file, current user only) ----
$pwFile = "$RootDir\.server-password"
$pw = $env:OPENCODE_SERVER_PASSWORD
if (-not $pw) {
  if (-not (Test-Path $pwFile)) {
    $pw = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 16 | ForEach-Object { [char]$_ })
    Set-Content -Path $pwFile -Value $pw -NoNewline
  } else {
    $pw = Get-Content $pwFile -Raw | ForEach-Object { $_.Trim() }
  }
  & icacls $pwFile /inheritance:r /grant "${env:USERNAME}:R" 2>&1 | Out-Null
  $env:OPENCODE_SERVER_PASSWORD = $pw
}

Write-Host ""
Write-Host "  Server password: $pw" -ForegroundColor Yellow
Write-Host "  Username: opencode" -ForegroundColor Yellow
$authBytes = [System.Text.Encoding]::UTF8.GetBytes("opencode:$pw")
$authToken = [Convert]::ToBase64String($authBytes)

# ---- Project-pinned URL (SPA decodes base64url slug) ----
$projectDir = $env:GLITCH_PROJECT_DIR
if (-not $projectDir) {
  $projectDir = "$RootDir"
}
$dirBytes = [Text.Encoding]::UTF8.GetBytes($projectDir)
$dirSlug = [Convert]::ToBase64String($dirBytes).Replace('+', '-').Replace('/', '_').TrimEnd('=')
if ($cloudflareDomain) {
  Write-Host "  Web access URL: https://$cloudflareDomain/$dirSlug/?auth_token=$authToken" -ForegroundColor Green
}
Write-Host "  Local URL: http://localhost:$TargetPort" -ForegroundColor Green
Write-Host ""

# ---- Periodic path fixer (background job, runs every 5 min) ----
$fixJob = Start-Job -ScriptBlock {
  $rootDir = $using:RootDir
  while ($true) {
    Start-Sleep -Seconds 300
    & node "$rootDir\scripts\fix-paths.mjs"
  }
}
Write-Host "  Path fixer job running (every 5 min)" -ForegroundColor Cyan

# ---- Launch OpenCode Web ----
Push-Location $RootDir
try {
  & $OpenCodeBin web --port $TargetPort --hostname 0.0.0.0
} finally {
  Pop-Location
  # Clean up cloudflared when OpenCode exits
  if ($cloudflaredProcess -and -not $cloudflaredProcess.HasExited) {
    $cloudflaredProcess.Kill()
  }
  # Clean up auth proxy when OpenCode exits
  if ($proxyProcess -and -not $proxyProcess.HasExited) {
    $proxyProcess.Kill()
  }
  # Clean up fix-path job
  $fixJob | Stop-Job -PassThru | Remove-Job
}
