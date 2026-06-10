@echo off
title Glitch AI Server

REM Prefer bundled Node.js; fall back to system node
set "NODE_CMD=node"
if exist "%~dp0data\node\node.exe" (
  set "NODE_CMD=%~dp0data\node\node.exe"
  set "PATH=%~dp0data\node;%PATH%"
)

powershell -NoProfile -Command "Get-Content '%~dp0glitch-head.txt' -Encoding UTF8"
echo.
echo Starting server...
echo.
"%NODE_CMD%" "%~dp0scripts\serve.mjs"
if %errorlevel% neq 0 (
    echo.
    echo Press any key to exit...
    pause > nul
)
