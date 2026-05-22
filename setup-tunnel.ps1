$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSCommandPath
$Cloudflared = "$RootDir\cloudflared.exe"
$TunnelName = "glitch-ai"
$Hostname = "glitch.cothekdesigns.com"

Write-Host ""
Write-Host "Glitch AI - Cloudflare Tunnel Setup" -ForegroundColor Magenta
Write-Host ""

# Check cloudflared exists
if (-not (Test-Path $Cloudflared)) {
  Write-Host "cloudflared.exe not found. Run bootstrap.ps1 or download manually." -ForegroundColor Red
  exit 1
}

Write-Host "Step 1: Authenticate with Cloudflare" -ForegroundColor Cyan
Write-Host "  This opens a browser window. Log in with your Cloudflare account." -ForegroundColor Gray
Write-Host "  (Select cothekdesigns.com if prompted)" -ForegroundColor Gray
Write-Host ""
& $Cloudflared tunnel login
if ($LASTEXITCODE -ne 0) {
  Write-Host "Authentication failed. Re-run this script." -ForegroundColor Red
  exit 1
}
Write-Host "  Authenticated successfully" -ForegroundColor Green
Write-Host ""

Write-Host "Step 2: Create tunnel '$TunnelName'" -ForegroundColor Cyan
& $Cloudflared tunnel create $TunnelName
if ($LASTEXITCODE -ne 0) {
  Write-Host "Tunnel creation failed. Tunnel may already exist." -ForegroundColor Yellow
  Write-Host "  To delete and recreate: cloudflared tunnel delete $TunnelName" -ForegroundColor Gray
}
Write-Host ""

Write-Host "Step 3: Route DNS" -ForegroundColor Cyan
Write-Host "  Creating DNS record: $Hostname -> tunnel" -ForegroundColor Gray
& $Cloudflared tunnel route dns $TunnelName $Hostname
if ($LASTEXITCODE -ne 0) {
  Write-Host "DNS route may already exist (this is fine)" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Run serve-glitch.ps1 to start the server + tunnel" -ForegroundColor Gray
Write-Host "  2. Visit https://$Hostname" -ForegroundColor Gray
Write-Host ""
