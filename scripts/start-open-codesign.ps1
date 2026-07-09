param(
  [switch]$Args = $false
)

$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Split-Path -Parent $ScriptDir
$InstallDir = Join-Path $RootDir "data/open-codesign/app"

# Detect install path - check multiple locations
$PathsToCheck = @(
  $InstallDir,
  "${env:LOCALAPPDATA}\Programs\open-codesign",
  "${env:PROGRAMFILES}\open-codesign"
)

$ExePath = $null
foreach ($p in $PathsToCheck) {
  $candidate = Join-Path $p "Open CoDesign.exe"
  if (Test-Path $candidate) { $ExePath = $candidate; break }
  $candidate2 = Join-Path $p "open-codesign.exe"
  if (Test-Path $candidate2) { $ExePath = $candidate2; break }
}

if (-not $ExePath) {
  Write-Host "Open CoDesign is not installed." -ForegroundColor Red
  Write-Host "Run scripts/install-open-codesign.ps1 first." -ForegroundColor Yellow
  Write-Host "Expected at: $InstallDir" -ForegroundColor DarkGray
  exit 1
}

Write-Host "Starting Open CoDesign..." -ForegroundColor Cyan
Write-Host "  Path: $ExePath" -ForegroundColor DarkGray
Start-Process -FilePath $ExePath
