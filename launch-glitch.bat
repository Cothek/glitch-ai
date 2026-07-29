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

if exist "%~dp0glitch-head.txt" powershell -NoProfile -Command "Get-Content '%~dp0glitch-head.txt' -Encoding UTF8"
echo.
set "LOG_FILE=%~dp0data\launch.log"
REM Create data directory if needed
if not exist "%~dp0data" mkdir "%~dp0data"
echo [%date% %time%] Glitch starting... > "%LOG_FILE%"
REM Run node script, tee to both console and log, strip ANSI codes from log
"%NODE_CMD%" "%~dp0scripts\launch-unified.mjs" %* 2>&1 | powershell -NoProfile -Command "$input | ForEach-Object { $_ -replace '\x1b\[[0-9;]*m', '' } | Tee-Object -FilePath '%LOG_FILE%'"
if %errorlevel% neq 0 (
    echo.
    echo Glitch exited with an error. Log saved to: %LOG_FILE%
    echo.
    echo Press any key to exit...
    pause > nul
)
