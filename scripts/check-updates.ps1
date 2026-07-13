param(
  [switch]$Update = $false,
  [switch]$CheckOnly = $false,
  [string[]]$Filter = @()
)

$ErrorActionPreference = "Continue"

# --- Config ---
$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Split-Path -Parent $ScriptDir
$SubmoduleDir = Join-Path $RootDir "glitch-memorycore"
$LocalOpenCodeDir = Join-Path $RootDir "opencode"
$LocalOpenCodeBin = Join-Path $LocalOpenCodeDir "opencode.exe"
$PluginDir = Join-Path $RootDir ".opencode"
$CloudflaredBin = Join-Path $RootDir "cloudflared.exe"
$HandyDir = Join-Path $RootDir "handy-voice"
$HandyBin = [System.IO.Path]::Combine($HandyDir, "Handy", "handy.exe")
$StatusFile = Join-Path $RootDir "data\update-status.json"
$NvidiaFreeWatchlistCache = Join-Path $RootDir "data\nvidia-free-watchlist-cache.json"
$IsUpdate = $Update -or (-not $CheckOnly)

function Write-ColorHost {
  param([string]$Text, [string]$Color = "White")
  Write-Host $Text -ForegroundColor $Color
}

function Invoke-WithSpinner {
  param([string]$Label, [scriptblock]$ScriptBlock)
  Write-Host -NoNewline "  $Label" -ForegroundColor Cyan
  $job = Start-Job -ScriptBlock $ScriptBlock 2>$null
  while ($job.JobStateInfo.State -eq 'Running') {
    Start-Sleep -Milliseconds 1000
    Write-Host "." -NoNewline
  }
  if ($job.JobStateInfo.State -eq 'Failed') {
    $null = Receive-Job $job -ErrorAction SilentlyContinue
    Remove-Job $job -Force
    Write-Host " failed." -ForegroundColor Red
    return $false
  }
  $null = Receive-Job $job -ErrorAction SilentlyContinue
  Remove-Job $job -Force
  return $true
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
    $nodePath = Join-Path (Join-Path $nvmRoot $activeAlias) "node.exe"
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
  if ([string]::IsNullOrWhiteSpace($ToVer)) {
    Write-ColorHost "  WARNING: Latest version is unknown -- skipping $Name update." "Yellow"
    return $false
  }
  $response = Read-Host "Update $Name from $FromVer to $ToVer? [y/N]"
  if ($null -eq $response) { return $false }
  return $response.Trim().ToLower() -eq "y"
}

function Get-CurrentBranch {
  param([string]$WorkDir)
  Push-Location $WorkDir
  try {
    $branch = (& "git" "rev-parse" "--abbrev-ref" "HEAD" 2>$null).Trim()
    if ($branch -eq "HEAD") { $branch = "detached" }
    return $branch
  } catch { return $null }
  finally { Pop-Location }
}

function Get-RemoteBehindCount {
  param([string]$WorkDir, [string]$Branch)
  Push-Location $WorkDir
  try {
    $null = & "git" "fetch" "origin" $Branch 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-ColorHost "  WARNING: git fetch failed for origin/$Branch" "Yellow"
      return $null
    }
    $raw = & "git" "rev-list" "--count" "HEAD..origin/$Branch" 2>&1
    $count = $raw.Trim()
    if ($count -match '^\d+$') { return [int]$count }
    return $null
  } catch { return $null }
  finally { Pop-Location }
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

function Update-OpenCodeBinary {
  param(
    [string]$TargetVersion,
    [string]$LocalBinaryPath
  )
  
  try {
    $LocalBinaryDir = Split-Path -Parent $LocalBinaryPath
    $OpenCodeBinName = "opencode.exe"
    # Ensure $env:TEMP is a string (defensive)
    $tempPath = $env:TEMP
    if ($tempPath -is [System.Collections.IEnumerable] -and -not ($tempPath -is [string])) {
      $tempPath = ($tempPath | Select-Object -First 1)
    }
    $updateDir = [string]([IO.Path]::Combine($tempPath, "glitch-oc-update"))
    
    # Clean any previous attempt
    if (Test-Path $updateDir) { Remove-Item $updateDir -Recurse -Force -ErrorAction SilentlyContinue }
    New-Item -ItemType Directory -Path $updateDir -Force | Out-Null
  } catch {
    Write-ColorHost "  Update-OpenCodeBinary init failed: $($_.Exception.Message)" "Red"
    return $null
  }
  
  $newBinPath = $null
  $updateSource = "npm"
    
    # --- Attempt 1: npm install ---
    Write-ColorHost "  Trying npm install..." "Cyan"
    $npmSuccess = Invoke-WithSpinner -Label "Downloading opencode-ai@$TargetVersion" -ScriptBlock { & "npm" "install" "opencode-ai@latest" "--no-save" "--prefix" $using:updateDir 2>&1 | Out-Null }
    
    if ($npmSuccess) {
    # Ensure $updateDir is a string (defensive against background job scope issues)
    $updateDir = [string]$updateDir
    # Search multiple possible binary locations in the npm package - use .NET Path.Combine to avoid Join-Path bug
    $possiblePaths = @(
      [IO.Path]::Combine($updateDir, "node_modules", "opencode-ai", "bin", $OpenCodeBinName),
      [IO.Path]::Combine($updateDir, "node_modules", "opencode-ai", $OpenCodeBinName),
      [IO.Path]::Combine($updateDir, "node_modules", "opencode-ai", "dist", $OpenCodeBinName),
      [IO.Path]::Combine($updateDir, "node_modules", "opencode-ai", "build", $OpenCodeBinName)
    )
    
    foreach ($p in $possiblePaths) {
      if (Test-Path $p) {
        $newBinPath = $p
        Write-ColorHost "  Found binary at: $p" "DarkGreen"
        break
      }
    }
    
    if (-not $newBinPath) {
      Write-ColorHost "  Binary not found in standard locations, searching recursively..." "Yellow"
      # Recursive search as last resort
      try {
        function Find-BinaryRecursive {
          param([string]$Dir)
          $entries = Get-ChildItem -Path $Dir -Recurse -File -ErrorAction SilentlyContinue
          foreach ($entry in $entries) {
            if ($entry.Name -eq $OpenCodeBinName) {
              return $entry.FullName
            }
          }
          return $null
        }
        $found = Find-BinaryRecursive -Dir ([IO.Path]::Combine($updateDir, "node_modules", "opencode-ai"))
        if ($found) {
          $newBinPath = $found
          Write-ColorHost "  Found binary via recursive search: $found" "DarkGreen"
        }
      } catch {
        Write-ColorHost "  Recursive search failed: $_" "Yellow"
      }
    }
  } else {
    Write-ColorHost "  npm install failed (background job failed)" "Yellow"
  }
  
  # --- Attempt 2: GitHub releases fallback ---
  if (-not $newBinPath) {
    Write-ColorHost "  npm approach failed, trying GitHub releases fallback..." "Cyan"
    $updateSource = "github"
    
    try {
      # Fetch latest release from GitHub
      $githubApiUrl = 'https://api.github.com/repos/opencode-ai/opencode/releases/latest'
      $releaseData = Invoke-WebRequest -Uri $githubApiUrl -UseBasicParsing -TimeoutSec 15 -Headers @{ 'User-Agent' = 'Glitch-AI' } | ConvertFrom-Json
      
      $tagName = $releaseData.tag_name  # e.g., "v1.17.3"
      Write-ColorHost "  GitHub latest release: $tagName" "Cyan"
      
      # Find Windows asset
      $assets = $releaseData.assets
      $isArm = (Get-CimInstance Win32_Processor).Architecture -eq 5
      $archSuffix = if ($isArm) { "arm64" } else { "x64" }
      $assetUrl = $null
      
      $asset = $assets | Where-Object { $_.name -eq "opencode-windows-$archSuffix.zip" } | Select-Object -First 1
      if ($asset) { $assetUrl = $asset.browser_download_url }
      
      if ($assetUrl) {
        Write-ColorHost "  Downloading from GitHub: $assetUrl" "Cyan"
        $zipPath = [IO.Path]::Combine($updateDir, "opencode-github.zip")
        Invoke-WebRequest -Uri $assetUrl -OutFile $zipPath -UseBasicParsing -TimeoutSec 60
        
        Write-ColorHost "  Extracting..." "Cyan"
        Expand-Archive -Path $zipPath -DestinationPath $updateDir -Force
        
        # Search for binary in extracted files
        $possiblePaths = @(
          [IO.Path]::Combine($updateDir, $OpenCodeBinName),
          [IO.Path]::Combine($updateDir, "opencode", $OpenCodeBinName),
          [IO.Path]::Combine($updateDir, "bin", $OpenCodeBinName)
        )
        
        foreach ($p in $possiblePaths) {
          if (Test-Path $p) {
            $newBinPath = $p
            Write-ColorHost "  Found binary at: $p" "DarkGreen"
            break
          }
        }
        
        # Recursive search if not found
        if (-not $newBinPath) {
          try {
            function Find-BinaryRecursive {
              param([string]$Dir)
              $entries = Get-ChildItem -Path $Dir -Recurse -File -ErrorAction SilentlyContinue
              foreach ($entry in $entries) {
                if ($entry.Name -eq $OpenCodeBinName) {
                  return $entry.FullName
                }
              }
              return $null
            }
            $found = Find-BinaryRecursive -Dir $updateDir
            if ($found) {
              $newBinPath = $found
              Write-ColorHost "  Found binary via recursive search: $found" "DarkGreen"
            }
          } catch {
            Write-ColorHost "  Recursive search failed: $_" "Yellow"
          }
        }
      } else {
        Write-ColorHost "  No matching GitHub release asset found for architecture: $archSuffix" "Yellow"
      }
    } catch {
      Write-ColorHost "  GitHub fallback failed: $_" "Red"
    }
  }
  
  # --- Apply update if binary found ---
  if ($newBinPath) {
    Write-ColorHost "  Using binary from ${updateSource}: $newBinPath" "Green"
    
    # Robust binary replacement: use system temp for staging, then atomic rename
    $stagingBin = [IO.Path]::Combine($env:TEMP, "opencode-staging-$PID.exe")
    $oldBin = "$LocalBinaryPath.old"
    
    # Use unique backup name to avoid conflicts
    $oldBin = "$LocalBinaryPath.old.$PID"
    
    # Clean up any previous staging file
    if (Test-Path $stagingBin) { try { Remove-Item $stagingBin -Force -ErrorAction Stop } catch {} }
    
    try {
      # Copy new binary to staging location (system temp)
      Copy-Item -Path $newBinPath -Destination $stagingBin -Force -ErrorAction Stop
      
      # Rename current binary to unique .old name (Windows allows renaming in-use executables)
      Rename-Item -Path $LocalBinaryPath -NewName $oldBin -Force -ErrorAction Stop
      
      # Move staging to target (atomic on same volume, or copy+delete across volumes)
      Move-Item -Path $stagingBin -Destination $LocalBinaryPath -Force -ErrorAction Stop
      
      # Clean up old binary
      Remove-Item $oldBin -Force -ErrorAction SilentlyContinue
      
      return $newBinPath
    } catch {
      Write-ColorHost "  Update failed: $($_.Exception.Message)" "Red"
      # Attempt rollback
      if (Test-Path $oldBin -and -not (Test-Path $LocalBinaryPath)) {
        Rename-Item -Path $oldBin -NewName $LocalBinaryPath -Force -ErrorAction SilentlyContinue
      }
      if (Test-Path $stagingBin) { Remove-Item $stagingBin -Force -ErrorAction SilentlyContinue }
      return $null
    }
  } else {
    Write-ColorHost "  Update failed: could not locate opencode binary in npm package or GitHub release." "Red"
    return $null
  }
  
  # Clean up temp
  try {
    Remove-Item $updateDir -Recurse -Force -ErrorAction SilentlyContinue
  } catch {}
}

# --- Results accumulator ---
$results = @()
$updatesAvailable = 0

# ========== 1. opencode local binary ==========
try {
  $curVer = "unknown"
  $latestVer = ""
  try {
    $curVer = (& $LocalOpenCodeBin "--version" 2>$null).Trim()
  } catch { $curVer = "unknown" }

  try {
    $latestVer = (& "npm" "view" "opencode-ai" "version" 2>$null).Trim()
  } catch { $latestVer = "unknown" }

  $updateNeeded = $false

  if ($latestVer -ne "unknown" -and $latestVer -ne "" -and $curVer -ne "unknown" -and $curVer -ne $latestVer) {
    $updateNeeded = $true
    $updatesAvailable++
  }

  if ($IsUpdate -and $updateNeeded -and ($Filter.Count -eq 0 -or $Filter -contains "opencode")) {
    Write-ColorHost "  Downloading opencode-ai@$latestVer to update local binary..." "Cyan"
    $newBinPath = Update-OpenCodeBinary -TargetVersion $latestVer -LocalBinaryPath $LocalOpenCodeBin
    if ($newBinPath) {
      Write-ColorHost "  Done." "Green"
      try { $curVer = (& $LocalOpenCodeBin "--version" 2>$null).Trim() } catch {}
    }
  }

  $results += @{
    name = "opencode"
    current = $curVer
    latest = $latestVer
    update_available = $updateNeeded
    update_type = if ($updateNeeded) {"sync"} else {"none"}
    auto_safe = $true
    status = "ok"
  }

  Write-ColorHost ("  [{0}] Current: {1} | Latest: {2}" -f $(if ($updateNeeded) {"UPDATE"} else {"OK"}), $curVer, $latestVer) $(if ($updateNeeded) {"Yellow"} else {"Green"})
} catch {
  $results += @{ name = "opencode"; status = "error"; error_message = $_.Exception.Message }
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
      $proceed = ($Filter.Count -gt 0 -or $Update) -or (Confirm-Update -Name "GitNexus" -FromVer $curVer -ToVer $latestVer)
    } else {
      $proceed = $true
    }
    if ($proceed) {
      $null = Invoke-WithSpinner -Label "Upgrading gitnexus from $curVer to $latestVer" -ScriptBlock { & "npm" "install" "-g" "gitnexus@latest" 2>&1 | Out-Null }
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
  $branchName = "unknown"
  $displayLatest = "origin/main"

  $branchName = Get-CurrentBranch -WorkDir $RootDir
  if ($branchName -and $branchName -ne "detached") {
    $behindRaw = Get-RemoteBehindCount -WorkDir $RootDir -Branch $branchName
    if ($null -ne $behindRaw) {
      $behindCount = $behindRaw
      $displayLatest = "origin/$branchName"
      if ($behindCount -gt 0) {
        $updateNeeded = $true
        $updatesAvailable++
      }
    }
  }

  if ($IsUpdate -and $updateNeeded -and ($Filter.Count -eq 0 -or $Filter -contains "glitch-ai repo")) {
    $proceed = ($Filter.Count -gt 0 -or $Update) -or (Confirm-Update -Name "glitch-ai repo (git pull)" -FromVer "$behindCount behind" -ToVer $displayLatest)
    if ($proceed) {
      Push-Location $RootDir
      Write-ColorHost "  Pulling from origin/$branchName..." "Cyan"
      $pullOut = & "git" "pull" "origin" $branchName 2>&1
      if ($LASTEXITCODE -eq 0) {
        Write-ColorHost "  Done." "Green"
        $updateNeeded = $false
        $behindCount = "0"
      } else {
        Write-ColorHost "  Pull failed. Output: $pullOut" "Red"
      }
      Pop-Location
    }
  }

  $statusDisplay = "${branchName}: $behindCount commit(s) behind $displayLatest"
  $results += @{
    name = "glitch-ai repo"
    current = $statusDisplay
    latest = $displayLatest
    update_available = $updateNeeded
    update_type = if ($updateNeeded) {"git pull"} else {"none"}
    auto_safe = $false
    status = "ok"
    error_message = $null
  }

  Write-ColorHost ("  [{0}] $statusDisplay" -f $(if ($updateNeeded) {"UPDATE"} else {"OK"})) $(if ($updateNeeded) {"Yellow"} else {"Green"})
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
    $subRaw = & "git" "submodule" "status" 2>$null | Out-String
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

  if ($IsUpdate -and $updateNeeded -and ($Filter.Count -eq 0 -or $Filter -contains "glitch-memorycore submodule")) {
    $proceed = ($Filter.Count -gt 0 -or $Update) -or (Confirm-Update -Name "glitch-memorycore submodule" -FromVer "$currentSha" -ToVer "remote")
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

    if ($IsUpdate -and $outdatedCount -gt 0 -and ($Filter.Count -eq 0 -or $Filter -contains "@opencode-ai/plugin (.opencode)")) {
      Write-ColorHost "  Updating $outdatedCount package(s) in .opencode..." "Cyan"
      Push-Location $PluginDir
      try {
        # Use npm install @latest to get latest major versions, not just semver-compatible
        foreach ($pkg in $outdatedInfo) {
          & "npm" "install" "$($pkg.package)@latest" "--save" 2>&1 | Out-Null
        }
        Write-ColorHost "  Done." "Green"
        # Re-check versions after update
        $raw = & "npm" "outdated" "--json" 2>&1
        if ($raw) {
          $parsed = $raw | ConvertFrom-Json -ErrorAction SilentlyContinue
          if ($parsed -and $parsed.PSObject.Properties) {
            $outdatedInfo = @()
            $outdatedCount = 0
            foreach ($prop in $parsed.PSObject.Properties) {
              $outdatedInfo += @{ package = $prop.Name; current = $prop.Value.current; latest = $prop.Value.latest }
              $outdatedCount++
            }
          }
        }
      } catch {
        Write-ColorHost "  npm install failed: $_" "Red"
      }
      Pop-Location
    }
  } else {
    Write-ColorHost "  [SKIP] No package.json found in .opencode" "Gray"
  }

  $results += @{
    name = "@opencode-ai/plugin (.opencode)"
    current = $(if ($outdatedCount -gt 0) { ($outdatedInfo | ForEach-Object { "$($_.package): $($_.current)->$($_.latest)" }) -join "; " } else { "up to date" })
    latest = $(if ($outdatedCount -gt 0) { ($outdatedInfo | ForEach-Object { $_.latest }) -join "; " } else { "up to date" })
    update_available = ($outdatedCount -gt 0)
    update_type = $(if ($outdatedCount -gt 0) {"$outdatedCount package(s) outdated"} else {"none"})
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
      if ($verRaw -and $verRaw -match '(\d+\.\d+\.\d+)') {
        $curVer = $matches[1]
      } elseif ($verRaw) {
        $curVer = $verRaw.Trim()
      } else {
        $curVer = "unknown"
      }
    } catch { $curVer = "unknown" }
  } else {
    $curVer = "not installed"
  }

  $tag = Get-VersionTagFromRedirect -Url "https://github.com/cloudflare/cloudflared/releases/latest"
  if ($tag) {
    $tag = $tag.Trim()
    if ($tag -match '(\d+\.\d+\.\d+)') {
      $latestVer = $matches[1]
    } else {
      $latestVer = $tag
    }
  }

  if ($curVer -ne "unknown" -and $curVer -ne "not installed" -and $latestVer -ne "unknown" -and $latestVer -ne "" -and $curVer -ne $latestVer) {
    $updateNeeded = $true
    $updatesAvailable++
  }

  if ($IsUpdate -and $updateNeeded -and ($Filter.Count -eq 0 -or $Filter -contains "cloudflared")) {
    $proceed = ($Filter.Count -gt 0 -or $Update) -or (Confirm-Update -Name "cloudflared" -FromVer $curVer -ToVer $latestVer)
    if ($proceed) {
      $cloudflaredUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
      try {
        $outFile = Join-Path $RootDir "cloudflared.exe.tmp"
        $downloaded = Invoke-WithSpinner -Label "Downloading cloudflared" -ScriptBlock ([scriptblock]::Create("Invoke-WebRequest -Uri '$cloudflaredUrl' -OutFile '$outFile' -UseBasicParsing -TimeoutSec 60 -ErrorAction Stop"))
        if ($downloaded -and (Test-Path $outFile)) {
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
      # After successful update, re-check version and clear update flag
      if ($curVer -eq $latestVer) {
        $updateNeeded = $false
        $updatesAvailable--
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
  $releaseDate = $null

  # Get current version info (file date as proxy since no --version flag)
  if (Test-Path $HandyBin) {
    $fileInfo = Get-Item $HandyBin
    if ($fileInfo) {
      $fileSizeKB = [math]::Round($fileInfo.Length / 1KB, 1)
      $fileDate = $fileInfo.LastWriteTime
      $curInfo = '{0} ({1} KB)' -f $fileDate.ToString("yyyy-MM-dd"), $fileSizeKB
    } else {
      $curInfo = "exists (size unknown)"
    }
  } else {
    $curInfo = "not installed"
  }

  # Get latest version and release date from GitHub
  try {
    $json = Invoke-WebRequest -Uri "https://api.github.com/repos/cjpais/Handy/releases/latest" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    $data = $json | ConvertFrom-Json
    if ($data -and $data.tag_name) { $latestVer = $data.tag_name.Trim() }
    if ($data -and $data.published_at) { $releaseDate = [datetime]$data.published_at }
  } catch {}

  # Compare file date with release date (since no version flag available)
  if ($releaseDate -and (Test-Path $HandyBin)) {
    $fileInfo = Get-Item $HandyBin
    if ($fileInfo.LastWriteTime -lt $releaseDate) {
      $updateNeeded = $true
      $updatesAvailable++
    }
  } elseif ($latestVer -ne "unknown" -and $latestVer -ne "" -and $curInfo -eq "not installed") {
    $updateNeeded = $true
    $updatesAvailable++
  }

  if ($IsUpdate -and $updateNeeded -and ($Filter.Count -eq 0 -or $Filter -contains "Handy voice")) {
    $proceed = ($Filter.Count -gt 0 -or $Update) -or (Confirm-Update -Name "Handy voice" -FromVer $curInfo -ToVer $latestVer)
    if ($proceed) {
      Write-ColorHost "  Downloading latest Handy release..." "Cyan"
      try {
        # Determine architecture
        $isArm = (Get-CimInstance Win32_Processor).Architecture -eq 5
        $archSuffix = if ($isArm) { "arm64" } else { "x64" }
        
        # Find the MSI asset for this architecture (can be extracted with msiexec /a)
        # Asset name format: Handy_0.8.3_x64_en-US.msi (no 'v' prefix in version)
        $versionNoV = $latestVer.TrimStart('v')
        $json = Invoke-WebRequest -Uri "https://api.github.com/repos/cjpais/Handy/releases/latest" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        $data = $json | ConvertFrom-Json
        $assets = $data.assets
        $asset = $assets | Where-Object { $_.name -eq "Handy_${versionNoV}_${archSuffix}_en-US.msi" } | Select-Object -First 1
        
        if ($asset) {
          $msiUrl = $asset.browser_download_url
          $msiPath = Join-Path $env:TEMP "Handy_installer.msi"
          $extractDir = Join-Path $env:TEMP "Handy_extracted"
          
          Write-ColorHost "  Downloading: $msiUrl" "Cyan"
          Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing -TimeoutSec 60
          
          # Extract using msiexec /a (administrative install - extracts files without installing)
          if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue }
          New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
          
          Write-ColorHost "  Extracting with msiexec..." "Cyan"
          $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList "/a", "`"$msiPath`"", "/qn", "TARGETDIR=`"$extractDir`"" -Wait -PassThru
          if ($proc.ExitCode -ne 0) {
            Write-ColorHost "  MSI extraction failed (exit code: $($proc.ExitCode))." "Red"
          }
          
          # Find and copy handy.exe (should be in the extracted folder)
          $foundExe = Get-ChildItem -Path $extractDir -Recurse -Filter "handy.exe" | Select-Object -First 1
          if ($foundExe) {
            $src = $foundExe.Directory.FullName
            $HandyDir = Split-Path -Parent $HandyBin
            
            # Stop any running Handy process first (holds handle on directory)
            $handyProc = Get-Process -Name "handy" -ErrorAction SilentlyContinue
            $wasRunning = $false
            if ($handyProc) {
              Write-ColorHost "  Stopping Handy process (PID: $($handyProc.Id))..." "Cyan"
              Stop-Process -Id $handyProc.Id -Force -ErrorAction SilentlyContinue
              # Wait for process to fully exit
              $waitCount = 0
              while ((Get-Process -Name "handy" -ErrorAction SilentlyContinue) -and $waitCount -lt 10) {
                Start-Sleep -Seconds 1
                $waitCount++
              }
              $handyProc = Get-Process -Name "handy" -ErrorAction SilentlyContinue
              if ($handyProc) {
                Write-ColorHost "  WARNING: Handy process still running after stop attempt" "Yellow"
              } else {
                Write-ColorHost "  Handy process stopped" "Green"
              }
              $wasRunning = $true
            }
            
            # Now rename old dir (should work after process stopped)
            $oldDir = "$HandyDir.old"
            if (Test-Path $HandyDir) {
              if (Test-Path $oldDir) { Remove-Item $oldDir -Recurse -Force -ErrorAction SilentlyContinue }
              try {
                Rename-Item $HandyDir $oldDir -ErrorAction Stop
                Write-ColorHost "  Renamed old Handy dir to $oldDir" "Cyan"
              } catch {
                Write-ColorHost "  Rename failed: $($_.Exception.Message)" "Red"
                throw
              }
            }
            New-Item -ItemType Directory -Path $HandyDir -Force | Out-Null
            Copy-Item "$src\*" $HandyDir -Recurse -Force
            # Update file timestamp to now (Copy-Item preserves source timestamp)
            if (Test-Path $HandyBin) {
              (Get-Item $HandyBin).LastWriteTime = Get-Date
            }
            Write-ColorHost "  Handy updated to $latestVer" "Green"
            
            # Restart Handy if it was running
            if ($wasRunning) {
              Write-ColorHost "  Restarting Handy..." "Cyan"
              Start-Process -FilePath $HandyBin -WindowStyle Hidden
            }
            
            # Refresh version info
            if (Test-Path $HandyBin) {
              $fileInfo = Get-Item $HandyBin
              if ($fileInfo) {
                $fileSizeKB = [math]::Round($fileInfo.Length / 1KB, 1)
                $fileDate = $fileInfo.LastWriteTime
                $curInfo = '{0} ({1} KB)' -f $fileDate.ToString("yyyy-MM-dd"), $fileSizeKB
                $updateNeeded = $false
                $updatesAvailable--
              }
            }
            # Cleanup .old
            Remove-Item $oldDir -Recurse -Force -ErrorAction SilentlyContinue
          } else {
            Write-ColorHost "  Failed to find handy.exe in extracted MSI." "Red"
          }
          
          # Cleanup
          Remove-Item $msiPath -Force -ErrorAction SilentlyContinue
          Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
        } else {
          Write-ColorHost "  No MSI asset found for architecture: $archSuffix" "Yellow"
          Write-ColorHost "  Manual: https://github.com/cjpais/Handy/releases" "DarkYellow"
        }
      } catch {
        Write-ColorHost "  Download failed: $_" "Red"
        Write-ColorHost "  Manual: https://github.com/cjpais/Handy/releases" "DarkYellow"
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

# ========== 9. glitch-user-troy repo (user/) ==========
try {
  $UserDir = Join-Path $RootDir "user"
  $behindCount = "?"
  $dirtyCount = 0
  $updateNeeded = $false
  $branchName = "unknown"
  $displayLatest = "origin/main"

  if (Test-Path (Join-Path $UserDir ".git")) {
    $branchName = Get-CurrentBranch -WorkDir $UserDir
    if ($branchName -and $branchName -ne "detached") {
      $behindRaw = Get-RemoteBehindCount -WorkDir $UserDir -Branch $branchName
      if ($null -ne $behindRaw) {
        $behindCount = $behindRaw
        $displayLatest = "origin/$branchName"
        if ($behindCount -gt 0) {
          $updateNeeded = $true
          $updatesAvailable++
        }
      }
    }
    # Also count dirty files
    Push-Location $UserDir
    try {
      $dirtyRaw = & "git" "status" "--porcelain" 2>&1
      $dirtyCount = ($dirtyRaw | Where-Object { $_ -match '.' }).Count
    } catch { }
    Pop-Location
  } else {
    $behindCount = "not a repo"
  }

  if ($IsUpdate -and $updateNeeded -and ($Filter.Count -eq 0 -or $Filter -contains "glitch-user-troy (user/)")) {
    $proceed = ($Filter.Count -gt 0 -or $Update) -or (Confirm-Update -Name "glitch-user-troy repo (git pull)" -FromVer "$behindCount behind" -ToVer $displayLatest)
    if ($proceed) {
      Push-Location $UserDir
      Write-ColorHost "  Pulling from origin/$branchName..." "Cyan"
      $pullOut = & "git" "pull" "origin" $branchName 2>&1
      if ($LASTEXITCODE -eq 0) {
        Write-ColorHost "  Done." "Green"
        $updateNeeded = $false
        $behindCount = "0"
      } else {
        Write-ColorHost "  Pull failed. Output: $pullOut" "Red"
      }
      Pop-Location
    }
  }

  $dirtySuffix = if ($dirtyCount -gt 0) { " ($dirtyCount dirty)" } else { "" }
  $statusDisplay = if ($branchName -eq "detached") { "detached HEAD (skip)" } elseif ($null -eq $branchName) { "no branch (skip)" } elseif ($behindCount -eq "?") { "unknown" } elseif ($behindCount -eq "error") { "error" } else { "${branchName}: $behindCount commit(s) behind $displayLatest$dirtySuffix" }

  $results += @{
    name = "glitch-user-troy (user/)"
    current = $statusDisplay
    latest = $displayLatest
    update_available = $updateNeeded
    update_type = if ($updateNeeded) {"git pull"} else {"none"}
    auto_safe = $false
    status = if ($behindCount -eq "error") {"error"} else {"ok"}
    error_message = if ($behindCount -eq "error") {"git fetch/rev-list failed"} else {$null}
  }

  Write-ColorHost ("  [{0}] $statusDisplay" -f $(if ($updateNeeded) {"UPDATE"} else {"OK"})) $(if ($updateNeeded) {"Yellow"} else {"Green"})
} catch {
  $results += @{ name = "glitch-user-troy (user/)"; status = "error"; error_message = $_.Exception.Message }
  Write-ColorHost "  [ERROR] $_" "Red"
}

# ========== 10. Node.js (bundled) ==========
try {
  $curInfo = "not installed"
  $latestVer = "unknown"
  $updateNeeded = $false
  $systemVer = "unknown"
  $bundledVer = ""

  # Check system Node version
  try {
    $systemNode = Get-Command "node" -ErrorAction SilentlyContinue
    if ($systemNode) {
      $sv = & $systemNode.Source "--version" 2>$null
      if ($sv) { $systemVer = $sv.Trim() }
    }
  } catch { $systemVer = "unknown" }

  # Check bundled Node version
  $bundledNodeBin = Join-Path $RootDir "data\node\node.exe"
  if (Test-Path $bundledNodeBin) {
    try {
      $bv = & $bundledNodeBin "--version" 2>$null
      if ($bv) {
        $bundledVer = $bv.Trim()
        $curInfo = "$bundledVer (bundled)"
      } else {
        $curInfo = "exists (version unknown)"
      }
    } catch { $curInfo = "exists (version check failed)" }
  } elseif ($systemVer -ne "unknown") {
    $curInfo = "$systemVer (system)"
  }

  # Fetch latest LTS version
  try {
    $json = Invoke-WebRequest -Uri "https://nodejs.org/dist/index.json" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    $releases = $json | ConvertFrom-Json
    $latestLTS = ($releases | Where-Object { $_.lts -ne $false } | Select-Object -First 1)
    if ($latestLTS -and $latestLTS.version) {
      $latestVer = $latestLTS.version
    }
  } catch {
    $latestVer = "v22.14.0"  # fallback if offline
  }

  # Determine if update is needed (bundled version vs latest LTS)
  $hasUpdate = $false
  if ($bundledVer -and $bundledVer -ne $latestVer -and $latestVer -ne "unknown") {
    $hasUpdate = $true
    $updatesAvailable++
  }

  if ($IsUpdate -and $hasUpdate -and ($Filter.Count -eq 0 -or $Filter -contains "Node.js (bundled)")) {
    $proceed = ($Filter.Count -gt 0 -or $Update) -or (Confirm-Update -Name "Node.js (bundled)" -FromVer $bundledVer -ToVer $latestVer)
    if ($proceed) {
      $nodeArch = "x64"
      try {
        $isArm = (Get-CimInstance Win32_Processor).Architecture -eq 5
        if ($isArm) { $nodeArch = "arm64" }
      } catch { }

      $zipUrl = "https://nodejs.org/dist/$latestVer/node-$latestVer-win-$nodeArch.zip"
      $zipDir = Join-Path $RootDir "data\downloads"
      if (-not (Test-Path $zipDir)) { New-Item -ItemType Directory -Path $zipDir -Force | Out-Null }
      $zipPath = Join-Path $zipDir "node-portable.zip"
      try {
        $downloaded = Invoke-WithSpinner -Label "Downloading Node.js $latestVer" -ScriptBlock ([scriptblock]::Create("Invoke-WebRequest -Uri '$zipUrl' -OutFile '$zipPath' -UseBasicParsing -TimeoutSec 60 -ErrorAction Stop"))
        if ($downloaded -and (Test-Path $zipPath)) {
          $extractDir = "$env:TEMP\node-extracted"
          if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue }
          Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

          $exe = Get-ChildItem $extractDir -Recurse -Filter "node.exe" | Select-Object -First 1
          if ($exe) {
            $targetDir = Join-Path $RootDir "data\node"
            $oldDir = Join-Path $RootDir "data\node.old"
            # Rename old dir to .old first (rename works even with running executables on Windows)
            if (Test-Path $targetDir) {
              if (Test-Path $oldDir) { Remove-Item $oldDir -Recurse -Force -ErrorAction SilentlyContinue }
              Rename-Item $targetDir $oldDir -ErrorAction SilentlyContinue
            }
            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
            Copy-Item "$($exe.Directory.FullName)\*" $targetDir -Recurse -Force
            # Cleanup .old - may fail if node.exe still running; cleaned on next update
            Remove-Item $oldDir -Recurse -Force -ErrorAction SilentlyContinue
            Write-ColorHost "  Node.js $latestVer extracted to data/node/" "Green"
          }

          Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
          Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
        }
      } catch {
        Write-ColorHost "  Download failed: $_" "Red"
      }
    }
  }

  $results += @{
    name = "Node.js (bundled)"
    current = $curInfo
    latest = $latestVer
    update_available = $hasUpdate
    update_type = if ($hasUpdate) {"re-download"} else {"none"}
    auto_safe = $true
    status = "ok"
  }

  Write-ColorHost ("  [{0}] Current: {1} | Latest: {2}" -f $(if ($hasUpdate) {"UPDATE"} else {"OK"}), $curInfo, $latestVer) $(if ($hasUpdate) {"Yellow"} else {"Green"})
} catch {
  $results += @{ name = "Node.js (bundled)"; status = "error"; error_message = $_.Exception.Message }
  Write-ColorHost "  [ERROR] $_" "Red"
}

# ========== 11. NVIDIA Model Catalog (Free Endpoints) ==========
try {
  # Load persistent cache to avoid re-reporting the same models
  $watchlistCache = @{}
  if (Test-Path $NvidiaFreeWatchlistCache) {
    try {
      $cacheData = Get-Content $NvidiaFreeWatchlistCache -Raw | ConvertFrom-Json
      if ($cacheData.detected_models) {
        foreach ($m in $cacheData.detected_models) {
          $watchlistCache[$m] = $true
        }
      }
    } catch {
      # Ignore cache load errors - start fresh
    }
  }

  # Check for newly added free models by scraping a few key model card pages
  # (Only for high-priority models we're watching)
  # Note: Website URLs use nvidia/ prefix for all, but model cards are at /provider/model
  $watchList = @(
    "/minimaxai/minimax-m3",
    "/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    "/qwen/qwen3.5-122b-a10b",
    "/stepfun-ai/step-3.7-flash"
  )
  $newlyFree = @()
  $newlyDetected = @()
  foreach ($path in $watchList) {
    $modelId = $path.TrimStart('/')
    # Skip if already in cache (already reported)
    if ($watchlistCache.ContainsKey($modelId)) {
      continue
    }
    try {
      $cardUrl = "https://build.nvidia.com$path"
      $cardResponse = Invoke-WebRequest -Uri $cardUrl -Headers @{ "Accept" = "text/html" } -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
      if ($cardResponse.Content -match 'Free Endpoint') {
        $newlyFree += @{
          id = $modelId
          note = "Free Endpoint badge found on model card"
        }
        $newlyDetected += $modelId
      }
    } catch {
      # Ignore errors for individual model cards
    }
  }

  # Update cache with newly detected models
  if ($newlyDetected.Count -gt 0) {
    $existingModels = @()
    if (Test-Path $NvidiaFreeWatchlistCache) {
      try {
        $existingData = Get-Content $NvidiaFreeWatchlistCache -Raw | ConvertFrom-Json
        if ($existingData.detected_models) { $existingModels = @($existingData.detected_models) }
      } catch {}
    }
    $updatedModels = $existingModels + $newlyDetected | Sort-Object -Unique
    $cacheSave = @{
      cached_at = (Get-Date).ToString("o")
      detected_models = $updatedModels
    }
    $cacheSave | ConvertTo-Json -Depth 4 | Out-File -FilePath $NvidiaFreeWatchlistCache -Encoding utf8 -Force
  }

  $hasNewModels = $newlyFree.Count -gt 0
  if ($hasNewModels) { $updatesAvailable++ }

  if ($IsUpdate -and $hasNewModels -and ($Filter.Count -eq 0 -or $Filter -contains "NVIDIA Model Catalog")) {
    Write-ColorHost "  Newly free NVIDIA models detected:" "Cyan"
    foreach ($m in $newlyFree) {
      Write-ColorHost "    $($m.id) - $($m.note)" "DarkCyan"
    }
  }

  $results += @{
    name = "NVIDIA Model Catalog"
    current = "watchlist-based detection"
    latest = "NVIDIA build.nvidia.com model cards"
    update_available = $hasNewModels
    update_type = if ($hasNewModels) {"$($newlyFree.Count) newly free model(s)"} else {"none"}
    auto_safe = $false
    status = "ok"
    newly_free = $newlyFree
  }

  if ($hasNewModels) {
    Write-ColorHost "  [UPDATE] $($newlyFree.Count) newly free model(s) detected" "Yellow"
    foreach ($m in $newlyFree) {
      Write-ColorHost "    $($m.id)" "DarkYellow"
    }
  } else {
    Write-ColorHost "  [OK] No newly free models detected on watchlist" "Green"
  }
} catch {
  $results += @{ name = "NVIDIA Model Catalog"; status = "error"; error_message = $_.Exception.Message }
  Write-ColorHost "  [ERROR] $_" "Red"
}

# ========== 12. External tool dependencies (config/tools.json) ==========
try {
  $toolManifestPath = Join-Path $RootDir "config\tools.json"
  if (Test-Path $toolManifestPath) {
    $toolManifest = Get-Content $toolManifestPath -Raw | ConvertFrom-Json
    foreach ($tool in $toolManifest.tools) {
      $toolName = $tool.name
      $curVer = "not installed"
      $latestVer = $tool.version
      $updateNeeded = $false
      $status = "ok"

      if ($tool.type -eq "npm") {
        # npm-installed tool
        try {
          $npmOut = & "npm.cmd" "list" "-g" "--depth=0" $tool.package 2>&1
          if ($LASTEXITCODE -eq 0 -and $npmOut) {
            $curVer = "not installed"
            foreach ($line in $npmOut) {
              if ($line -match "@?\S+@(\S+)") {
                $curVer = $matches[1]
                break
              }
            }
            if ($curVer -ne $latestVer -and $latestVer -ne "latest") {
              $updateNeeded = $true
              $updatesAvailable++
            }
          } else {
            $curVer = "not installed"
            $updateNeeded = $true
            $updatesAvailable++
          }
        } catch {
          $curVer = "check failed"
          $status = "error"
        }

        if ($IsUpdate -and $updateNeeded -and ($Filter.Count -eq 0 -or $Filter -contains $toolName)) {
          $proceed = ($Filter.Count -gt 0 -or $Update) -or (Confirm-Update -Name "$toolName (npm)" -FromVer $curVer -ToVer $latestVer)
          if ($proceed) {
            Write-ColorHost "  Installing $($tool.package)..." "Cyan"
            & "npm.cmd" "install" "-g" $tool.package 2>&1
            Write-ColorHost "  Done." "Green"
            $updateNeeded = $false
          }
}
    } else {
        # Binary tool
        $binaryPath = Join-Path $RootDir $tool.binary
        if (Test-Path $binaryPath) {
          try {
            $verOut = & $binaryPath "--version" 2>&1
            $verLine = ($verOut | ForEach-Object { "$_" } | Select-Object -First 1).Trim()
            if ($LASTEXITCODE -eq 0 -and $verLine) {
              $curVer = $verLine
            } else {
              $verOut = & $binaryPath "-version" 2>&1
              $verLine = ($verOut | ForEach-Object { "$_" } | Select-Object -First 1).Trim()
              if ($LASTEXITCODE -eq 0 -and $verLine) {
                $curVer = $verLine
              } else {
                $curVer = "exists (version unknown)"
              }
            }
          } catch {
            $curVer = "exists (version check failed)"
          }
          # For now, don't auto-update binaries -- could be destructive
          $updateNeeded = $false
        } else {
          $curVer = "not installed"
          $updateNeeded = $true
          $updatesAvailable++

          # Auto-download on first run (when in update mode)
          if ($IsUpdate -and ($Filter.Count -eq 0 -or $Filter -contains $toolName)) {
            $platform = "win32"
            $platformConfig = $tool.platforms.$platform
            if ($platformConfig -and $platformConfig.url) {
              $url = $platformConfig.url -replace "{version}", $tool.version
              $binaryDir = Split-Path -Parent $binaryPath
              if (-not (Test-Path $binaryDir)) { New-Item -ItemType Directory -Path $binaryDir -Force | Out-Null }

              Write-ColorHost "  Downloading $toolName..." "Cyan"
              $ext = if ($platformConfig.archive -eq "zip") { ".zip" } else { ".tar.gz" }
              $archivePath = Join-Path $env:TEMP "$toolName$ext"
              try {
                Invoke-WebRequest -Uri $url -OutFile $archivePath -UseBasicParsing -TimeoutSec 30

                if ($platformConfig.archive -eq "zip") {
                  Expand-Archive -Path $archivePath -DestinationPath $binaryDir -Force
                } elseif ($platformConfig.archive -eq "targz") {
                  # tar.exe is available on Windows 10 1803+ (2018+)
                  tar -xzf $archivePath -C $binaryDir 2>&1 | Out-Null
                  if (-not (Test-Path $binaryPath)) {
                    # Fallback: search recursively for the binary
                    $found = Get-ChildItem -Path $binaryDir -Recurse -Filter "$toolName*" | Select-Object -First 1
                    if ($found) {
                      Move-Item $found.FullName $binaryPath -Force
                    }
                  }
                }

                if (Test-Path $binaryPath) {
                  Write-ColorHost "  $toolName installed to $binaryPath" "Green"
                  $curVer = "installed"
                  $updateNeeded = $false
                  $updatesAvailable--
                } else {
                  Write-ColorHost "  $toolName download complete but binary not found at expected path" "Yellow"
                }
              } catch {
                Write-ColorHost "  Download failed: $_" "Red"
              }
              Remove-Item $archivePath -Force -ErrorAction SilentlyContinue
            } else {
              Write-ColorHost "  No download URL configured for $toolName on $platform" "Yellow"
            }
          }
        }
    }

      $results += @{
        name = "tool: $toolName"
        current = $curVer
        latest = $latestVer
        update_available = $updateNeeded
        update_type = if ($updateNeeded) {"install/reinstall"} else {"none"}
        auto_safe = ($tool.type -eq "npm")
        status = $status
      }

      $statusDisplay = if ($status -eq "error") {"ERROR"} elseif ($updateNeeded) {"MISSING"} else {"OK"}
      $statusColor = if ($status -eq "error") {"Red"} elseif ($updateNeeded) {"Yellow"} else {"Green"}
      Write-ColorHost ("  [{0}] {1}: {2} (expected: {3})" -f $statusDisplay, $toolName, $curVer, $latestVer) $statusColor
    }
  } else {
    Write-ColorHost "  [SKIP] tools manifest not found at config/tools.json" "Gray"
  }
} catch {
  Write-ColorHost "  [ERROR] tool dependency check failed: $_" "Red"
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
