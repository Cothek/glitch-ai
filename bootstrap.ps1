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
  Write-Host "[1/2] Installing OpenCode..." -ForegroundColor Cyan
  # Try copying from system npm install first
  $systemOpenCode = "C:\Program Files\nodejs\node_modules\opencode-ai\bin\opencode.exe"
  if (Test-Path $systemOpenCode) {
    Write-Host "  Found system install, copying..." -ForegroundColor Yellow
    Copy-Item $systemOpenCode $OpenCodeBin -Force
  } else {
    # Download from GitHub releases
    $zipUrl = "https://github.com/anomalyco/opencode/releases/download/v1.15.7/opencode-windows-$archSuffix.zip"
    $zipPath = "$env:TEMP\opencode.zip"
    Write-Host "  Downloading opencode v1.15.7..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    Write-Host "  Extracting..." -ForegroundColor Yellow
    Expand-Archive -Path $zipPath -DestinationPath $OpenCodeDir -Force
    Remove-Item $zipPath -Force
    # The zip contains the binary in a subfolder; find and move it
    $extracted = Get-ChildItem "$OpenCodeDir\**\opencode.exe" -Recurse | Select-Object -First 1
    if ($extracted) {
      Move-Item $extracted.FullName $OpenCodeBin -Force
      Get-ChildItem "$OpenCodeDir\*" -Directory | Remove-Item -Recurse -Force
    }
  }
  Write-Host "  OpenCode ready!" -ForegroundColor Green
} else {
  Write-Host "[1/2] OpenCode found" -ForegroundColor DarkGreen
}

# ── Handy ──
if (-not (Test-Path $HandyBin) -or $Force) {
  Write-Host "[2/2] Installing Handy..." -ForegroundColor Cyan
  # Try copying from system install first
  $systemHandy = "$env:LOCALAPPDATA\Handy\handy.exe"
  if (Test-Path $systemHandy) {
    Write-Host "  Found system install, copying..." -ForegroundColor Yellow
    if (-not (Test-Path $HandyDir)) { New-Item -ItemType Directory -Path $HandyDir -Force }
    Copy-Item $systemHandy $HandyBin -Force
  } else {
    Write-Host "  ERROR: No Handy binary found." -ForegroundColor Red
    Write-Host "  Download Handy manually from the official source and place it at:" -ForegroundColor Red
    Write-Host "  $HandyBin" -ForegroundColor Red
    exit 1
  }
  # Create portable flag
  Set-Content -Path "$HandyDir\portable" -Value "" -NoNewline
  Write-Host "  Handy ready!" -ForegroundColor Green
} else {
  Write-Host "[2/2] Handy found" -ForegroundColor DarkGreen
}

Write-Host "=== Glitch is ready! Run .\launch.bat to start ===" -ForegroundColor Magenta
