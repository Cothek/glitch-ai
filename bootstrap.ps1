param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSCommandPath
$OpenCodeDir = "$RootDir\opencode"
$OpenCodeBin = "$OpenCodeDir\opencode.exe"
$HandyDir = "$RootDir\handy-voice\Handy"
$HandyBin = "$HandyDir\handy.exe"

# ── Detect architecture ──
$isArm = (Get-CimInstance Win32_Processor).Architecture -eq 5
$archSuffix = if ($isArm) { "arm64" } else { "x64" }

Write-Host "=== Glitch Bootstrap ===" -ForegroundColor Magenta

# ── OpenCode ──
if (-not (Test-Path $OpenCodeBin) -or $Force) {
  Write-Host "[1/3] Installing OpenCode..." -ForegroundColor Cyan
  $systemOpenCode = "C:\Program Files\nodejs\node_modules\opencode-ai\bin\opencode.exe"
  if (Test-Path $systemOpenCode) {
    Write-Host "  Found system install, copying..." -ForegroundColor Yellow
    Copy-Item $systemOpenCode $OpenCodeBin -Force
  } else {
    $zipUrl = "https://github.com/anomalyco/opencode/releases/download/v1.15.7/opencode-windows-$archSuffix.zip"
    $zipPath = "$env:TEMP\opencode.zip"
    Write-Host "  Downloading opencode v1.15.7..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    Write-Host "  Extracting..." -ForegroundColor Yellow
    Expand-Archive -Path $zipPath -DestinationPath $OpenCodeDir -Force
    Remove-Item $zipPath -Force
    $extracted = Get-ChildItem "$OpenCodeDir\**\opencode.exe" -Recurse | Select-Object -First 1
    if ($extracted) {
      Move-Item $extracted.FullName $OpenCodeBin -Force
      Get-ChildItem "$OpenCodeDir\*" -Directory | Remove-Item -Recurse -Force
    }
  }
  Write-Host "  OpenCode ready!" -ForegroundColor Green
} else {
  Write-Host "[1/3] OpenCode found" -ForegroundColor DarkGreen
}

# ── Handy ──
if (-not (Test-Path $HandyBin) -or $Force) {
  Write-Host "[2/3] Installing Handy..." -ForegroundColor Cyan
  $systemHandy = "$env:LOCALAPPDATA\Handy\handy.exe"
  if (Test-Path $systemHandy) {
    Write-Host "  Found system install, copying..." -ForegroundColor Yellow
    if (-not (Test-Path $HandyDir)) { New-Item -ItemType Directory -Path $HandyDir -Force }
    Copy-Item $systemHandy $HandyBin -Force
  } else {
    Write-Host "  WARNING: No Handy binary found." -ForegroundColor DarkYellow
    Write-Host "  Voice input will be disabled. Download Handy and place it at:" -ForegroundColor DarkYellow
    Write-Host "  $HandyBin" -ForegroundColor DarkYellow
  }
  Set-Content -Path "$HandyDir\portable" -Value "" -NoNewline
  Write-Host "  Handy ready!" -ForegroundColor Green
} else {
  Write-Host "[2/3] Handy found" -ForegroundColor DarkGreen
}

# ── Tailscale ──
$tailscaleCmd = Get-Command "tailscale" -ErrorAction SilentlyContinue
if (-not $tailscaleCmd -or $Force) {
  Write-Host "[3/3] Installing Tailscale..." -ForegroundColor Cyan
  $installerUrl = "https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe"
  $installerPath = "$env:TEMP\tailscale-setup.exe"
  Write-Host "  Downloading Tailscale..." -ForegroundColor Yellow
  Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
  Write-Host "  Installing (admin required)..." -ForegroundColor Yellow
  Write-Host "  If a UAC prompt appears, click Yes." -ForegroundColor Yellow
  Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait
  Remove-Item $installerPath -Force
  $tailscaleCmd = Get-Command "tailscale" -ErrorAction SilentlyContinue
  if (-not $tailscaleCmd) {
    Write-Host "  Tailscale installed. You may need to log out and back in for PATH to update." -ForegroundColor Yellow
  }
  Write-Host "  Tailscale installed!" -ForegroundColor Green
} else {
  Write-Host "[3/3] Tailscale found" -ForegroundColor DarkGreen
}

# ── Check Tailscale auth ──
$tailscaleCmd = Get-Command "tailscale" -ErrorAction SilentlyContinue
if ($tailscaleCmd) {
  $tsStatus = & tailscale status 2>&1 | Out-String
  if ($tsStatus -match "Logged out|Needs login|not logged in") {
    Write-Host ""
    Write-Host "── Tailscale Login Required ──" -ForegroundColor Yellow
    Write-Host "  Opening browser for Tailscale authentication..." -ForegroundColor Yellow
    Write-Host "  Log in with your Google/Microsoft/GitHub account (free for personal use)." -ForegroundColor Yellow
    Start-Process "https://login.tailscale.com/start"
    & tailscale up
  } else {
    Write-Host "  Tailscale: connected" -ForegroundColor DarkGreen
  }
}

Write-Host ""
Write-Host "=== Glitch is ready! ===" -ForegroundColor Magenta
Write-Host "  .\launch-glitch.bat       - TUI mode (with Handy voice)" -ForegroundColor Cyan
Write-Host "  .\serve-glitch.bat        - Web server mode (access from phone)" -ForegroundColor Cyan
