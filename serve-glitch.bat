@echo off
title Glitch AI Server
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\serve-glitch.ps1"
if %errorlevel% neq 0 (
    echo.
    echo Press any key to exit...
    pause > nul
)
