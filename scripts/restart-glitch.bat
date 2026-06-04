@echo off
cd /d "E:\Glitch AI\glitch-ai"
echo Capturing old opencode PID...
for /f "tokens=2" %%a in ('tasklist /fi "imagename eq opencode.exe" /nh 2^>nul') do (
    set OLD_PID=%%a
    goto :HAVE_PID
)
echo No old PID found to kill.
goto :LAUNCH

:HAVE_PID
echo Old PID: %OLD_PID%
echo Killing old opencode (PID %OLD_PID%)...
taskkill /f /pid %OLD_PID% >nul 2>&1
if errorlevel 1 (
    echo Failed to kill PID %OLD_PID%
) else (
    echo Old process killed.
)
timeout /t 2 /nobreak >nul

:LAUNCH
echo Launching new Glitch session...
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Normal -File "scripts\launch-free.ps1"
echo New session launched.