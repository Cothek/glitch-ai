@echo off
title Glitch AI Server
type "%~dp0glitch-head.txt"
echo.
echo Starting server...
echo.
node "%~dp0scripts\serve.mjs"
if %errorlevel% neq 0 (
    echo.
    echo Press any key to exit...
    pause > nul
)
