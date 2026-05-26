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
$handyVersion = "0.8.3"
$handyArch = if ($isArm) { "arm64" } else { "x64" }
$handySize = 105925408
$needsInstall = $Force
if (Test-Path $HandyBin) {
  $actualSize = (Get-Item $HandyBin).Length
  if ($actualSize -ne $handySize) { $needsInstall = $true }
} else { $needsInstall = $true }
if ($needsInstall) {
  Write-Host "[2/3] Installing Handy..." -ForegroundColor Cyan
  $systemHandy = "$env:LOCALAPPDATA\Handy\handy.exe"
  if (Test-Path $systemHandy) {
    Write-Host "  Found system install, copying..." -ForegroundColor Yellow
    if (-not (Test-Path $HandyDir)) { New-Item -ItemType Directory -Path $HandyDir -Force }
    Copy-Item "$env:LOCALAPPDATA\Handy\*" $HandyDir -Recurse -Force
  } else {
    Write-Host "  Downloading Handy v$handyVersion ($handyArch)..." -ForegroundColor Yellow
    $setupUrl = "https://github.com/cjpais/Handy/releases/download/v$handyVersion/Handy_${handyVersion}_${handyArch}-setup.exe"
    $setupPath = "$env:TEMP\Handy_setup.exe"
    $extractDir = "$env:TEMP\Handy_tmp"
    Invoke-WebRequest -Uri $setupUrl -OutFile $setupPath -UseBasicParsing
    $7z = Get-Command "7z" -ErrorAction SilentlyContinue
    if ($7z) {
      Write-Host "  Extracting with 7-Zip..." -ForegroundColor Yellow
      if (Test-Path $extractDir) { Remove-Item -Path $extractDir -Recurse -Force }
      New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
      & $7z.Source x "$setupPath" -o"$extractDir" -y 2>&1 | Out-Null
    } else {
      Write-Host "  Running installer silently..." -ForegroundColor Yellow
      $extractDir = "$env:LOCALAPPDATA\Handy_tmp"
      Start-Process -FilePath $setupPath -ArgumentList "/VERYSILENT /DIR=`"$extractDir`" /SUPPRESSMSGBOXES /NORESTART" -Wait
    }
    $foundExe = Get-ChildItem -Path $extractDir -Recurse -Filter "handy.exe" | Select-Object -First 1
    if ($foundExe) {
      $src = $foundExe.Directory.FullName
      if (Test-Path $HandyDir) { Remove-Item $HandyDir -Recurse -Force }
      New-Item -ItemType Directory -Path $HandyDir -Force | Out-Null
      Copy-Item "$src\*" $HandyDir -Recurse -Force
    } else {
      Write-Host "  Failed to extract Handy. Download manually:" -ForegroundColor Red
      Write-Host "  https://github.com/cjpais/Handy/releases" -ForegroundColor Yellow
    }
    Remove-Item $setupPath -Force -ErrorAction SilentlyContinue
    Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ((Test-Path $HandyBin) -and ((Get-Item $HandyBin).Length -eq $handySize)) {
    Set-Content -Path "$HandyDir\portable" -Value "Handy Portable Mode" -NoNewline
    Write-Host "  Handy ready!" -ForegroundColor Green
  }
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
