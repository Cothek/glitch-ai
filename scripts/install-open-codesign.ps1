param(
  [string]$Version = "",
  [switch]$Force = $false
)

$ErrorActionPreference = "Stop"

# ── Helpers ──
function Write-Step {
  param([string]$Text)
  Write-Host "  $Text" -ForegroundColor Cyan
}

function Write-Ok {
  param([string]$Text)
  Write-Host "    OK $Text" -ForegroundColor Green
}

function Write-Warn {
  param([string]$Text)
  Write-Host "    WARNING: $Text" -ForegroundColor Yellow
}

function Write-Fail {
  param([string]$Text)
  Write-Host "    FAILED: $Text" -ForegroundColor Red
}

# ── 1. Resolve Paths ──
$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Split-Path -Parent $ScriptDir
$DataDir = Join-Path $RootDir "data/open-codesign"
$InstallDir = Join-Path $DataDir "app"
$ScreenshotsDir = Join-Path $RootDir "screenshots"
$DownloadsDir = Join-Path $RootDir "data/downloads"
$StartScript = Join-Path $ScriptDir "start-open-codesign.ps1"

Write-Host ""
Write-Host "Open CoDesign Module Installer" -ForegroundColor Magenta
Write-Host "  Root: $RootDir" -ForegroundColor DarkGray
Write-Host ""

# ── 2. Detect Platform ──
Write-Step "[1/7] Detecting platform..."

$isWindows = $env:OS -match "Windows"
$isMac = $false
$isLinux = $false

if ($isWindows) {
  Write-Ok "Platform: Windows"
} else {
  # Not Windows - need platform check for cross-platform support
  $uname = uname -s 2>$null
  if ($uname -match "Darwin") {
    $isMac = $true
    Write-Ok "Platform: macOS"
  } else {
    $isLinux = $true
    Write-Ok "Platform: Linux"
  }
}

# Detect architecture
$arch = if ($isWindows) {
  $env:PROCESSOR_ARCHITECTURE
} else {
  uname -m 2>$null
}
$isArm64 = $arch -match "ARM64|aarch64"

# ── 3. Determine Version ──
Write-Step "[2/7] Determining version..."

if (-not $Version) {
  Write-Host "    Fetching latest release from GitHub..." -ForegroundColor Yellow
  try {
    $releaseJson = Invoke-WebRequest -Uri "https://api.github.com/repos/opencoworkai/open-codesign/releases/latest" -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop | ConvertFrom-Json
    $Version = $releaseJson.tag_name
    Write-Ok "Latest release: $Version"
  } catch {
    Write-Fail "Could not fetch latest release: $_"
    Write-Warn "Specify a version with -Version (e.g., -Version v0.2.1)"
    exit 1
  }
}

$versionClean = $Version.TrimStart("v")

# ── 4. Select Asset ──
Write-Step "[3/7] Selecting download asset..."

$assetName = if ($isWindows) {
  if ($isArm64) { "open-codesign-${versionClean}-arm64-setup.exe" }
  else { "open-codesign-${versionClean}-x64-setup.exe" }
} elseif ($isMac) {
  if ($isArm64) { "open-codesign-${versionClean}-arm64.dmg" }
  else { "open-codesign-${versionClean}-x64.dmg" }
} else {
  "open-codesign-${versionClean}-x64.AppImage"
}

$downloadUrl = "https://github.com/OpenCoworkAI/open-codesign/releases/download/${Version}/${assetName}"
$checksumUrl = "https://github.com/OpenCoworkAI/open-codesign/releases/download/${Version}/SHA256SUMS.txt"

Write-Host "    Asset: $assetName" -ForegroundColor White
Write-Host "    URL: $downloadUrl" -ForegroundColor DarkGray
Write-Ok "Asset selected"

# ── 5. Download ──
Write-Step "[4/7] Downloading Open CoDesign $Version..."

$null = New-Item -ItemType Directory -Path $DownloadsDir -Force
$downloadPath = Join-Path $DownloadsDir $assetName

if ((Test-Path $downloadPath) -and -not $Force) {
  Write-Ok "Already downloaded at $downloadPath (use -Force to re-download)"
} else {
  Write-Host "    Downloading ($assetName)..." -ForegroundColor Yellow
  Write-Host "    This may take a minute..." -ForegroundColor DarkGray
  try {
    $wc = New-Object System.Net.WebClient
    $wc.DownloadFile($downloadUrl, $downloadPath)
    Write-Ok "Downloaded to $downloadPath"
  } catch {
    Write-Fail "Download failed: $_"
    exit 1
  }
}

$downloadedSize = (Get-Item $downloadPath).Length
Write-Host "    Size: $([math]::Round($downloadedSize / 1MB, 1)) MB" -ForegroundColor DarkGray

# ── 6. Verify SHA256 ──
Write-Step "[5/7] Verifying checksum..."

try {
  $shaFileContent = (Invoke-WebRequest -Uri $checksumUrl -UseBasicParsing -TimeoutSec 10).Content
  $expectedHash = ($shaFileContent -split "`n" | Where-Object { $_ -match [regex]::Escape($assetName) } | ForEach-Object { ($_ -split "\s+")[0] }).Trim()
  if (-not $expectedHash) { throw "No hash found for $assetName in SHA256SUMS.txt" }
  Write-Ok "Expected SHA256: $expectedHash"
} catch {
  Write-Warn "Could not fetch SHA256SUMS: $_"
  Write-Warn "Skipping checksum verification (install will proceed without verification)"
  $expectedHash = $null
}

if ($expectedHash) {
  $actualHash = (Get-FileHash -Path $downloadPath -Algorithm SHA256).Hash.ToLower()
  if ($actualHash -eq $expectedHash.ToLower()) {
    Write-Ok "Checksum matches: $actualHash"
  } else {
    Write-Fail "Checksum mismatch!"
    Write-Fail "  Expected: $expectedHash"
    Write-Fail "  Actual:   $actualHash"
    Write-Warn "The downloaded file may be corrupted or tampered with."
    Write-Warn "Delete the file and try again, or use -Force to re-download."
    exit 1
  }
}

# ── 7. Install ──
Write-Step "[6/7] Installing Open CoDesign..."

$null = New-Item -ItemType Directory -Path $DataDir -Force

if ($isWindows) {
  Write-Host "    Running installer..." -ForegroundColor Yellow
  try {
    $proc = Start-Process -FilePath $downloadPath -ArgumentList "/S /D=$InstallDir" -Wait -PassThru
    if ($proc.ExitCode -eq 0) {
      Write-Ok "Installed to $InstallDir"
    } else {
      throw "Installer exited with code $($proc.ExitCode)"
    }
  } catch {
    Write-Warn "Silent install failed: $_"
    Write-Warn "Trying default installer mode..."
    try {
      Start-Process -FilePath $downloadPath -Wait
      Write-Ok "Installer launched (follow the prompts)"
    } catch {
      Write-Fail "Installation failed: $_"
      Write-Warn "You can manually run: $downloadPath"
      exit 1
    }
  }
} elseif ($isMac) {
  Write-Host "    Mounting DMG..." -ForegroundColor Yellow
  $mountPoint = & hdiutil attach $downloadPath -nobrowse 2>&1 | Select-String "/Volumes/" | ForEach-Object { $_ -replace ".*(/Volumes/.*)", '$1' }
  if (-not $mountPoint) {
    Write-Fail "Failed to mount DMG"
    exit 1
  }
  Write-Ok "Mounted at $mountPoint"
  
  try {
    Copy-Item "$mountPoint/Open CoDesign.app" "/Applications/Open CoDesign.app" -Recurse -Force
    Write-Ok "Installed to /Applications/Open CoDesign.app"
  } finally {
    & hdiutil detach $mountPoint -quiet 2>$null
  }
} else {
  # Linux - make AppImage executable, copy to data dir
  Write-Host "    Installing AppImage..." -ForegroundColor Yellow
  $appImageTarget = Join-Path $DataDir "OpenCoDesign-x64.AppImage"
  Copy-Item $downloadPath $appImageTarget -Force
  & chmod +x $appImageTarget
  Write-Ok "AppImage installed to $appImageTarget"
  Write-Warn "You may need to install FUSE or set up AppImage integration"
}

# ── 8. Create Launcher ──
Write-Step "[7/7] Creating launcher script..."

if ($isWindows) {
  $launcherContent = @"
param(`$Action = "")

`$ScriptDir = Split-Path -Parent `$PSCommandPath
`$RootDir = Split-Path -Parent `$ScriptDir
`$InstallDir = Join-Path `$RootDir "data/open-codesign/app"

# Detect install path - check both default and Program Files
`$PathsToCheck = @(
  `$InstallDir,
  "`${env:LOCALAPPDATA}\Programs\open-codesign",
  "`${env:PROGRAMFILES}\open-codesign"
)

`$ExePath = $null
foreach (`$p in `$PathsToCheck) {
  `$candidate = Join-Path `$p "Open CoDesign.exe"
  if (Test-Path `$candidate) {
    `$ExePath = `$candidate
    break
  }
  `$candidate2 = Join-Path `$p "open-codesign.exe"
  if (Test-Path `$candidate2) {
    `$ExePath = `$candidate2
    break
  }
}

if (-not `$ExePath) {
  Write-Host "Open CoDesign is not installed. Run scripts/install-open-codesign.ps1 first." -ForegroundColor Red
  Write-Host "Expected at: `$InstallDir" -ForegroundColor DarkGray
  exit 1
}

Write-Host "Starting Open CoDesign..." -ForegroundColor Cyan
Write-Host "  Path: `$ExePath" -ForegroundColor DarkGray
Start-Process -FilePath `$ExePath
"@
} else {
  $launcherContent = "#!/usr/bin/env bash`nSCRIPT_DIR=\"\$(cd \"\$(dirname \"\$0\")\" && pwd)\"`nROOT_DIR=\"\$(dirname \"\$SCRIPT_DIR\")\"`nif [[ \"\$(uname -s)\" == \"Darwin\" ]]; then`n  open \"/Applications/Open CoDesign.app\"`nelse`n  \"\$ROOT_DIR/data/open-codesign/OpenCoDesign-x64.AppImage\" &`nfi`n"
}

Set-Content -Path $StartScript -Value $launcherContent -Encoding UTF8
Write-Ok "Launcher created at $StartScript"

# ── Done ──
Write-Host ""
Write-Host "============================================" -ForegroundColor Magenta
Write-Host " Open CoDesign module installed!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  Version: $Version" -ForegroundColor White
Write-Host "  Install: $DataDir" -ForegroundColor White
Write-Host "  Download: $downloadPath" -ForegroundColor White
Write-Host "  Launcher: $StartScript" -ForegroundColor White
Write-Host ""
Write-Host "Launch with: scripts/start-open-codesign.ps1" -ForegroundColor Cyan
Write-Host ""
