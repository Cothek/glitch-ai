@echo off
cd /d "E:\Glitch AI\glitch-ai"
echo Capturing old opencode PID...
for /f "skip=1 tokens=1" %%a in ('tasklist /fi "imagename eq opencode.exe" /nh 2^>nul') do (
    if not defined OLD_PID set OLD_PID=%%a
)
echo Old PID: %OLD_PID%
echo Launching new Glitch session in new window...
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Normal -File "scripts\launch-free.ps1"
echo New session launched. Waiting 5s...
timeout /t 5 /nobreak >nul
if defined OLD_PID (
    echo Killing old opencode (PID %OLD_PID%)...
    taskkill /f /pid %OLD_PID% >nul 2>&1
    echo Done.
) else (
    echo No old PID found to kill.
)