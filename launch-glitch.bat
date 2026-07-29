@echo off
title Glitch AI - Unified Launcher

REM Auto-bootstrap if Node.js not available - neither bundled nor system
if not exist "%~dp0data\node\node.exe" (
    where node >nul 2>nul
    if errorlevel 1 (
        echo Bootstrapping Glitch ^(first-time setup - downloading Node.js^)...
        powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap.ps1"
        echo.
        if not exist "%~dp0data\node\node.exe" (
            echo Bootstrap failed - Node.js still missing. Please install Node.js manually.
            pause
            exit /b 1
        )
    )
)

REM Prefer bundled Node.js; fall back to system node
set "NODE_CMD=node"
if exist "%~dp0data\node\node.exe" (
  set "NODE_CMD=%~dp0data\node\node.exe"
  set "PATH=%~dp0data\node;%PATH%"
)

REM Add bundled MinGit to PATH if present
if exist "%~dp0data\mingit\cmd\git.exe" (
  set "PATH=%~dp0data\mingit\cmd;%PATH%"
)

if exist "%~dp0glitch-head.txt" powershell -NoProfile -Command "Get-Content '%~dp0glitch-head.txt' -Encoding UTF8"
echo.
set "LOG_FILE=%~dp0data\launch.log"
if not exist "%~dp0data" mkdir "%~dp0data"
echo [%date% %time%] Glitch starting... > "%LOG_FILE%"
REM Run node via PowerShell for live console output + exit code capture
powershell -NoProfile -Command "& { '%NODE_CMD%' '%~dp0scripts\launch-unified.mjs' %* 2>&1 | Tee-Object -FilePath '%TEMP%\glitch-raw-launch.log'; exit $LASTEXITCODE }"
set "NODE_EXIT=%errorlevel%"
REM Clean raw log: strip ANSI + non-ASCII, append to final log
powershell -NoProfile -Command "Get-Content '%TEMP%\glitch-raw-launch.log' | ForEach-Object { $_ -replace '\x1b\[[\d;?]*[a-zA-Z]','' -replace '[^\x20-\x7E\r\n]','' } | Out-File -FilePath '%LOG_FILE%' -Append"
del "%TEMP%\glitch-raw-launch.log" 2>nul
if %NODE_EXIT% neq 0 (
    echo.
    echo Glitch exited with code %NODE_EXIT%. Log saved to: %LOG_FILE%
    echo.
    echo Press any key to exit...
    pause > nul
)
exit /b %NODE_EXIT%
