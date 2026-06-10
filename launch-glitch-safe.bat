@echo off
title Glitch AI - SAFE MODE

REM Prefer bundled Node.js; fall back to system node
set "NODE_CMD=node"
if exist "%~dp0data\node\node.exe" (
  set "NODE_CMD=%~dp0data\node\node.exe"
  set "PATH=%~dp0data\node;%PATH%"
)

powershell -NoProfile -Command "Get-Content '%~dp0glitch-head.txt' -Encoding UTF8"
echo.
echo Glitch AI - Safe Mode
echo.
echo This starts Glitch with a minimal configuration so you can
echo fix any problems with the main config.
echo.
echo Your current opencode.json will be backed up as opencode.json.bak
echo and restored when safe mode exits.
echo.
echo Press any key to continue...
pause > nul

"%NODE_CMD%" "%~dp0scripts\launch-safe.mjs"
if %errorlevel% neq 0 (
    echo.
    echo Safe mode exited.
    pause > nul
)
