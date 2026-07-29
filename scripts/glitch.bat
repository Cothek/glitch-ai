@echo off
REM Glitch Launcher - Switch mode and launch in one command
REM Usage: glitch.bat [mode]
set "LOG_FILE=%~dp0..\data\launch.log"
set "NODE_CMD=node"
if exist "%~dp0..\data\node\node.exe" (
  set "NODE_CMD=%~dp0..\data\node\node.exe"
  set "PATH=%~dp0..\data\node;%PATH%"
)
echo [%date% %time%] glitch.bat %* >> "%LOG_FILE%" 2>&1
REM Add bundled MinGit to PATH if present
if exist "%~dp0..\data\mingit\cmd\git.exe" (
  set "PATH=%~dp0..\data\mingit\cmd;%PATH%"
)
REM Run node script, capture output to temp file for log + exit code
"%NODE_CMD%" "%~dp0scripts\glitch.mjs" %* > "%TEMP%\glitch-launch-output.txt" 2>&1
set "NODE_EXIT=%errorlevel%"
type "%TEMP%\glitch-launch-output.txt"
powershell -NoProfile -Command "Get-Content '%TEMP%\glitch-launch-output.txt' | ForEach-Object { $_ -replace '\x1b\[[\d;?]*[a-zA-Z]','' -replace '[^\x20-\x7E\r\n]','' } | Out-File -FilePath '%LOG_FILE%' -Append"
del "%TEMP%\glitch-launch-output.txt" 2>nul
if %NODE_EXIT% neq 0 (
    echo Glitch exited with code %NODE_EXIT%. Log: %LOG_FILE%
    pause
)
exit /b %NODE_EXIT%