@echo off
title Glitch AI - FREE MODE
node "%~dp0scripts\launch-free.mjs" %*
if %errorlevel% neq 0 (
echo.
echo Press any key to exit...
pause > nul
)
