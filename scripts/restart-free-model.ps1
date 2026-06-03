# restart-free-model.ps1 -- Switch free model and restart opencode
# Usage:
#   .\scripts\restart-free-model.ps1 -ModelId "nvidia/z-ai/glm-5.1"
#   .\scripts\restart-free-model.ps1 -ModelId "opencode/deepseek-v4-flash-free" -OldPid 12345
#
# Designed to be launched DETACHED from within a running Glitch session.
# The script waits for the parent session to end, kills the old opencode,
# then launches a new instance with the chosen model.

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

# --- Wait for parent to fully exit ----------------------------------------------
Write-Host "Waiting for current session to end..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# --- Kill old opencode process --------------------------------------------------
if ($OldPid -gt 0) {
    Write-Host "Stopping old opencode (PID $OldPid)..." -ForegroundColor Yellow
    Stop-Process -Id $OldPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# Also check if anything is still on the port and kill it
$portProcess = netstat -ano 2>$null | findstr ":$Port" | findstr "LISTENING"
if ($portProcess) {
    $pidOnPort = ($portProcess -split '\s+')[-1]
    if ($pidOnPort -and $pidOnPort -ne $OldPid) {
        Write-Host "Killing stale process on port $Port (PID $pidOnPort)..." -ForegroundColor Yellow
        Stop-Process -Id $pidOnPort -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

# --- Launch with new model ------------------------------------------------------
Write-Host ""
Write-Host "Launching free mode..." -ForegroundColor Green
Write-Host ""

& "$ScriptDir\launch-free.ps1"