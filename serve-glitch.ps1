$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSCommandPath
$OpenCodeBin = "$RootDir\opencode\opencode.exe"
$Cloudflared = "$RootDir\cloudflared.exe"

Write-Host ""
Write-Host "Glitch AI - Server Mode" -ForegroundColor Magenta
Write-Host ""

# ── Check prerequisites ──
if (-not (Test-Path $OpenCodeBin)) {
  Write-Host "OpenCode not found. Run bootstrap.ps1 first." -ForegroundColor Red
  exit 1
}

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

# ── Sync session history ─
Write-Host "  Syncing session history..." -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -File "$RootDir\sync-history.ps1" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }

# ── Start restore server (port 4097) ──
Write-Host "  Starting restore server (port 4097)..." -ForegroundColor Cyan
$restoreProcess = Start-Process -NoNewWindow -FilePath "node" -ArgumentList "`"$RootDir\restore-server.mjs`"" -PassThru
Start-Sleep -Seconds 1

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

Write-Host ""
Write-Host "  Server password: $pw" -ForegroundColor Yellow
Write-Host "  Username: opencode" -ForegroundColor Yellow
Write-Host ""

# ── Launch OpenCode Web ──
Push-Location $RootDir
try {
  & $OpenCodeBin web --port 4096 --hostname 0.0.0.0
} finally {
  Pop-Location
  # Clean up restore server and cloudflared when OpenCode exits
  if ($restoreProcess -and -not $restoreProcess.HasExited) {
    $restoreProcess.Kill()
  }
  if ($cloudflaredProcess -and -not $cloudflaredProcess.HasExited) {
    $cloudflaredProcess.Kill()
  }
}