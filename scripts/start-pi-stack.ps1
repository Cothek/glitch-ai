<#
.SYNOPSIS
    Starts the Pi remote-access stack: pi-web-ui (8787) + auth proxy (4103).
.DESCRIPTION
    Launches both processes detached from this terminal (survives shell exit):
      1. pi-web-ui   - binds 0.0.0.0:8787, workspace = repo root
      2. auth-proxy  - localhost:4103 -> 8787, Basic auth via .server-password

    The Cloudflare tunnel routes pi.cothekdesigns.com -> localhost:4103.
    Re-running is safe: skips any layer that is already listening.
.EXAMPLE
    .\scripts\start-pi-stack.ps1
    .\scripts\start-pi-stack.ps1 -Status    # check only, dont start
#>
param(
    [switch]$Status
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$NodeExe = Join-Path $RootDir "data\node\node.exe"
$AuthProxy = Join-Path $RootDir "plugins\auth-proxy.mjs"
$LauncherCmd = Join-Path $env:USERPROFILE "pi-web-ui-launcher.cmd"
$LogDir = Join-Path $RootDir "data\logs"

function Test-Port([int]$Port) {
    $conn = netstat -ano | Select-String ":$Port\s" | Select-String "LISTENING"
    return [bool]$conn
}

function Get-Status {
    [pscustomobject]@{
        PiWebUi   = Test-Port 8787
        AuthProxy = Test-Port 4103
    }
}

$stackStatus = Get-Status
if ($Status) {
    Write-Host "Pi stack status:"
    Write-Host "  pi-web-ui  (8787): $(if ($stackStatus.PiWebUi) {'UP'} else {'DOWN'})"
    Write-Host "  auth-proxy (4103): $(if ($stackStatus.AuthProxy) {'UP'} else {'DOWN'})"
    exit 0
}

if (-not (Test-Path $LauncherCmd)) {
    Write-Error "Missing launcher: $LauncherCmd"
    exit 1
}

# 1. pi-web-ui
if ($stackStatus.PiWebUi) {
    Write-Host "pi-web-ui already UP on :8787 (skipping)"
} else {
    Write-Host "Starting pi-web-ui on 0.0.0.0:8787..."
    & (Join-Path $RootDir "scripts\start-detached.ps1") -Command $LauncherCmd -Name "pi-web-ui"
    Start-Sleep -Seconds 5
}

# 2. auth proxy (4103 -> 8787)
if (-not (Test-Path $NodeExe)) { $NodeExe = "node" }
if ($stackStatus.AuthProxy) {
    Write-Host "auth-proxy already UP on :4103 (skipping)"
} else {
    if (-not (Test-Path (Join-Path $RootDir ".server-password"))) {
        Write-Error ".server-password not found - auth proxy cannot start"
        exit 1
    }
    Write-Host "Starting auth-proxy on :4103 -> :8787..."
    $cmd = "`"$NodeExe`" `"$AuthProxy`" 4103 http://localhost:8787"
    & (Join-Path $RootDir "scripts\start-detached.ps1") -Command $cmd -Name "auth-proxy-pi"
    Start-Sleep -Seconds 3
}

# Verify
$stackStatus = Get-Status
Write-Host ""
Write-Host "Result:"
Write-Host "  pi-web-ui  (8787): $(if ($stackStatus.PiWebUi) {'UP'} else {'DOWN'})"
Write-Host "  auth-proxy (4103): $(if ($stackStatus.AuthProxy) {'UP'} else {'DOWN'})"
if ($stackStatus.PiWebUi -and $stackStatus.AuthProxy) {
    Write-Host ""
    Write-Host "URLs:"
    Write-Host "  Local:  http://localhost:8787"
    Write-Host "  Remote: https://pi.cothekdesigns.com  (auth via .server-password)"
    exit 0
} else {
    Write-Error "One or more layers failed to start - check $LogDir\*.err.log"
    exit 1
}
