@echo off
title Glitch AI Setup
cd /d "%~dp0"

echo.
echo Glitch AI - First-Time Setup
echo ============================
echo.

:: Step 1: Initialize engine submodule
echo [1/2] Initializing engine...
git submodule update --init --recursive
if %errorlevel% neq 0 (
    echo.
    echo Could not load the Glitch engine.
    echo Make sure git is installed and you have internet access.
    pause
    exit /b 1
)
echo   Engine ready!
echo.

:: Step 2: Create your user profile
echo [2/2] Setting up your profile...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" --new-user
if %errorlevel% neq 0 (
    echo.
    echo Setup wizard had an issue. Try running this instead:
    echo   powershell -NoProfile -File "%~dp0setup.ps1" --new-user
    pause
    exit /b 1
)

echo.
echo Setup complete! Run launch-glitch.bat to start using Glitch.
echo.
pause
