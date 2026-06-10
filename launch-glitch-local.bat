@echo off
title Glitch AI - LOCAL MODE

REM Prefer bundled Node.js; fall back to system node
set "NODE_CMD=node"
if exist "%~dp0data\node\node.exe" (
  set "NODE_CMD=%~dp0data\node\node.exe"
  set "PATH=%~dp0data\node;%PATH%"
)

"%NODE_CMD%" "%~dp0scripts\launch-local.mjs" %*
if %errorlevel% neq 0 (
echo.
echo Press any key to exit...
pause > nul
)
