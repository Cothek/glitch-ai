@echo off
title Glitch AI - FREE MODE
powershell -NoProfile -Command "Get-Content '%~dp0glitch-head.txt' -Encoding UTF8"
echo.
echo FREE TIER MODE
echo.
node "%~dp0scripts\launch-free.mjs" %*
if %errorlevel% neq 0 (
echo.
echo Press any key to exit...
pause > nul
)
