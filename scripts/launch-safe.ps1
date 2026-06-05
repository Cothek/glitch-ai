$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Split-Path -Parent $ScriptDir
$OpenCodeBin = "$RootDir\opencode\opencode.exe"
$ConfigPath = "$RootDir\opencode.json"
$TemplatePath = "$RootDir\config\opencode-safe.json"
$BackupDir = "$RootDir\data\backups"
$ModeFile = "$BackupDir\.last-mode"

# ---- Prepend bundled Node to PATH if available ----
$BundledNode = "$PSScriptRoot\..\data\node"
if (Test-Path "$BundledNode\node.exe") {
  $env:PATH = "$BundledNode;$env:PATH"
}

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host " Glitch AI - Safe Mode" -ForegroundColor Cyan
Write-Host ""

# Check opencode exists
if (-not (Test-Path $OpenCodeBin)) {
    Write-Host " OpenCode not found. Run bootstrap.ps1 first." -ForegroundColor Red
    exit 1
}

# Backup previous config (timestamped, never overwritten)
if (Test-Path $ConfigPath) {
    if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null }
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupFile = "$BackupDir\opencode-$timestamp.json"
    Copy-Item $ConfigPath $backupFile -Force
    Write-Host "  Previous config backed up -> data\backups\opencode-$timestamp.json" -ForegroundColor DarkGray
}

# Check template exists
if (-not (Test-Path $TemplatePath)) {
    Write-Host "  ERROR: Safe mode template not found at config\opencode-safe.json" -ForegroundColor Red
    Write-Host "  Try cloning the repo again or restoring from backup." -ForegroundColor Yellow
    exit 1
}

# Copy template to opencode.json (no instruction injection needed - safe mode has no sub-agents)
Write-Host "  Loading safe mode config..." -ForegroundColor Cyan
Copy-Item $TemplatePath $ConfigPath -Force
Write-Host "  Safe mode config loaded." -ForegroundColor DarkGreen

# Write mode marker
$modeInfo = @{
    mode = "safe"
    timestamp = (Get-Date).ToString("o")
    model = "opencode-go/deepseek-v4-flash"
} | ConvertTo-Json
$modeInfo | Out-File -FilePath $ModeFile -Encoding utf8 -Force

# Launch opencode
Write-Host ""
Write-Host "  Starting OpenCode in safe mode..." -ForegroundColor Cyan
Write-Host "  Current config saved to data/backups/ with timestamp."
Write-Host "  When you're done fixing, exit normally and launch normally."
Write-Host ""
Write-Host "  NOTE: Safe mode is a diagnostic shell. Fix the actual issue in:"
Write-Host "    - The normal template: config/opencode-normal.json (config problems)"
Write-Host "    - Engine files: glitch-memorycore/ (prompt/skill problems)"
Write-Host "    - Agent files: .opencode/agents/ (agent definition problems)"
Write-Host "    - Your git branch (if switching branches fixes the issue)"
Write-Host ""

Push-Location $RootDir
try {
    & $OpenCodeBin
} catch {
    Write-Host "  OpenCode exited with error: $_" -ForegroundColor Red
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Safe mode ended." -ForegroundColor Cyan
