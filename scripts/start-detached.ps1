<#
.SYNOPSIS
    Launches a long-running process detached from the current terminal.
.DESCRIPTION
    The bash tool inside opencode.exe hangs on foreground blocking commands because
    it waits for the child process to exit AND for stdout/stderr to reach EOF.
    A foreground process that spawns children holding stdio handles open blocks
    the agent indefinitely (no timeout).

    This script uses Start-Process with output redirection to detach the child,
    returning immediately with the PID. Use this for ANY long-running or blocking
    command: servers, ComfyUI, test runners, interactive prompts, etc.
.PARAMETER Command
    The full command string to execute (e.g. "python main.py --listen 127.0.0.1").
.PARAMETER LogDir
    Directory for stdout/stderr log files. Defaults to <repoRoot>\data\logs.
.PARAMETER Name
    Label for log file names and PID file. Defaults to "proc".
.PARAMETER PidFile
    Full path to write the PID. Defaults to <LogDir>\<Name>.pid.
.EXAMPLE
    .\scripts\start-detached.ps1 -Command "node server.mjs" -Name "money-dashboard"
#>
param(
    [Parameter(Mandatory=$true)]
    [string]$Command,

    [string]$LogDir,

    [string]$Name = "proc",

    [string]$PidFile
)

# --- Validate command ---
if ([string]::IsNullOrWhiteSpace($Command)) {
    Write-Error "Command cannot be empty"
    exit 1
}

# --- Resolve repo root from script location ---
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

# --- Resolve defaults ---
if (-not $LogDir) {
    $LogDir = Join-Path $RepoRoot "data\logs"
}
if (-not $PidFile) {
    $PidFile = Join-Path $LogDir "$Name.pid"
}

# --- Create LogDir if it doesn't exist ---
if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

# --- Build log paths ---
$OutLog = Join-Path $LogDir "$Name.out.log"
$ErrLog = Join-Path $LogDir "$Name.err.log"

# --- Launch detached ---
# Pass the command as a single element in ArgumentList.
# PS 5.1 joins array elements without re-quoting, so wrapping the full
# command in one string preserves internal spaces and embedded quotes.
$proc = Start-Process -FilePath "powershell.exe" `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog `
    -ArgumentList @("-NoProfile", "-Command", $Command)

# --- Write PID file ---
$childPid = $proc.Id
Set-Content -Path $PidFile -Value $childPid -Encoding UTF8

# --- Output ---
Write-Output "PID=$childPid"
Write-Output "OUT=$OutLog"
Write-Output "ERR=$ErrLog"
Write-Output "PIDFILE=$PidFile"

exit 0
