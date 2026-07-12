@echo off
title Glitch AI - Unified Launcher

REM Prefer bundled Node.js; fall back to system node
set "NODE_CMD=node"
if exist "%~dp0data\node\node.exe" (
  set "NODE_CMD=%~dp0data\node\node.exe"
  set "PATH=%~dp0data\node;%PATH%"
)

if exist "%~dp0glitch-head.txt" powershell -NoProfile -Command "Get-Content '%~dp0glitch-head.txt' -Encoding UTF8"
echo.
"%NODE_CMD%" "%~dp0scripts\launch-unified.mjs" %*
if %errorlevel% neq 0 (
    echo.
    echo Press any key to exit...
    pause > nul
)
