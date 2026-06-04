# restart-glitch.ps1 -- Kills old opencode and launches free mode
# Designed to be launched via schtasks for complete independence

$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Split-Path -Parent $ScriptDir

Start-Sleep -Seconds 4

# Kill any running opencode
$procs = Get-Process -Name "opencode" -ErrorAction SilentlyContinue
foreach ($p in $procs) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2

# Launch free mode
& "$ScriptDir\launch-free.ps1"