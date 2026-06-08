@echo off
title Glitch AI - SAFE MODE
chcp 65001 >nul
type "%~dp0glitch-head.txt"
echo.
echo 🛟 Glitch AI - Safe Mode
echo.
echo This starts Glitch with a minimal configuration so you can
echo fix any problems with the main config.
echo.
echo Your current opencode.json will be backed up as opencode.json.bak
echo and restored when safe mode exits.
echo.
echo Press any key to continue...
pause > nul

node "%~dp0scripts\launch-safe.mjs"
if %errorlevel% neq 0 (
    echo.
    echo Safe mode exited.
    pause > nul
)
