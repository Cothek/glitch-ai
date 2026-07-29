@echo off
REM Glitch Launcher - Switch mode and launch in one command
REM Usage: glitch.bat [mode]
set "LOG_FILE=%~dp0..\data\launch.log"
set "TEMP_OUT=%TEMP%\glitch-launch-output.txt"
echo [%date% %time%] glitch.bat %* >> "%LOG_FILE%" 2>&1
REM Run node, capture output to temp to preserve exit code
node scripts\glitch.mjs %* > "%TEMP_OUT%" 2>&1
set "NODE_EXIT=%errorlevel%"
REM Write cleaned output to log and display
powershell -NoProfile -Command "Get-Content '%TEMP_OUT%' | ForEach-Object { $_ -replace '\x1b\[[\d;?]*[a-zA-Z]','' -replace '[^\x20-\x7E\r\n]','' } | Tee-Object -FilePath '%LOG_FILE%'"
del "%TEMP_OUT%" 2>nul
if %NODE_EXIT% neq 0 (
    echo Glitch exited with code %NODE_EXIT%. Log: %LOG_FILE%
    pause
)