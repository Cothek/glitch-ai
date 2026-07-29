@echo off
cd /d "%~dp0.."
set "LOG_FILE=%~dp0..\data\launch.log"
echo [%date% %time%] Restarting Glitch... >> "%LOG_FILE%" 2>&1
echo Capturing old opencode PID... >> "%LOG_FILE%" 2>&1
for /f "tokens=2" %%a in ('tasklist /fi "imagename eq opencode.exe" /nh 2^>nul') do (
    set OLD_PID=%%a
    goto :HAVE_PID
)
echo No old PID found to kill. >> "%LOG_FILE%" 2>&1
goto :LAUNCH

:HAVE_PID
echo Old PID: %OLD_PID% >> "%LOG_FILE%" 2>&1
echo Killing old opencode (PID %OLD_PID%)... >> "%LOG_FILE%" 2>&1
taskkill /f /pid %OLD_PID% >nul 2>&1
if errorlevel 1 (
    echo Failed to kill PID %OLD_PID% >> "%LOG_FILE%" 2>&1
) else (
    echo Old process killed. >> "%LOG_FILE%" 2>&1
)
timeout /t 2 /nobreak >nul

:LAUNCH
echo Launching new Glitch session... >> "%LOG_FILE%" 2>&1
start "" "launch-glitch.bat"
echo New session launched. >> "%LOG_FILE%" 2>&1