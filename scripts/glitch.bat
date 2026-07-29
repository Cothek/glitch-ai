@echo off
REM Glitch Launcher - Switch mode and launch in one command
REM Usage: glitch.bat [mode]
set "LOG_FILE=%~dp0..\data\launch.log"
echo [%date% %time%] glitch.bat %* >> "%LOG_FILE%" 2>&1
node scripts\glitch.mjs %* >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
    echo Glitch exited with an error. Log: %LOG_FILE%
    pause
)