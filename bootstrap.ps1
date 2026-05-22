param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSCommandPath
$OpenCodeDir = "$RootDir\opencode"
$OpenCodeBin = "$OpenCodeDir\opencode.exe"
$HandyDir = "$RootDir\handy-voice\Handy"
$HandyBin = "$HandyDir\handy.exe"
$CloudflaredBin = "$RootDir\cloudflared.exe"

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

# ── Cloudflare Tunnel ──
if (-not (Test-Path $CloudflaredBin) -or $Force) {
  Write-Host "[3/3] Installing Cloudflare Tunnel..." -ForegroundColor Cyan
  if ($isArm) {
    Write-Host "  ARM64 not supported by cloudflared directly. Download manually from:" -ForegroundColor Yellow
    Write-Host "  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" -ForegroundColor Yellow
  } else {
    $msiUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi"
    $msiPath = "$env:TEMP\cloudflared.msi"
    Write-Host "  Downloading cloudflared..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
    Write-Host "  Installing (admin required)..." -ForegroundColor Yellow
    Start-Process -FilePath "msiexec" -ArgumentList "/i `"$msiPath`" /qn" -Wait
    Remove-Item $msiPath -Force
    $installed = Get-Command "cloudflared" -ErrorAction SilentlyContinue
    if ($installed) {
      Write-Host "  cloudflared installed!" -ForegroundColor Green
    } else {
      Write-Host "  cloudflared install may need PATH refresh." -ForegroundColor Yellow
    }
  }
} else {
  Write-Host "[3/3] cloudflared found" -ForegroundColor DarkGreen
}

Write-Host ""
Write-Host "=== Glitch is ready! ===" -ForegroundColor Magenta
Write-Host "  .\launch-glitch.bat       - TUI mode (with Handy voice)" -ForegroundColor Cyan
Write-Host "  .\serve-glitch.bat        - Web server mode (access from anywhere)" -ForegroundColor Cyan
Write-Host ""
Write-Host "  For first-time Cloudflare Tunnel setup:" -ForegroundColor Yellow
Write-Host "  .\setup-tunnel.ps1        - Authenticate + create tunnel + DNS record" -ForegroundColor Yellow
