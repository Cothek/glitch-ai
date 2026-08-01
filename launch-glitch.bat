@echo off
title Glitch AI - Unified Launcher

REM ---- Branch pre-check: escape hatch to switch to main BEFORE anything else ----
setlocal EnableDelayedExpansion
set "GLITCH_REPO_DIR=%~dp0"
if "%GLITCH_REPO_DIR:~-1%"=="\" set "GLITCH_REPO_DIR=%GLITCH_REPO_DIR:~0,-1%"
set "GLITCH_BRANCH_OK="
git -C "!GLITCH_REPO_DIR!" symbolic-ref --short HEAD >nul 2>nul
if errorlevel 1 goto :branch_check_done
for /f "usebackq delims=" %%B in (`git -C "!GLITCH_REPO_DIR!" symbolic-ref --short HEAD 2^>nul`) do set "GLITCH_CURRENT_BRANCH=%%B"
if "!GLITCH_CURRENT_BRANCH!"=="main" (
  set "GLITCH_BRANCH_OK=0"
  goto :branch_check_done
)

echo.
echo   !! Currently on branch '!GLITCH_CURRENT_BRANCH!', not 'main'
echo   Glitch is designed to run from the main branch for stability.
echo   [Y/n] Switch to main now (recommended)^?
set "GLITCH_BRANCH_CHOICE="
set /p "GLITCH_BRANCH_CHOICE=  > "

if /i "!GLITCH_BRANCH_CHOICE!"=="n" (
  set "GLITCH_BRANCH_OK=1"
  goto :branch_check_done
)
if /i "!GLITCH_BRANCH_CHOICE!"=="no" (
  set "GLITCH_BRANCH_OK=1"
  goto :branch_check_done
)

echo   Checking out main...
git -C "!GLITCH_REPO_DIR!" rev-parse --verify main >nul 2>nul
if errorlevel 1 (
  echo   main branch not found locally, fetching...
  git -C "!GLITCH_REPO_DIR!" remote set-branches origin "*" >nul 2>nul
  git -C "!GLITCH_REPO_DIR!" fetch origin main >nul 2>nul
)

for /f "usebackq delims=" %%S in (`git -C "!GLITCH_REPO_DIR!" status --porcelain 2^>nul`) do set "GLITCH_DIRTY=1"
if "!GLITCH_DIRTY!"=="1" (
  echo   Stashing local changes...
  git -C "!GLITCH_REPO_DIR!" stash push -m "glitch-auto-stash: !GLITCH_CURRENT_BRANCH!" >nul 2>nul
)

git -C "!GLITCH_REPO_DIR!" checkout main >nul 2>nul
if errorlevel 1 (
  echo   WARNING: Failed to switch to main. Continuing on '!GLITCH_CURRENT_BRANCH!'...
  set "GLITCH_BRANCH_OK=1"
  goto :branch_check_done
)
echo   Switched to main.
set "GLITCH_BRANCH_OK=0"

:branch_check_done
endlocal & set "GLITCH_BRANCH_OK=%GLITCH_BRANCH_OK%"

REM Auto-bootstrap if Node.js not available - neither bundled nor system
if not exist "%~dp0data\node\node.exe" (
    where node >nul 2>nul
    if errorlevel 1 (
        echo Bootstrapping Glitch ^(first-time setup - downloading Node.js^)...
        powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap.ps1"
        echo.
        if not exist "%~dp0data\node\node.exe" (
            echo Bootstrap failed - Node.js still missing. Please install Node.js manually.
            pause
            exit /b 1
        )
    )
)

REM Prefer bundled Node.js; fall back to system node
set "NODE_CMD=node"
if exist "%~dp0data\node\node.exe" (
  set "NODE_CMD=%~dp0data\node\node.exe"
  set "PATH=%~dp0data\node;%PATH%"
)

REM Add bundled MinGit to PATH if present
if exist "%~dp0data\mingit\cmd\git.exe" (
  set "PATH=%~dp0data\mingit\cmd;%PATH%"
)

if exist "%~dp0glitch-head.txt" powershell -NoProfile -Command "Get-Content '%~dp0glitch-head.txt' -Encoding UTF8"
echo.
set "LOG_FILE=%~dp0data\launch.log"
if not exist "%~dp0data" mkdir "%~dp0data"
echo [%date% %time%] Glitch starting... > "%LOG_FILE%"
echo [%date% %time%] Args: %* >> "%LOG_FILE%"
REM Run node script with live output
"%NODE_CMD%" "%~dp0scripts\launch-unified.mjs" %*
set "NODE_EXIT=%errorlevel%"
if %NODE_EXIT% neq 0 (
    echo [%date% %time%] Glitch exited with code %NODE_EXIT% >> "%LOG_FILE%"
    echo.
    echo Glitch exited with code %NODE_EXIT%.
    echo.
    echo Press any key to exit...
    pause > nul
)
exit /b %NODE_EXIT%
