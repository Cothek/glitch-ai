$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSCommandPath
$OpenCodeBin = "$RootDir\opencode\opencode.exe"

Write-Host ""
Write-Host "🧠 Glitch AI - Server Mode" -ForegroundColor Magenta
Write-Host ""

# ── Check prerequisites ──
if (-not (Test-Path $OpenCodeBin)) {
  Write-Host "OpenCode not found. Run bootstrap.ps1 first." -ForegroundColor Red
  exit 1
}

# ── Tailscale status & serve setup ──
$tailscaleCmd = Get-Command "tailscale" -ErrorAction SilentlyContinue
if ($tailscaleCmd) {
  $tsStatus = & tailscale status 2>&1 | Out-String
  if ($tsStatus -match "Logged out|Needs login") {
    Write-Host "  Tailscale not logged in. Run .\bootstrap.ps1 to authenticate." -ForegroundColor Yellow
  } else {
    # Extract machine hostname from tailscale status
    $tsHostnameLine = ($tsStatus -split "`n" | Where-Object { $_ -match "^\d+\.\d+\.\d+\.\d+\s+\S+" } | Select-Object -First 1)
    if ($tsHostnameLine) {
      $tsHostname = ($tsHostnameLine -split "\s+")[1]
    }
    # Set up tailscale serve to forward port 4096 (idempotent, persistent)
    Write-Host "  Setting up Tailscale Serve..." -ForegroundColor Cyan
    & tailscale serve --bg --yes --http 80 4096 2>&1 | Out-Null
    & tailscale serve --bg --yes --https 443 4096 2>&1 | Out-Null
    if ($tsHostname) {
      Write-Host "  Access URL: http://$tsHostname/" -ForegroundColor Green
    }
  }
} else {
  Write-Host "  Tailscale not installed. Run .\bootstrap.ps1 to install." -ForegroundColor Yellow
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

# ── Password ──
$pwFile = "$RootDir\.server-password"
$pw = $env:OPENCODE_SERVER_PASSWORD
if (-not $pw) {
  if (Test-Path $pwFile) {
    $pw = Get-Content $pwFile -Raw | ForEach-Object { $_.Trim() }
  } else {
    $pw = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 16 | ForEach-Object { [char]$_ })
    Set-Content -Path $pwFile -Value $pw -NoNewline
  }
  $env:OPENCODE_SERVER_PASSWORD = $pw
}

Write-Host ""
Write-Host "  Server password: $pw" -ForegroundColor Yellow
Write-Host "  Username: opencode" -ForegroundColor Yellow
Write-Host ""

# ── Launch OpenCode Web (bind to localhost only — tailscale serve routes external traffic) ──
Push-Location $RootDir
try {
  & $OpenCodeBin web --port 4096 --hostname 127.0.0.1
} finally {
  Pop-Location
}
