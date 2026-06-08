@echo off
title Glitch AI Server
powershell -NoProfile -Command "Get-Content '%~dp0glitch-head.txt' -Encoding UTF8"
echo.
echo Starting server...
echo.
node "%~dp0scripts\serve.mjs"
if %errorlevel% neq 0 (
    echo.
    echo Press any key to exit...
    pause > nul
)
