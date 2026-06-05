@echo off
title Glitch AI - LOCAL MODE
node "%~dp0scripts\launch-local.mjs" %*
if %errorlevel% neq 0 (
echo.
echo Press any key to exit...
pause > nul
)
