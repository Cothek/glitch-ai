$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSCommandPath
$OpenCodeBin = "$RootDir\opencode\opencode.exe"
$Cloudflared = "$RootDir\cloudflared.exe"

Write-Host ""
Write-Host "Glitch AI - Server Mode" -ForegroundColor Magenta
Write-Host ""

$TargetPort = 4102

# ── Check prerequisites ──
if (-not (Test-Path $OpenCodeBin)) {
  Write-Host "OpenCode not found. Run bootstrap.ps1 first." -ForegroundColor Red
  exit 1
}

# ── Normalize backslash paths in session DB ──
& "$RootDir\fix-paths.ps1"

# ── Check port availability (zombie socket prevention) ──
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

# ─ Cloudflare Tunnel status ──
$cloudflareOk = $false
if (Test-Path $Cloudflared) {
  $tunnelConfig = "$RootDir\cloudflared-config.yml"
  if (Test-Path $tunnelConfig) {
    $cloudflareOk = $true
    Write-Host "  Cloudflare Tunnel: configured (glitch.cothekdesigns.com)" -ForegroundColor Green
  } else {
    Write-Host "  Cloudflare Tunnel: not configured. Run setup-tunnel.ps1 first." -ForegroundColor Yellow
  }
} else {
  Write-Host "  Cloudflare Tunnel: cloudflared.exe not found" -ForegroundColor Yellow
}

# ── Start Cloudflare Tunnel ──
if ($cloudflareOk) {
  Write-Host "  Starting Cloudflare Tunnel..." -ForegroundColor Cyan
  $cloudflaredProcess = Start-Process -NoNewWindow -FilePath $Cloudflared -ArgumentList "tunnel", "--config", "`"$RootDir\cloudflared-config.yml`"", "run" -PassThru
  Start-Sleep -Seconds 2
  Write-Host "  Tunnel running: https://glitch.cothekdesigns.com" -ForegroundColor Green
}

# ── Handy ──
$HandyBin = "$RootDir\handy-voice\Handy\handy.exe"
$handyProcess = Get-Process -Name "handy" -ErrorAction SilentlyContinue
if (-not $handyProcess -and (Test-Path $HandyBin)) {
  Write-Host "  Starting Handy voice input..." -ForegroundColor Cyan
  Start-Process -FilePath $HandyBin -WindowStyle Minimized
  Start-Sleep -Seconds 1
} elseif ($handyProcess) {
  Write-Host "  Handy already running" -ForegroundColor DarkGreen
}

# ── Auth Proxy (adds Basic Auth for transparent mobile auth) ──
Write-Host "  Starting auth proxy (port 4100 → $TargetPort)..." -ForegroundColor Cyan
$proxyProcess = Start-Process -NoNewWindow -FilePath "node" -ArgumentList "`"$RootDir\plugins\auth-proxy.mjs`"", "4100", "http://localhost:$TargetPort" -PassThru
Start-Sleep -Seconds 1

# ── Password (ACL-locked file, current user only) ──
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

# ── ttyd Terminal Server ──
$ttydB = "$RootDir\ttyd\ttyd.exe"
if (Test-Path $ttydB) {
  $tp = 4104
  Write-Host "  Starting ttyd terminal server (port $tp)..." -ForegroundColor Cyan
  $ttydProcess = Start-Process -NoNewWindow -FilePath $ttydB -ArgumentList "--port", "$tp", "--credential", "opencode:$pw", "--ping-interval", "10", "$OpenCodeBin" -PassThru
  Start-Sleep -Seconds 2
  Write-Host "  Terminal URL: https://glitch.cothekdesigns.com/terminal" -ForegroundColor Green
}
else {
  Write-Host "  ttyd not found - skipping terminal server" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  Server password: $pw" -ForegroundColor Yellow
Write-Host "  Username: opencode" -ForegroundColor Yellow
$authBytes = [System.Text.Encoding]::UTF8.GetBytes("opencode:$pw")
$authToken = [Convert]::ToBase64String($authBytes)

# Project-pinned URL — actual filesystem path (SPA decodes base64url slug and queries with real path)
$projectDir = "E:/Glitch AI/glitch-ai"
$dirBytes = [Text.Encoding]::UTF8.GetBytes($projectDir)
$dirSlug = [Convert]::ToBase64String($dirBytes).Replace('+', '-').Replace('/', '_').TrimEnd('=')
Write-Host "  Web access URL: https://glitch.cothekdesigns.com/$dirSlug/?auth_token=$authToken" -ForegroundColor Green
Write-Host ""

# ── Periodic path fixer (background job, runs every 5 min) ──
$fixJob = Start-Job -ScriptBlock {
  $rootDir = $using:RootDir
  while ($true) {
    Start-Sleep -Seconds 300
    & node "$rootDir\fix-paths.mjs"
  }
}
Write-Host "  Path fixer job running (every 5 min)" -ForegroundColor Cyan

# ── Launch OpenCode Web ──
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
  # Clean up ttyd process
  if ($ttydProcess -and -not $ttydProcess.HasExited) {
    $ttydProcess.Kill()
  }
  # Clean up fix-path job
  $fixJob | Stop-Job -PassThru | Remove-Job
}
