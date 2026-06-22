param(
  [switch]$Headless = $false,
  [string]$Port = "8188"
)

$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Split-Path -Parent $ScriptDir
$ComfyDir = Join-Path $RootDir "data\comfyui\ComfyUI"
$VenvPython = Join-Path $RootDir "data\comfyui\venv\Scripts\python.exe"

# Check ComfyUI exists
if (-not (Test-Path $ComfyDir)) {
  Write-Host "ERROR: ComfyUI not found at $ComfyDir" -ForegroundColor Red
  exit 1
}

# Check venv python exists
if (-not (Test-Path $VenvPython)) {
  Write-Host "ERROR: venv python not found at $VenvPython" -ForegroundColor Red
  exit 1
}

$headlessArg = if ($Headless) { "--headless" } else { "" }

# Launch ComfyUI in detached PowerShell window (R10 process isolation)
$proc = Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -PassThru -ArgumentList "-NoProfile", "-Command", "& '$VenvPython' -u '$ComfyDir\main.py' --listen 127.0.0.1 --port $Port --highvram $headlessArg"
Write-Output "ComfyUI started with PID=$($proc.Id)"

# Write PID file
$pidFile = Join-Path $RootDir "data\comfyui\comfyui.pid"
Set-Content -Path $pidFile -Value $proc.Id -Encoding UTF8

# Wait and verify
Start-Sleep -Seconds 5

try {
  $null = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
  Write-Output "ComfyUI ready at http://127.0.0.1:$Port"
} catch {
  Write-Output "ComfyUI may not be ready yet — check $RootDir\data\comfyui\comfyui.log"
}
