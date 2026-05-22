$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSCommandPath
$HistoryDir = "$RootDir\.opencode\session-history"
$HistoryFile = "$HistoryDir\db.json"

if (-not (Test-Path $HistoryDir)) { New-Item -ItemType Directory -Path $HistoryDir -Force | Out-Null }

Write-Host "Syncing session history from SQLite DB..." -ForegroundColor Cyan

# Get all sessions
$sessionsJson = opencode db "SELECT id, title, project_id, time_created, time_updated FROM session ORDER BY time_created" --format json 2>&1
$sessions = $sessionsJson | ConvertFrom-Json

# Get ALL messages with their data, grouped by session
$allMessagesJson = opencode db "SELECT id, session_id, time_created, data FROM message ORDER BY time_created" --format json 2>&1
$allMessages = $allMessagesJson | ConvertFrom-Json

# Get ALL parts with their data
$allPartsJson = opencode db "SELECT id, message_id, session_id, data FROM part ORDER BY time_created" --format json 2>&1
$allParts = $allPartsJson | ConvertFrom-Json

# Index parts by message_id
$partsByMsg = @{}
foreach ($p in $allParts) {
  $mid = $p.message_id
  if (-not $partsByMsg.ContainsKey($mid)) { $partsByMsg[$mid] = @() }
  $dataObj = $p.data | ConvertFrom-Json
  $entry = @{}
  if ($dataObj.type) { $entry.type = $dataObj.type }
  if ($dataObj.text) { $entry.text = $dataObj.text }
  if ($dataObj.tool) { $entry.tool = $dataObj.tool }
  if ($dataObj.callID) { $entry.callID = $dataObj.callID }
  if ($dataObj.state -and $dataObj.state.status) { $entry.status = $dataObj.state.status }
  if ($dataObj.state -and $dataObj.state.input -and $dataObj.state.input.command) {
    $entry.command = $dataObj.state.input.command
  }
  $partsByMsg[$mid] += $entry
}

# Index messages by session_id
$msgsBySession = @{}
foreach ($m in $allMessages) {
  $sid = $m.session_id
  if (-not $msgsBySession.ContainsKey($sid)) { $msgsBySession[$sid] = @() }
  $dataObj = $m.data | ConvertFrom-Json
  $role = if ($dataObj -and $dataObj.role) { $dataObj.role } else { "unknown" }
  $parts = @()
  if ($partsByMsg.ContainsKey($m.id)) { $parts = $partsByMsg[$m.id] }

  $msgsBySession[$sid] += @{
    id = $m.id
    role = $role
    time_created = $m.time_created
    parts = $parts
  }
}

# Assemble all sessions
$allSessions = @()
foreach ($s in $sessions) {
  $msgs = @()
  if ($msgsBySession.ContainsKey($s.id)) { $msgs = $msgsBySession[$s.id] }

  $allSessions += @{
    session_id = $s.id
    title = $s.title
    project_id = $s.project_id
    time_created = $s.time_created
    time_updated = $s.time_updated
    message_count = $msgs.Count
    messages = $msgs
  }
  Write-Host "  $($s.title) ($($msgs.Count) messages)" -ForegroundColor Gray
}

$output = @{
  version = 1
  synced_at = (Get-Date -Format "o")
  sessions = $allSessions
}

$output | ConvertTo-Json -Depth 10 | Set-Content $HistoryFile -Encoding UTF8

# Strip BOM (PowerShell 5.1 adds BOM with -Encoding UTF8)
$content = Get-Content $HistoryFile -Raw
[System.IO.File]::WriteAllText($HistoryFile, $content)

Write-Host "Done. $($allSessions.Count) sessions saved to $HistoryFile" -ForegroundColor Green
