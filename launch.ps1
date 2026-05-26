$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSCommandPath
$OpenCodeBin = "$RootDir\opencode\opencode.exe"
$HandyBin = "$RootDir\handy-voice\Handy\handy.exe"

Write-Host ""
Write-Host "🧠 Glitch AI - Launching..." -ForegroundColor Magenta
Write-Host ""

# ── Check prerequisites ──
if (-not (Test-Path $OpenCodeBin)) {
  Write-Host "OpenCode not found. Run bootstrap.ps1 first." -ForegroundColor Red
  Write-Host "Or run: powershell -File bootstrap.ps1" -ForegroundColor Yellow
  exit 1
}

# ── Ensure Handy portable flag ──
$portableFlag = "$RootDir\handy-voice\Handy\portable"
if (Test-Path $HandyBin) {
  if (-not (Test-Path $portableFlag)) {
    Set-Content -Path $portableFlag -Value "" -NoNewline
  }
}

# ── Normalize backslash paths in session DB ──
& "$RootDir\fix-paths.ps1"

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
