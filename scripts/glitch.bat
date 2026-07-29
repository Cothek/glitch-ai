@echo off
REM Glitch Launcher - Switch mode and launch in one command
REM Usage: glitch.bat [mode]
set "LOG_FILE=%~dp0..\data\launch.log"
echo [%date% %time%] glitch.bat %* >> "%LOG_FILE%" 2>&1
REM Run node script, tee to both console and log, strip ANSI codes from log
node scripts\glitch.mjs %* 2>&1 | powershell -NoProfile -Command "$input | ForEach-Object { $_ -replace '\x1b\[[0-9;]*m', '' } | Tee-Object -FilePath '%LOG_FILE%'"
if errorlevel 1 (
    echo Glitch exited with an error. Log: %LOG_FILE%
    pause
)