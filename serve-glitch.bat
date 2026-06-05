@echo off
title Glitch AI Server
node "%~dp0scripts\serve.mjs"
if %errorlevel% neq 0 (
    echo.
    echo Press any key to exit...
    pause > nul
)
