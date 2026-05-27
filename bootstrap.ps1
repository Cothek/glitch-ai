param(
  [switch]$Force
)

$RootDir = Split-Path -Parent $PSCommandPath
$LogFile = "$RootDir\bootstrap.log"
$OpenCodeDir = "$RootDir\opencode"
$OpenCodeBin = "$OpenCodeDir\opencode.exe"
$HandyDir = "$RootDir\handy-voice\Handy"
$HandyBin = "$HandyDir\handy.exe"
$CloudflaredBin = "$RootDir\cloudflared.exe"

# Don't stop on first error -- we handle per-step
$ErrorActionPreference = "Continue"

# Redirect all script output to a log file too
Start-Transcript -Path $LogFile -Append | Out-Null

# ── Detect architecture ──
$isArm = (Get-CimInstance Win32_Processor).Architecture -eq 5
$archSuffix = if ($isArm) { "arm64" } else { "x64" }

Write-Host "=== Glitch Bootstrap ===" -ForegroundColor Magenta
Write-Host "Log: $LogFile" -ForegroundColor DarkGray
Write-Host ""

$failures = @()

# ── Step 1: Git Submodules ──
Write-Host "[1/4] Initializing git submodules..." -ForegroundColor Cyan
try {
  git submodule update --init --recursive 2>&1 | Out-Null
  Write-Host "  Submodules ready!" -ForegroundColor Green
} catch {
  Write-Host "  Skipping submodules (not a git repo or git not available)" -ForegroundColor Yellow
}

# ── Step 2: OpenCode ──
$stepOk = $true
if (-not (Test-Path $OpenCodeBin) -or $Force) {
  Write-Host "[2/5] Installing OpenCode..." -ForegroundColor Cyan
  try {
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
      } else {
        throw "Could not find opencode.exe in extracted files"
      }
    }
    Write-Host "  OpenCode ready!" -ForegroundColor Green
  } catch {
    Write-Host "  ERROR installing OpenCode: $_" -ForegroundColor Red
    $stepOk = $false
    $failures += "Step 2: OpenCode -- $_"
  }
} else {
  Write-Host "[2/4] OpenCode found" -ForegroundColor DarkGreen
}

# ── Step 3: Handy ──
$handyVersion = "0.8.3"
$handyArch = if ($isArm) { "arm64" } else { "x64" }
$handySize = 105925408
$needsInstall = $Force
if (Test-Path $HandyBin) {
  $actualSize = (Get-Item $HandyBin).Length
  if ($actualSize -ne $handySize) { $needsInstall = $true }
} else { $needsInstall = $true }
if ($needsInstall) {
  Write-Host "[3/4] Installing Handy..." -ForegroundColor Cyan
  try {
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
        Write-Host "  Installing silently..." -ForegroundColor Yellow
        $extractDir = "$env:LOCALAPPDATA\Handy_tmp"
        $proc = Start-Process -FilePath $setupPath -ArgumentList "/S", "/D=$extractDir" -Wait -PassThru
        if ($proc.ExitCode -ne 0) {
          Write-Host "  Silent install failed. Trying MSI extraction..." -ForegroundColor DarkYellow
          $msiUrl = "https://github.com/cjpais/Handy/releases/download/v$handyVersion/Handy_${handyVersion}_${handyArch}_en-US.msi"
          $msiPath = "$env:TEMP\Handy_${handyVersion}_${handyArch}_en-US.msi"
          Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
          $extractDir = "$env:TEMP\Handy_exe"
          New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
          Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
          Write-Host "  Extracting via MSI..." -ForegroundColor Yellow
          Start-Process -FilePath "msiexec" -ArgumentList "/a `"$msiPath`" /qn TARGETDIR=`"$extractDir`"" -Wait
          Remove-Item $msiPath -Force -ErrorAction SilentlyContinue
        }
      }
      $foundExe = Get-ChildItem -Path $extractDir -Recurse -Filter "handy.exe" | Select-Object -First 1
      if ($foundExe) {
        $src = $foundExe.Directory.FullName
        if (Test-Path $HandyDir) { Remove-Item $HandyDir -Recurse -Force }
        New-Item -ItemType Directory -Path $HandyDir -Force | Out-Null
        Copy-Item "$src\*" $HandyDir -Recurse -Force
      } else {
        Write-Host "  Failed to extract Handy." -ForegroundColor Red
        Write-Host "  Download manually: https://github.com/cjpais/Handy/releases" -ForegroundColor Yellow
      }
      Remove-Item $setupPath -Force -ErrorAction SilentlyContinue
      Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ((Test-Path $HandyBin) -and ((Get-Item $HandyBin).Length -eq $handySize)) {
      Set-Content -Path "$HandyDir\portable" -Value "Handy Portable Mode" -NoNewline
      Write-Host "  Handy ready!" -ForegroundColor Green
    }
  } catch {
    Write-Host "  ERROR installing Handy: $_" -ForegroundColor Red
    $failures += "Step 3: Handy -- $_"
  }
} else {
  Write-Host "[3/4] Handy found" -ForegroundColor DarkGreen
}

# ── Step 4: Cloudflare Tunnel (standalone EXE, no admin needed) ──
if (-not (Test-Path $CloudflaredBin) -or $Force) {
  Write-Host "[4/4] Installing Cloudflare Tunnel..." -ForegroundColor Cyan
  try {
    if ($isArm) {
      Write-Host "  ARM64: Download cloudflared manually:" -ForegroundColor Yellow
      Write-Host "  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    } else {
      Write-Host "  Downloading cloudflared.exe..." -ForegroundColor Yellow
      $exeUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
      Invoke-WebRequest -Uri $exeUrl -OutFile $CloudflaredBin -UseBasicParsing
      Write-Host "  cloudflared ready!" -ForegroundColor Green
    }
  } catch {
    Write-Host "  ERROR installing cloudflared: $_" -ForegroundColor Red
    Write-Host "  This is optional -- tunnel mode won't be available but local mode works fine." -ForegroundColor Yellow
    $failures += "Step 4: Cloudflare Tunnel -- $_"
  }
} else {
  Write-Host "[4/4] cloudflared found" -ForegroundColor DarkGreen
}

# ── Summary ──
Write-Host ""
Write-Host "=== Glitch Bootstrap Complete ===" -ForegroundColor Magenta

if ($failures.Count -gt 0) {
  Write-Host ""
  Write-Host "$($failures.Count) step(s) had non-critical errors:" -ForegroundColor Yellow
  $failures | ForEach-Object { Write-Host "  ⚠ $_" -ForegroundColor Yellow }
  Write-Host ""
  Write-Host "These are optional components -- Glitch will still run." -ForegroundColor Yellow
  Write-Host "See bootstrap.log for full details." -ForegroundColor DarkGray
} else {
  Write-Host "All steps completed successfully!" -ForegroundColor Green
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  .\launch-glitch.bat       - TUI mode (with Handy voice)" -ForegroundColor Cyan
Write-Host "  .\serve-glitch.bat        - Web server mode (access from anywhere)" -ForegroundColor Cyan
Write-Host ""
Write-Host "  For first-time Cloudflare Tunnel setup:" -ForegroundColor Yellow
Write-Host "  .\setup-tunnel.ps1        - Authenticate + create tunnel + DNS record" -ForegroundColor Yellow

Stop-Transcript | Out-Null
