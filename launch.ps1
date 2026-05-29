$RootDir = Split-Path -Parent $PSCommandPath
$OpenCodeBin = "$RootDir\opencode\opencode.exe"
$HandyBin = "$RootDir\handy-voice\Handy\handy.exe"

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "🧠 Glitch AI - Launching..." -ForegroundColor Magenta
Write-Host ""

# ── Check prerequisites ──
if (-not (Test-Path $OpenCodeBin)) {
  Write-Host "OpenCode not found. Run bootstrap.ps1 first." -ForegroundColor Red
  Write-Host "Or run: powershell -File bootstrap.ps1" -ForegroundColor Yellow
  exit 1
}

# ── Self-heal: initialize git submodules if needed ──
if (-not (Test-Path "$RootDir\glitch-memorycore\prompt-rules.md")) {
  Write-Host "  Initializing glitch-memorycore submodule..." -ForegroundColor Cyan
  try {
    git submodule update --init --recursive 2>&1 | Out-Null
    if (Test-Path "$RootDir\glitch-memorycore\prompt-rules.md") {
      Write-Host "  glitch-memorycore ready!" -ForegroundColor Green
    } else {
      Write-Host "  WARNING: Could not load glitch-memorycore." -ForegroundColor Yellow
      Write-Host "  Run: git submodule update --init --recursive" -ForegroundColor Yellow
    }
  } catch {
    Write-Host "  WARNING: Could not initialize submodules. Error: $_" -ForegroundColor Yellow
    Write-Host "  OpenCode may not start correctly without memory files." -ForegroundColor Yellow
  }
} else {
  Write-Host "  glitch-memorycore found" -ForegroundColor DarkGreen
}

# ── Ensure Handy portable flag ──
$portableFlag = "$RootDir\handy-voice\Handy\portable"
if (Test-Path $HandyBin) {
  if (-not (Test-Path $portableFlag)) {
    Set-Content -Path $portableFlag -Value "" -NoNewline
  }
}

# ── Normalize backslash paths in session DB ──
try { & "$RootDir\fix-paths.ps1" } catch { }

# ── Validate opencode.json before launch ──
Write-Host "  Validating opencode.json..." -ForegroundColor Cyan
try {
    $configContent = Get-Content "$RootDir\opencode.json" -Raw
    $null = $configContent | ConvertFrom-Json
    Write-Host "  Config is valid JSON" -ForegroundColor DarkGreen
} catch {
    Write-Host "  ERROR: opencode.json is not valid JSON!" -ForegroundColor Red
    Write-Host "  $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Launch was cancelled to prevent a crash." -ForegroundColor Yellow
    Write-Host "  Fix the config or run launch-glitch-safe.bat to enter safe mode." -ForegroundColor Yellow
    exit 1
}

# ── Start Handy (if not already running) ──
$handyProcess = Get-Process -Name "handy" -ErrorAction SilentlyContinue
if (-not $handyProcess) {
  if (Test-Path $HandyBin) {
    Write-Host "  Starting Handy voice input..." -ForegroundColor Cyan
    Start-Process -FilePath $HandyBin -WindowStyle Minimized
    Start-Sleep -Seconds 1
  } else {
    Write-Host "  Handy not found (optional). Voice input disabled." -ForegroundColor DarkYellow
  }
} else {
  Write-Host "  Handy already running" -ForegroundColor DarkGreen
}

# ── Launch OpenCode ──
Write-Host "  Starting OpenCode..." -ForegroundColor Cyan
Write-Host ""

# OpenCode reads opencode.json + tui.json from the current directory automatically
Push-Location $RootDir
try {
  & $OpenCodeBin
} finally {
  Pop-Location
}

# ── Done ──
Write-Host ""
Write-Host "Glitch session ended." -ForegroundColor Magenta
