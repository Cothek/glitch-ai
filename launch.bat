@echo off
title Glitch AI
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1"
if %errorlevel% neq 0 (
    echo.
    echo Press any key to exit...
    pause > nul
)
