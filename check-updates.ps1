param(
  [switch]$Update = $false,
  [switch]$CheckOnly = $false
)

$ErrorActionPreference = "Continue"

# --- Config ---
$RootDir = "E:\Glitch AI\glitch-ai"
$SubmoduleDir = Join-Path $RootDir "glitch-memorycore"
$LocalOpenCodeDir = Join-Path $RootDir "opencode"
$LocalOpenCodeBin = Join-Path $LocalOpenCodeDir "opencode.exe"
$PluginDir = Join-Path $RootDir ".opencode"
$CloudflaredBin = Join-Path $RootDir "cloudflared.exe"
$HandyDir = Join-Path $RootDir "handy-voice"
$HandyBin = [System.IO.Path]::Combine($HandyDir, "Handy", "handy.exe")
$StatusFile = Join-Path $RootDir "update-status.json"
$IsUpdate = $Update -or (-not $CheckOnly)

function Write-ColorHost {
  param([string]$Text, [string]$Color = "White")
  Write-Host $Text -ForegroundColor $Color
}

function Get-NvmActiveVersion {
  $nvmRoot = [Environment]::GetEnvironmentVariable("NVM_HOME", "User")
  if (-not $nvmRoot) { $nvmRoot = [Environment]::GetEnvironmentVariable("NVM_HOME", "Machine") }
  if (-not $nvmRoot) { $nvmRoot = "D:\Program Files\nvm" }
  $settingsFile = Join-Path $nvmRoot "settings.txt"
  $activeAlias = ""
  if (Test-Path $settingsFile) {
    $content = Get-Content $settingsFile -ErrorAction SilentlyContinue
    foreach ($line in $content) {
      if ($line -match '^root\s*[:=]\s*(.+)') {
        $nvmRoot = $matches[1].Trim()
      }
    }
  }
  $aliasDir = Join-Path $nvmRoot "alias"
  $defaultAlias = Join-Path $aliasDir "default"
  if (Test-Path $defaultAlias) {
    $activeAlias = (Get-Content $defaultAlias -ErrorAction SilentlyContinue).Trim()
  }
  if (-not $activeAlias) {
    $nodeDir = Join-Path $nvmRoot "*"
    $dirs = Get-ChildItem -Path $nvmRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^v\d+' }
    if ($dirs) {
      $activeAlias = ($dirs | Sort-Object Name -Descending | Select-Object -First 1).Name
    }
  }
  if ($activeAlias) {
    $nodePath = Join-Path $nvmRoot $activeAlias "node.exe"
    if (-not (Test-Path $nodePath)) {
      $dirs = Get-ChildItem -Path $nvmRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^v\d+' }
      if ($dirs) {
        $activeAlias = ($dirs | Sort-Object Name -Descending | Select-Object -First 1).Name
      }
    }
  }
  if ($activeAlias) {
    return @{ Version = $activeAlias; Root = $nvmRoot }
  }
  return $null
}

function Confirm-Update {
  param([string]$Name, [string]$FromVer, [string]$ToVer)
  $response = Read-Host "Update $Name from $FromVer to $ToVer? [y/N]"
  return $response.Trim().ToLower() -eq "y"
}

function Get-VersionTagFromRedirect {
  param([string]$Url)
  try {
    $request = [System.Net.WebRequest]::Create($Url)
    $request.AllowAutoRedirect = $false
    $request.Timeout = 10000
    $response = $request.GetResponse()
    $redirectUrl = $response.Headers["Location"]
    $response.Close()
    if ($redirectUrl) {
      if ($redirectUrl -match 'tag/([^/]+)') {
        return $matches[1]
      }
    }
  } catch {
    # fallback: parse from releases API
  }
  try {
    $json = Invoke-WebRequest -Uri "https://api.github.com/repos/cloudflare/cloudflared/releases/latest" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    $data = $json | ConvertFrom-Json
    if ($data.tag_name) { return $data.tag_name }
  } catch {}
  return $null
}

# --- Results accumulator ---
$results = @()
$updatesAvailable = 0

# ========== 1. opencode global npm ==========
try {
  $currentVer = ""
  $latestVer = ""
  try {
    $currentVer = (& "opencode" "--version" 2>$null).Trim()
  } catch { $currentVer = "unknown" }

  try {
    $latestVer = (& "npm" "view" "opencode-ai" "version" 2>$null).Trim()
  } catch { $latestVer = "unknown" }

  $hasUpdate = ($currentVer -ne "unknown" -and $latestVer -ne "unknown" -and $currentVer -ne $latestVer)
  $updateType = "unknown"
  $autoSafe = $false

  if ($hasUpdate) {
    $cvParts = $currentVer.Split('.')
    $lvParts = $latestVer.Split('.')
    if ($cvParts[0] -ne $lvParts[0]) { $updateType = "major" }
    elseif ($cvParts[1] -ne $lvParts[1]) { $updateType = "minor"; $autoSafe = $true }
    else { $updateType = "patch"; $autoSafe = $true }
  }

  if ($hasUpdate) { $updatesAvailable++ }

  if ($IsUpdate -and $hasUpdate) {
    if ($updateType -eq "major") {
      $proceed = Confirm-Update -Name "opencode (global)" -FromVer $currentVer -ToVer $latestVer
    } else {
      $proceed = $true
    }
    if ($proceed) {
      Write-ColorHost "  Upgrading opencode-ai from $currentVer to $latestVer..." "Cyan"
      $null = & "npm" "install" "-g" "opencode-ai@latest" 2>&1
      try { $currentVer = (& "opencode" "--version" 2>$null).Trim() } catch {}
      Write-ColorHost "  Done. Version: $currentVer" "Green"
    }
  }

  $results += @{
    name = "opencode (global)"
    current = $currentVer
    latest = $latestVer
    update_available = $hasUpdate
    update_type = $updateType
    auto_safe = $autoSafe
    status = "ok"
  }

  Write-ColorHost ("  [{0}] Current: {1} | Latest: {2}" -f $(if ($hasUpdate) {"UPDATE"} else {"OK"}), $currentVer, $latestVer) $(if ($hasUpdate) {"Yellow"} else {"Green"})
} catch {
  $results += @{ name = "opencode (global)"; status = "error"; error_message = $_.Exception.Message }
  Write-ColorHost "  [ERROR] $_" "Red"
}

# ========== 2. opencode local binary ==========
try {
  $curVer = "unknown"
  $globVer = $currentVer
  $updateNeeded = $false

  try {
    $curVer = (& $LocalOpenCodeBin "--version" 2>$null).Trim()
  } catch { $curVer = "unknown" }

  if ($globVer -ne "unknown" -and $curVer -ne "unknown" -and $curVer -ne $globVer) {
    $updateNeeded = $true
    $updatesAvailable++
  }

  if ($IsUpdate -and $updateNeeded) {
    Write-ColorHost "  Syncing local opencode.exe from global install..." "Cyan"
    try {
      $globalRoot = (& "npm" "root" "-g" 2>$null).Trim()
      $sourceBin = Join-Path $globalRoot "opencode-ai" "bin" "opencode.exe"
      if (Test-Path $sourceBin) {
        if (-not (Test-Path $LocalOpenCodeDir)) { New-Item -ItemType Directory -Path $LocalOpenCodeDir -Force | Out-Null }
        Copy-Item -Path $sourceBin -Destination $LocalOpenCodeBin -Force
        Write-ColorHost "  Done." "Green"
        try { $curVer = (& $LocalOpenCodeBin "--version" 2>$null).Trim() } catch {}
      } else {
        Write-ColorHost "  Source binary not found at $sourceBin" "Red"
      }
    } catch {
      Write-ColorHost "  Failed to copy: $_" "Red"
    }
  }

  $results += @{
    name = "opencode (local)"
    current = $curVer
    latest = $globVer
    update_available = $updateNeeded
    update_type = if ($updateNeeded) {"sync"} else {"none"}
    auto_safe = $true
    status = "ok"
  }

  Write-ColorHost ("  [{0}] Current: {1} | Global: {2}" -f $(if ($updateNeeded) {"UPDATE"} else {"OK"}), $curVer, $globVer) $(if ($updateNeeded) {"Yellow"} else {"Green"})
} catch {
  $results += @{ name = "opencode (local)"; status = "error"; error_message = $_.Exception.Message }
  Write-ColorHost "  [ERROR] $_" "Red"
}

# ========== 3. GitNexus ==========
try {
  $curVer = ""
  $latestVer = ""
  try {
    $curVer = (& "gitnexus" "--version" 2>$null).Trim()
  } catch { $curVer = "unknown" }

  try {
    $latestVer = (& "npm" "view" "gitnexus" "version" 2>$null).Trim()
  } catch { $latestVer = "unknown" }

  $hasUpdate = ($curVer -ne "unknown" -and $latestVer -ne "unknown" -and $curVer -ne $latestVer)
  $updateType = "unknown"
  $autoSafe = $false

  if ($hasUpdate) {
    $cvParts = $curVer.Split('.')
    $lvParts = $latestVer.Split('.')
    if ($cvParts[0] -ne $lvParts[0]) { $updateType = "major" }
    elseif ($cvParts[1] -ne $lvParts[1]) { $updateType = "minor"; $autoSafe = $true }
    else { $updateType = "patch"; $autoSafe = $true }
    $updatesAvailable++
  }

  if ($IsUpdate -and $hasUpdate) {
    if ($updateType -eq "major") {
      $proceed = Confirm-Update -Name "GitNexus" -FromVer $curVer -ToVer $latestVer
    } else {
      $proceed = $true
    }
    if ($proceed) {
      Write-ColorHost "  Upgrading gitnexus from $curVer to $latestVer..." "Cyan"
      $null = & "npm" "install" "-g" "gitnexus@latest" 2>&1
      try { $curVer = (& "gitnexus" "--version" 2>$null).Trim() } catch {}
      Write-ColorHost "  Done. Version: $curVer" "Green"
    }
  }

  $results += @{
    name = "gitnexus"
    current = $curVer
    latest = $latestVer
    update_available = $hasUpdate
    update_type = $updateType
    auto_safe = $autoSafe
    status = "ok"
  }

  Write-ColorHost ("  [{0}] Current: {1} | Latest: {2}" -f $(if ($hasUpdate) {"UPDATE"} else {"OK"}), $curVer, $latestVer) $(if ($hasUpdate) {"Yellow"} else {"Green"})
} catch {
  $results += @{ name = "gitnexus"; status = "error"; error_message = $_.Exception.Message }
  Write-ColorHost "  [ERROR] $_" "Red"
}

# ========== 4. glitch-ai repo ==========
try {
  $behindCount = "?"
  $updateNeeded = $false

  Push-Location $RootDir
  try {
    $null = & "git" "fetch" "origin" "main" 2>&1
    $behindRaw = & "git" "rev-list" "--count" "HEAD..origin/main" 2>&1
    $behindCount = $behindRaw.Trim()
    if ($behindCount -match '^\d+$') {
      $behindInt = [int]$behindCount
      if ($behindInt -gt 0) {
        $updateNeeded = $true
        $updatesAvailable++
      }
    }
  } catch { $behindCount = "error" }
  Pop-Location

  if ($IsUpdate -and $updateNeeded) {
    $proceed = Confirm-Update -Name "glitch-ai repo (git pull)" -FromVer "$behindCount behind" -ToVer "origin/main"
    if ($proceed) {
      Push-Location $RootDir
      Write-ColorHost "  Pulling from origin/main..." "Cyan"
      $null = & "git" "pull" "origin" "main" 2>&1
      Pop-Location
      Write-ColorHost "  Done." "Green"
      $updateNeeded = $false
      $behindCount = "0"
    }
  }

  $results += @{
    name = "glitch-ai repo"
    current = "$behindCount commit(s) behind origin/main"
    latest = "origin/main"
    update_available = $updateNeeded
    update_type = if ($updateNeeded) {"git pull"} else {"none"}
    auto_safe = $false
    status = if ($behindCount -eq "error") {"error"} else {"ok"}
    error_message = if ($behindCount -eq "error") {"git fetch/rev-list failed"} else {$null}
  }

  Write-ColorHost ("  [{0}] $behindCount commit(s) behind origin/main" -f $(if ($updateNeeded) {"UPDATE"} else {"OK"})) $(if ($updateNeeded) {"Yellow"} else {"Green"})
} catch {
  $results += @{ name = "glitch-ai repo"; status = "error"; error_message = $_.Exception.Message }
  Write-ColorHost "  [ERROR] $_" "Red"
}

# ========== 5. glitch-memorycore submodule ==========
try {
  $subStatus = "unknown"
  $updateNeeded = $false

  Push-Location $RootDir
  try {
    $subRaw = & "git" "submodule" "status" 2>&1
    $subStatus = $subRaw.Trim()
    if ($subStatus -match '^([\+\- ])([a-f0-9]+)') {
      $prefix = $matches[1]
      $currentSha = $matches[2]
      if ($prefix -eq "+") {
        $updateNeeded = $true
        $updatesAvailable++
        $subStatus = "$currentSha (outdated)"
      } elseif ($prefix -eq "-") {
        $subStatus = "$currentSha (uninitialized)"
      } else {
        $subStatus = "$currentSha (current)"
      }
    }
  } catch { $subStatus = "error" }
  Pop-Location

  if ($IsUpdate -and $updateNeeded) {
    $proceed = Confirm-Update -Name "glitch-memorycore submodule" -FromVer "$currentSha" -ToVer "remote"
    if ($proceed) {
      Push-Location $RootDir
      Write-ColorHost "  Updating glitch-memorycore submodule..." "Cyan"
      $null = & "git" "submodule" "update" "--remote" "glitch-memorycore" 2>&1
      Pop-Location
      Write-ColorHost "  Done." "Green"
      $updateNeeded = $false
      $subStatus = "updated"
    }
  }

  $results += @{
    name = "glitch-memorycore submodule"
    current = $subStatus
    latest = "remote HEAD"
    update_available = $updateNeeded
    update_type = if ($updateNeeded) {"submodule update"} else {"none"}
    auto_safe = $false
    status = if ($subStatus -eq "error") {"error"} else {"ok"}
    error_message = if ($subStatus -eq "error") {"git submodule status failed"} else {$null}
  }

  Write-ColorHost ("  [{0}] {1}" -f $(if ($updateNeeded) {"UPDATE"} else {"OK"}), $subStatus) $(if ($updateNeeded) {"Yellow"} else {"Green"})
} catch {
  $results += @{ name = "glitch-memorycore submodule"; status = "error"; error_message = $_.Exception.Message }
  Write-ColorHost "  [ERROR] $_" "Red"
}

# ========== 6. @opencode-ai/plugin (.opencode) ==========
try {
  $outdatedInfo = @()
  $outdatedCount = 0

  if (Test-Path (Join-Path $PluginDir "package.json")) {
    Push-Location $PluginDir
    try {
      $raw = & "npm" "outdated" "--json" 2>&1
      if ($raw) {
        $parsed = $raw | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($parsed -and $parsed.PSObject.Properties) {
          foreach ($prop in $parsed.PSObject.Properties) {
            $outdatedInfo += @{ package = $prop.Name; current = $prop.Value.current; latest = $prop.Value.latest }
            $outdatedCount++
          }
        }
      }
    } catch {
      # npm outdated returns non-zero exit when outdated packages found
      if ($_.Exception.Message -match '^\s*\{') {
        try {
          $parsed = $_.Exception.Message | ConvertFrom-Json
          if ($parsed.PSObject.Properties) {
            foreach ($prop in $parsed.PSObject.Properties) {
              $outdatedInfo += @{ package = $prop.Name; current = $prop.Value.current; latest = $prop.Value.latest }
              $outdatedCount++
            }
          }
        } catch {}
      }
    }
    Pop-Location

    if ($outdatedCount -gt 0) { $updatesAvailable++ }

    if ($IsUpdate -and $outdatedCount -gt 0) {
      Push-Location $PluginDir
      Write-ColorHost "  Updating $outdatedCount package(s) in .opencode..." "Cyan"
      $null = & "npm" "update" 2>&1
      Pop-Location
      Write-ColorHost "  Done." "Green"
    }
  } else {
    Write-ColorHost "  [SKIP] No package.json found in .opencode" "Gray"
  }

  $results += @{
    name = "@opencode-ai/plugin (.opencode)"
    current = if ($outdatedCount -gt 0) { ($outdatedInfo | ForEach-Object { "$($_.package): $($_.current)->$($_.latest)" }) -join "; " } else { "up to date" }
    latest = if ($outdatedCount -gt 0) { ($outdatedInfo | ForEach-Object { $_.latest }) -join "; " } else { "up to date" }
    update_available = ($outdatedCount -gt 0)
    update_type = if ($outdatedCount -gt 0) {"$outdatedCount package(s) outdated"} else {"none"}
    auto_safe = $true
    status = "ok"
  }

  if ($outdatedCount -gt 0) {
    Write-ColorHost "  [UPDATE] $outdatedCount package(s) outdated" "Yellow"
    foreach ($pkg in $outdatedInfo) {
      Write-ColorHost "    $($pkg.package): $($pkg.current) -> $($pkg.latest)" "DarkYellow"
    }
  } else {
    Write-ColorHost "  [OK] All packages up to date" "Green"
  }
} catch {
  $results += @{ name = "@opencode-ai/plugin (.opencode)"; status = "error"; error_message = $_.Exception.Message }
  Write-ColorHost "  [ERROR] $_" "Red"
}

# ========== 7. cloudflared ==========
try {
  $curVer = "unknown"
  $latestVer = "unknown"
  $updateNeeded = $false

  if (Test-Path $CloudflaredBin) {
    try {
      $verRaw = (& $CloudflaredBin "--version" 2>$null)
      if ($verRaw -match '(\d+\.\d+\.\d+)') {
        $curVer = $matches[1]
      } else {
        $curVer = $verRaw.Trim()
      }
    } catch { $curVer = "unknown" }
  } else {
    $curVer = "not installed"
  }

  $tag = Get-VersionTagFromRedirect -Url "https://github.com/cloudflare/cloudflared/releases/latest"
  if ($tag) {
    if ($tag -match '(\d+\.\d+\.\d+)') {
      $latestVer = $matches[1]
    } else {
      $latestVer = $tag
    }
  }

  if ($curVer -ne "unknown" -and $curVer -ne "not installed" -and $latestVer -ne "unknown" -and $curVer -ne $latestVer) {
    $updateNeeded = $true
    $updatesAvailable++
  }

  if ($IsUpdate -and $updateNeeded) {
    $proceed = Confirm-Update -Name "cloudflared" -FromVer $curVer -ToVer $latestVer
    if ($proceed) {
      Write-ColorHost "  Downloading latest cloudflared..." "Cyan"
      try {
        $outFile = Join-Path $RootDir "cloudflared.exe.tmp"
        Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $outFile -UseBasicParsing -TimeoutSec 60 -ErrorAction Stop
        if (Test-Path $outFile) {
          Copy-Item -Path $outFile -Destination $CloudflaredBin -Force
          Remove-Item -Path $outFile -Force
          Write-ColorHost "  Done." "Green"
          try {
            $verRaw = (& $CloudflaredBin "--version" 2>$null)
            if ($verRaw -match '(\d+\.\d+\.\d+)') { $curVer = $matches[1] }
          } catch {}
        }
      } catch {
        Write-ColorHost "  Download failed: $_" "Red"
      }
    }
  }

  $results += @{
    name = "cloudflared"
    current = $curVer
    latest = $latestVer
    update_available = $updateNeeded
    update_type = if ($updateNeeded) {"re-download"} else {"none"}
    auto_safe = $false
    status = "ok"
  }

  Write-ColorHost ("  [{0}] Current: {1} | Latest: {2}" -f $(if ($updateNeeded) {"UPDATE"} else {"OK"}), $curVer, $latestVer) $(if ($updateNeeded) {"Yellow"} else {"Green"})
} catch {
  $results += @{ name = "cloudflared"; status = "error"; error_message = $_.Exception.Message }
  Write-ColorHost "  [ERROR] $_" "Red"
}

# ========== 8. Handy voice ==========
try {
  $curInfo = "unknown"
  $latestVer = "unknown"
  $updateNeeded = $false

  if (Test-Path $HandyBin) {
    try {
      $fileInfo = Get-Item $HandyBin
      $fileSizeKB = [math]::Round($fileInfo.Length / 1KB, 1)
      $fileDate = $fileInfo.LastWriteTime.ToString("yyyy-MM-dd")
      $curInfo = "$fileDate ($fileSizeKB KB)"
    } catch { $curInfo = "exists (size unknown)" }
  } else {
    $curInfo = "not installed"
  }

  try {
    $json = Invoke-WebRequest -Uri "https://api.github.com/repos/cjpais/Handy/releases/latest" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    $data = $json | ConvertFrom-Json
    $latestVer = $data.tag_name
  } catch {}

  if ($latestVer -ne "unknown" -and $latestVer -ne $curInfo) {
    $updateNeeded = $true
    $updatesAvailable++
  }

  if ($IsUpdate -and $updateNeeded) {
    $proceed = Confirm-Update -Name "Handy voice" -FromVer $curInfo -ToVer $latestVer
    if ($proceed) {
      Write-ColorHost "  Downloading latest Handy release..." "Cyan"
      try {
        $assetUrl = $null
        if ($data -and $data.assets) {
          foreach ($asset in $data.assets) {
            if ($asset.name -match 'Handy.*\.zip$') {
              $assetUrl = $asset.browser_download_url
              break
            }
          }
        }
        if (-not $assetUrl) {
          $assetUrl = "https://github.com/cjpais/Handy/releases/latest/download/Handy.zip"
        }
        $zipPath = Join-Path $RootDir "handy-voice-tmp.zip"
        Invoke-WebRequest -Uri $assetUrl -OutFile $zipPath -UseBasicParsing -TimeoutSec 120 -ErrorAction Stop
        if (Test-Path $zipPath) {
          if (-not (Test-Path $HandyDir)) { New-Item -ItemType Directory -Path $HandyDir -Force | Out-Null }
          $shell = New-Object -ComObject Shell.Application
          $zip = $shell.NameSpace($zipPath)
          $dest = $shell.NameSpace($HandyDir)
          $dest.CopyHere($zip.Items(), 16)
          Remove-Item -Path $zipPath -Force
          Write-ColorHost "  Done." "Green"
          if (Test-Path $HandyBin) {
            $fileInfo = Get-Item $HandyBin
            $fileSizeKB = [math]::Round($fileInfo.Length / 1KB, 1)
            $fileDate = $fileInfo.LastWriteTime.ToString("yyyy-MM-dd")
            $curInfo = "$fileDate ($fileSizeKB KB)"
          }
        }
      } catch {
        Write-ColorHost "  Download failed: $_" "Red"
      }
    }
  }

  $results += @{
    name = "Handy voice"
    current = $curInfo
    latest = $latestVer
    update_available = $updateNeeded
    update_type = if ($updateNeeded) {"re-download"} else {"none"}
    auto_safe = $false
    status = "ok"
  }

  Write-ColorHost ("  [{0}] Current: {1} | Latest: {2}" -f $(if ($updateNeeded) {"UPDATE"} else {"OK"}), $curInfo, $latestVer) $(if ($updateNeeded) {"Yellow"} else {"Green"})
} catch {
  $results += @{ name = "Handy voice"; status = "error"; error_message = $_.Exception.Message }
  Write-ColorHost "  [ERROR] $_" "Red"
}

# ========== Summary Table ==========
Write-Host ""
Write-Host ("=" * 75) -ForegroundColor White
Write-Host "  GLITCH AI UPDATE SUMMARY" -ForegroundColor White
Write-Host ("=" * 75) -ForegroundColor White

$mode = if ($IsUpdate) {"UPDATE MODE"} else {"CHECK ONLY"}
Write-Host "  Mode: $mode" -ForegroundColor White
if (-not $IsUpdate) {
  Write-Host "  Run with -Update to apply updates" -ForegroundColor Gray
}
Write-Host ""

$tableHeader = "  {0,-28} {1,-18} {2,-18} {3,-10}" -f "Component", "Current", "Latest", "Status"
$tableSep = "  " + ("-" * 75)

Write-Host $tableSep
Write-Host $tableHeader -ForegroundColor White
Write-Host $tableSep

foreach ($item in $results) {
  if ($item.status -eq "error") {
    $statusColor = "Red"
    $statusLabel = "ERROR"
  } elseif ($item.update_available) {
    $statusColor = "Yellow"
    $statusLabel = "UPDATE"
  } else {
    $statusColor = "Green"
    $statusLabel = "OK"
  }

  $row = "  {0,-28} {1,-18} {2,-18} {3,-10}" -f $item.name, $item.current, $item.latest, $statusLabel
  Write-Host $row -ForegroundColor $statusColor
}

Write-Host $tableSep
Write-Host ""

if ($updatesAvailable -gt 0) {
  Write-ColorHost "  Updates available: $updatesAvailable" "Yellow"
} else {
  Write-ColorHost "  Everything is up to date." "Green"
}

# ========== Write JSON ==========
$statusJson = @{
  checked_at = (Get-Date -Format "o")
  updates_available = $updatesAvailable
  mode = if ($IsUpdate) {"update"} else {"check-only"}
  items = $results
} | ConvertTo-Json -Depth 4

$statusJson | Set-Content -Path $StatusFile -Encoding UTF8
Write-Host ""
Write-ColorHost "  Status written to: $StatusFile" "Gray"
Write-Host ("=" * 75) -ForegroundColor White
