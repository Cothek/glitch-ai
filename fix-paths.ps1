$dbPath = "$env:LOCALAPPDATA\opencode\opencode.db"
$sqlitePath = "$env:TEMP\sqlite\sqlite3.exe"

if (-not (Test-Path $dbPath)) { exit }
if (-not (Test-Path $sqlitePath)) {
  # Try common locations
  $candidates = @(
    "$env:LOCALAPPDATA\Apps\2.0\**\sqlite3.exe",
    "$env:TEMP\sqlite\sqlite3.exe"
  )
  foreach ($pattern in $candidates) {
    $found = Get-ChildItem $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $sqlitePath = $found.FullName; break }
  }
}

if (Test-Path $sqlitePath) {
  & $sqlitePath $dbPath "UPDATE session SET directory = REPLACE(directory, '\', '/') WHERE INSTR(directory, '\') > 0;"
}
