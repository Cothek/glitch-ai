@echo off
title Glitch AI - FREE MODE
type "%~dp0glitch-head.txt"
echo.
echo FREE TIER MODE
echo.
node "%~dp0scripts\launch-free.mjs" %*
if %errorlevel% neq 0 (
echo.
echo Press any key to exit...
pause > nul
)
