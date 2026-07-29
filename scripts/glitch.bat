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
REM Run node via PowerShell for live console output + exit code capture
powershell -NoProfile -Command "& { '%NODE_CMD%' '%~dp0scripts\glitch.mjs' %* 2>&1 | Tee-Object -FilePath '%TEMP%\glitch-raw-launch.log'; exit $LASTEXITCODE }"
set "NODE_EXIT=%errorlevel%"
REM Clean raw log: strip ANSI + non-ASCII, append to final log
powershell -NoProfile -Command "Get-Content '%TEMP%\glitch-raw-launch.log' | ForEach-Object { $_ -replace '\x1b\[[\d;?]*[a-zA-Z]','' -replace '[^\x20-\x7E\r\n]','' } | Out-File -FilePath '%LOG_FILE%' -Append"
del "%TEMP%\glitch-raw-launch.log" 2>nul
if %NODE_EXIT% neq 0 (
    echo Glitch exited with code %NODE_EXIT%. Log: %LOG_FILE%
    pause
)
exit /b %NODE_EXIT%