@echo off
echo Before if
if not exist "%~dp0data\node\node.exe" (
    echo No bundled node found
    where node >nul 2>nul
    if errorlevel 1 (
        echo Would bootstrap here
        echo Inside inner if
    )
)
echo After if
