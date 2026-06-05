@echo off
title Glitch AI
node "%~dp0scripts\launch.mjs"
if %errorlevel% neq 0 (
    echo.
    echo Press any key to exit...
    pause > nul
)
