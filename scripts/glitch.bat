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
REM Run node script with live output
"%NODE_CMD%" "%~dp0scripts\glitch.mjs" %*
set "NODE_EXIT=%errorlevel%"
if %NODE_EXIT% neq 0 (
    echo Glitch exited with code %NODE_EXIT%.
    pause
)
exit /b %NODE_EXIT%