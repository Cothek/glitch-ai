@echo off
title Glitch Setup - Troy
echo.
echo Glitch AI - Troy Setup
echo =====================
echo.

:: Navigate to script directory
cd /d "%~dp0"

:: Step 1: Initialize engine submodule
echo [1/3] Initializing engine submodule...
git submodule update --init --recursive
if %errorlevel% neq 0 (
    echo FAILED: Could not initialize submodules.
    echo Make sure git is installed and you have network access.
    pause
    exit /b 1
)
echo   Engine ready!
echo.

:: Step 2: Clone user data repo (private - uses cached PAT from Windows Credential Manager)
echo [2/3] Cloning user data...
if exist user\main-memory.md (
    echo   User data already exists - skipping clone.
) else (
    if not exist user mkdir user
    git clone https://cothek@github.com/Cothek/glitch-user-troy.git user
    if %errorlevel% neq 0 (
        echo.
        echo FAILED: Could not clone user data.
        echo Possible issues:
        echo   - No PAT stored in Windows Credential Manager for cothek@github.com
        echo   - No access to the private repository
        echo.
        echo To fix, store a PAT:
        echo   git credential-manager reject https://cothek@github.com
        echo   (then git will prompt you for credentials)
        echo.
        pause
        exit /b 1
    )
    echo   User data cloned!
)
echo.

:: Step 3: Verify
echo [3/3] Verifying setup...
if not exist glitch-memorycore\prompt-rules.md (
    echo WARNING: Engine files not found. Submodule may not be initialized.
) else (
    echo   Engine: OK (glitch-memorycore)
)
if exist user\main-memory.md (
    echo   User: OK (Troy profile loaded)
) else (
    echo   User: NOT FOUND - run setup.ps1 --new-user to create a profile
)
echo.

echo Setup complete! Run launch-glitch.bat to start.
echo.
pause
