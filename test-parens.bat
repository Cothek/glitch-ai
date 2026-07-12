@echo off
if not exist "%~dp0data\node\node.exe" (
    where node >nul 2>nul
    if errorlevel 1 (
        echo Bootstrapping Glitch (first-time setup) with parens...
    )
)
echo Done
