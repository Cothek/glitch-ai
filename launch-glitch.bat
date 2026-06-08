@echo off
title Glitch AI
chcp 65001 >nul
type "%~dp0glitch-head.txt"
echo.
node "%~dp0scripts\launch.mjs"
if %errorlevel% neq 0 (
    echo.
    echo Press any key to exit...
    pause > nul
)
