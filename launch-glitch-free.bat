@echo off
title Glitch AI - FREE MODE
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-free.ps1" %*
if %errorlevel% neq 0 (
echo.
echo Press any key to exit...
pause > nul
)
