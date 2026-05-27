# ttyd Configuration
$TTYD_BIN = "E:\Glitch AI\glitch-ai\ttyd\ttyd.exe"
$OPENCODE_BIN = "E:\Glitch AI\glitch-ai\opencode\opencode.exe"
$TTYD_PORT = 4104
$ROOT_DIR = "E:\Glitch AI\glitch-ai"
$PASSWORD_FILE = "$ROOT_DIR\.server-password"

# Read password
$password = ""
if (Test-Path $PASSWORD_FILE) {
  $password = Get-Content $PASSWORD_FILE -Raw | ForEach-Object { $_.Trim() }
}
if (-not $password) {
  $password = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 16 | ForEach-Object { [char]$_ })
  Set-Content -Path $PASSWORD_FILE -Value $password -NoNewline
  # Lock down the file
  & icacls $PASSWORD_FILE /inheritance:r /grant "${env:USERNAME}:R" 2>&1 | Out-Null
}

Write-Host ""
Write-Host "ttyd Terminal Server" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Port: $TTYD_PORT"
Write-Host "  URL: http://localhost:$TTYD_PORT/terminal"
Write-Host "  Password: $password"
Write-Host ""

# Start ttyd with opencode as the command
Write-Host "  Starting ttyd..." -ForegroundColor Cyan

Push-Location $ROOT_DIR
try {
  & $TTYD_BIN `
    --port $TTYD_PORT `
    --credential "opencode:$password" `
    --max-clients 3 `
    --once `
    --ping-interval 10 `
    $OPENCODE_BIN
} finally {
  Pop-Location
}

Write-Host "ttyd stopped." -ForegroundColor Cyan
