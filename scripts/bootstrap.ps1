param(
  [switch]$Force
)

$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Split-Path -Parent $ScriptDir
$LogFile = "$RootDir\data\bootstrap.log"
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

# ── Step 1: Node.js (portable bundled — always installed) ──
$BundledNodeDir = "$RootDir\data\node"
$NodeBin = "$BundledNodeDir\node.exe"

Write-Host "[1/5] Installing bundled Node.js..." -ForegroundColor Cyan

$needsDownload = (-not (Test-Path $NodeBin)) -or $Force
$currentBundledVer = ""

if (-not $needsDownload) {
  try {
    $currentBundledVer = (& $NodeBin "--version" 2>$null).Trim()
    Write-Host "  Bundled Node.js found: $currentBundledVer" -ForegroundColor DarkGreen
  } catch {
    $needsDownload = $true
  }
}

if ($needsDownload) {
  Write-Host "  Checking latest LTS version..." -ForegroundColor Yellow
  try {
    $json = Invoke-WebRequest -Uri "https://nodejs.org/dist/index.json" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    $releases = $json | ConvertFrom-Json
    $latestLTS = ($releases | Where-Object { $_.lts -ne $false } | Select-Object -First 1)
    $latestVer = if ($latestLTS -and $latestLTS.version) { $latestLTS.version } else { "v22.14.0" }
  } catch {
    $latestVer = "v22.14.0"
  }

  # Skip if current bundled version matches latest
  if ($currentBundledVer -eq $latestVer -and -not $Force) {
    Write-Host "  Bundled Node.js is up-to-date ($currentBundledVer)" -ForegroundColor DarkGreen
  } else {
    Write-Host "  Downloading Node.js $latestVer (portable)..." -ForegroundColor Yellow
    try {
      $nodeArch = if ($isArm) { "arm64" } else { "x64" }
      $zipUrl = "https://nodejs.org/dist/$latestVer/node-$latestVer-win-$nodeArch.zip"
      $zipDir = Join-Path $RootDir "data\downloads"
      if (-not (Test-Path $zipDir)) { New-Item -ItemType Directory -Path $zipDir -Force | Out-Null }
      $zipPath = Join-Path $zipDir "node-portable.zip"

      Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

      Write-Host "  Extracting..." -ForegroundColor Yellow
      $extractDir = "$env:TEMP\node-extracted"
      if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue }
      Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

      $extractedExe = Get-ChildItem $extractDir -Recurse -Filter "node.exe" | Select-Object -First 1
      if ($extractedExe) {
        $oldDir = "$BundledNodeDir.old"
        # Rename old dir to .old first (rename works even with running executables on Windows)
        if (Test-Path $BundledNodeDir) {
          if (Test-Path $oldDir) { Remove-Item $oldDir -Recurse -Force -ErrorAction SilentlyContinue }
          Rename-Item $BundledNodeDir $oldDir -ErrorAction SilentlyContinue
        }
        New-Item -ItemType Directory -Path $BundledNodeDir -Force | Out-Null
        Copy-Item "$($extractedExe.Directory.FullName)\*" $BundledNodeDir -Recurse -Force
        # Cleanup .old - may fail if node.exe still running; cleaned on next update
        Remove-Item $oldDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  Node.js extracted to data/node/" -ForegroundColor Green
      } else {
        throw "Could not find node.exe in extracted archive"
      }

      Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
      Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
      Write-Host "  ERROR downloading Node.js: $_" -ForegroundColor Red
      $failures += "Step 1: Node.js -- $_"
    }
  }
}

if (Test-Path $NodeBin) {
  $ver = & $NodeBin "--version" 2>$null
  Write-Host "  Node.js ready: $(if ($ver) { $ver.Trim() } else { 'unknown version' })" -ForegroundColor Green
} else {
  Write-Host "  (using system Node.js)" -ForegroundColor DarkGreen
}

# ── Step 2: Git Submodules ──
Write-Host "[2/5] Initializing git submodules..." -ForegroundColor Cyan
try {
  git submodule update --init --recursive 2>&1 | Out-Null
  Write-Host "  Submodules ready!" -ForegroundColor Green
} catch {
  Write-Host "  Skipping submodules (not a git repo or git not available)" -ForegroundColor Yellow
}

# ── Step 3: OpenCode ──
$stepOk = $true
if (-not (Test-Path $OpenCodeBin) -or $Force) {
  Write-Host "[3/5] Installing OpenCode..." -ForegroundColor Cyan
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
    $failures += "Step 3: OpenCode -- $_"
  }
} else {
  Write-Host "[3/5] OpenCode found" -ForegroundColor DarkGreen
}

# ── Step 4: Handy ──
$handyVersion = "0.8.3"
$handyArch = if ($isArm) { "arm64" } else { "x64" }
$handySize = 105925408
$needsInstall = $Force
if (Test-Path $HandyBin) {
  $actualSize = (Get-Item $HandyBin).Length
  if ($actualSize -ne $handySize) { $needsInstall = $true }
} else { $needsInstall = $true }
if ($needsInstall) {
  Write-Host "[4/5] Installing Handy..." -ForegroundColor Cyan
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
  Write-Host "[4/5] Handy found" -ForegroundColor DarkGreen
}

# ── Step 5: Cloudflare Tunnel (standalone EXE, no admin needed) ──
if (-not (Test-Path $CloudflaredBin) -or $Force) {
  Write-Host "[5/5] Installing Cloudflare Tunnel..." -ForegroundColor Cyan
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
  Write-Host "[5/5] cloudflared found" -ForegroundColor DarkGreen
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
Write-Host "  .\launch-glitch.bat       - Web server mode (option 4 in unified launcher)" -ForegroundColor Cyan
Write-Host ""
Write-Host "  For first-time Cloudflare Tunnel setup:" -ForegroundColor Yellow
Write-Host "  .\setup-tunnel.ps1        - Authenticate + create tunnel + DNS record" -ForegroundColor Yellow

Stop-Transcript | Out-Null
