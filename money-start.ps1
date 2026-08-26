$ErrorActionPreference = 'Continue'
$log = 'E:\Glitch AI\glitch-ai\data\money-start.log'
function W($m) { Write-Host $m; $m | Out-File -FilePath $log -Append -Encoding utf8 }
W '=== money dashboard start ==='

# 1. Check port 4110 first
$listening = Get-NetTCPConnection -LocalPort 4110 -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  W ('port 4110 ALREADY listening by PID ' + $listening[0].OwningProcess)
} else {
  # 2. Regenerate the launcher ps1 (idempotent, mirrors startMoneyDashboard)
  $ps1Path = 'E:\Glitch AI\glitch-ai\data\money-dashboard-window.ps1'
  $moneyDir = 'E:\Glitch AI\code\glitch-money'
  $title = 'Glitch: money-dashboard (port 4110)'
  $inner = "& { `$host.ui.RawUI.WindowTitle = '$title'; Set-Location -LiteralPath '$moneyDir'; & node dashboard/server.mjs --seed }"
  $innerEsc = $inner.Replace("'", "''")
  $pidPath = 'E:\Glitch AI\glitch-ai\data\money-dashboard.pid'
  $content = "`$proc = Start-Process powershell.exe -WindowStyle Normal -PassThru -ArgumentList @('-NoExit','-ExecutionPolicy','Bypass','-Command', '$innerEsc')`r`nif (`$proc) { `$proc.Id | Out-File -FilePath '$pidPath' -Encoding ascii }`r`n"
  Set-Content -Path $ps1Path -Value $content -Encoding UTF8 -Force
  W ('ps1 written: ' + $ps1Path)

  # 3. Launch visible window (this opens a window on Troy's screen - expected)
  $launcher = Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$ps1Path) -PassThru
  W ('launcher PID: ' + $launcher.Id)

  # 4. Wait up to 15s for port 4110
  $ok = $false
  for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    if (Get-NetTCPConnection -LocalPort 4110 -State Listen -ErrorAction SilentlyContinue) { $ok = $true; W ('port 4110 UP after ' + ($i+1) + 's'); break }
  }
  if (-not $ok) { W 'WARNING: port 4110 did not come up within 15s' }
}

# 5. Verify endpoints
try { $code = & curl.exe -s -o NUL -w '%{http_code}' http://localhost:4110/; W ('dashboard direct status: ' + $code) } catch { W ('direct curl failed: ' + $_) }
try { $code = & curl.exe -s -o NUL -w '%{http_code}' http://localhost:4100/money/; W ('proxy /money status (no auth): ' + $code) } catch { W ('proxy curl failed: ' + $_) }
W '=== done ==='
