<#
.SYNOPSIS
    Launches a long-running process detached from the current terminal.
.DESCRIPTION
    The bash tool inside opencode.exe hangs on foreground blocking commands because
    it waits for the child process to exit AND for stdout/stderr to reach EOF.
    A foreground process that spawns children holding stdio handles open blocks
    the agent indefinitely (no timeout).

    This script uses Win32 CreateProcess with CREATE_BREAKAWAY_FROM_JOB to
    truly detach the child from the caller's Job Object, returning immediately
    with the PID. A temporary .cmd script is used to avoid nested quoting issues.
    Without this flag, all child processes are placed in the caller's Job Object
    and killed when the bash session ends. Use this for ANY long-running or
    blocking command: servers, ComfyUI, test runners, etc.
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

# --- Win32 helper to break away from Job Object ---
# On Windows, ALL child processes created via CreateProcess are placed in the
# caller's Job Object. When opencode's bash session ends, it terminates the
# Job Object, killing all descendants — even with UseShellExecute=true.
# The ONLY way to truly detach is CREATE_BREAKAWAY_FROM_JOB (0x01000000).
if (-not ([System.Management.Automation.PSTypeName]'NativeProcess').Type) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class NativeProcess
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    const uint CREATE_BREAKAWAY_FROM_JOB = 0x01000000;
    const uint CREATE_NO_WINDOW = 0x08000000;

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcess(
        string lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr hObject);

    /// <summary>
    /// Creates a process that breaks away from the caller's Job Object.
    /// Returns the new process ID, or 0 on failure.
    /// </summary>
    public static uint CreateDetachedProcess(string commandLine)
    {
        var si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(si);

        // Redirect stdout/stderr to files INSIDE the command string so we
        // don't need STARTF_USESTDHANDLES (which would require handle setup).
        // The caller is responsible for appending 1>"..." 2>"..." to commandLine.

        var pi = new PROCESS_INFORMATION();
        uint flags = CREATE_BREAKAWAY_FROM_JOB | CREATE_NO_WINDOW;

        bool ok = CreateProcess(
            null,
            commandLine,
            IntPtr.Zero,
            IntPtr.Zero,
            false,
            flags,
            IntPtr.Zero,
            null,
            ref si,
            out pi);

        if (!ok)
            return 0;

        // Close the handles we don't need — the process runs independently.
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);

        return pi.dwProcessId;
    }
}
"@
}

# --- Launch detached (break away from Job Object) ---
# On Windows, ALL child processes created via CreateProcess are placed in the
# caller's Job Object. When opencode's bash session ends, it terminates the
# Job Object, killing all descendants. The ONLY way to truly detach is
# CREATE_BREAKAWAY_FROM_JOB (0x01000000) via the Win32 CreateProcess API.
#
# We write a temporary .cmd script to avoid nested quoting issues, then call
# CreateProcess on cmd.exe with CREATE_BREAKAWAY_FROM_JOB.
$cmdScript = Join-Path $LogDir "$Name-detach.cmd"
# NOTE: We do NOT escape double-quotes in $Command. In a .cmd file (unlike
# cmd /c "..."), "" does NOT produce a literal quote — it's parsed as an
# empty quoted string followed by unquoted text, which strips the command's
# own quoting. Raw double-quotes in .cmd files are passed through correctly
# by cmd.exe to the child process. The only edge case is backslash-quotes
# (\"), which cmd.exe doesn't escape — but "" doesn't fix that either.
$cmdContent = "@echo off`r`n$Command 1> `"$OutLog`" 2> `"$ErrLog`""
[System.IO.File]::WriteAllText($cmdScript, $cmdContent,
    (New-Object System.Text.UTF8Encoding($false)))

$childPid = [NativeProcess]::CreateDetachedProcess("cmd.exe /c `"$cmdScript`"")
if ($childPid -eq 0) {
    Write-Error "Failed to create detached process (Win32 error: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
    Remove-Item $cmdScript -ErrorAction SilentlyContinue
    exit 1
}
Set-Content -Path $PidFile -Value $childPid -Encoding UTF8
# Brief pause so cmd.exe has time to open and read the .cmd file before we
# delete it. CreateProcess returns the PID before the child has necessarily
# opened its script file; without this sleep the Remove-Item races with
# cmd.exe's file-open, causing silent execution failure.
Start-Sleep -Milliseconds 500
Remove-Item $cmdScript -ErrorAction SilentlyContinue

# --- Output ---
Write-Output "PID=$childPid"
Write-Output "OUT=$OutLog"
Write-Output "ERR=$ErrLog"
Write-Output "PIDFILE=$PidFile"

exit 0
