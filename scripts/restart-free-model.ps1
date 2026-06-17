# restart-free-model.ps1 -- Switch free model and restart opencode
# Usage:
#   .\scripts\restart-free-model.ps1 -ModelId "nvidia/z-ai/glm-5.1"
#   .\scripts\restart-free-model.ps1 -ModelId "opencode/deepseek-v4-flash-free" -OldPid 12345
#
# Designed to be launched DETACHED from within a running Glitch session.
# The script launches a new opencode instance FIRST, waits for it to bind,
# then kills the old opencode, and verifies the port ownership.

param(
    [string]$ModelId = "",
    [int]$OldPid = 0,
    [int]$Port = 4100
)

$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Split-Path -Parent $ScriptDir

# --- Save preference if model ID provided ---------------------------------------
if ($ModelId) {
    & "$ScriptDir\switch-model.ps1" -Set $ModelId -Quiet
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to save model preference. Aborting." -ForegroundColor Red
        exit 1
    }
    Write-Host "Preference saved: $ModelId" -ForegroundColor Green
}

# --- Launch new opencode FIRST (detached) ---------------------------------------
Write-Host ""
Write-Host "Launching free mode..." -ForegroundColor Green
Write-Host ""

Start-Process -FilePath "$RootDir\launch-glitch.bat" -WindowStyle Normal

# --- Wait for new instance to bind -----------------------------------------------
Write-Host "Waiting 5 seconds for new instance to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# --- Kill old opencode process --------------------------------------------------
if ($OldPid -gt 0) {
    Write-Host "Stopping old opencode (PID $OldPid)..." -ForegroundColor Yellow
    Stop-Process -Id $OldPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# --- Verify port is free (old process gone, new one should own it) ---------------
$portProcess = netstat -ano 2>$null | findstr ":$Port" | findstr "LISTENING"
if ($portProcess) {
    $pidOnPort = ($portProcess -split '\s+')[-1]
    if ($pidOnPort -eq $OldPid) {
        Write-Host "WARNING: Old process (PID $OldPid) still on port $Port — killing again..." -ForegroundColor Yellow
        Stop-Process -Id $OldPid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    } else {
        Write-Host "Port $Port owned by PID $pidOnPort (new instance)" -ForegroundColor Green
    }
} else {
    Write-Host "Port $Port free — new instance may still be starting" -ForegroundColor Yellow
}