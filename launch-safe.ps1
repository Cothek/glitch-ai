$RootDir = Split-Path -Parent $PSCommandPath
$OpenCodeBin = "$RootDir\opencode\opencode.exe"
$ConfigPath = "$RootDir\opencode.json"
$BackupPath = "$RootDir\opencode.json.bak"

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "== Safe Mode ==" -ForegroundColor Cyan
Write-Host ""

# Check opencode exists
if (-not (Test-Path $OpenCodeBin)) {
  Write-Host "OpenCode not found. Run bootstrap.ps1 first." -ForegroundColor Red
  exit 1
}

#  Backup current config and save its checksum 
$backupHashAtStart = $null
if (Test-Path $ConfigPath) {
  Write-Host "  Backing up opencode.json -> opencode.json.bak" -ForegroundColor Yellow
  Copy-Item $ConfigPath $BackupPath -Force
  $backupHashAtStart = (Get-FileHash $BackupPath -Algorithm SHA256).Hash
}

#  Build safe config programmatically (guaranteed valid JSON via ConvertTo-Json) 
# No instructions files  fully self-contained so nothing external can break safe mode.
# No sub-agents  only the delegator with full permissions.
$safePrompt = @"
You are Glitch running in SAFE MODE. Something is broken with the Glitch configuration and Troy needs your help to fix it.

## Safe Mode Rules
1. You have FULL permissions (edit, bash, task) -- use them to diagnose and fix problems.
2. The current opencode.json may be corrupted or incompatible. Check it first.
3. Listen to Troy's description of what went wrong and systematically diagnose:
   - Check opencode.json for syntax errors
   - Check for missing files referenced in config
   - Check for incompatible config keys
   - Check that git submodules are initialized
4. After fixing, tell Troy to exit safe mode and launch normally.
5. If you can't fix it, restore opencode.json.bak over opencode.json.
6. Stay focused on repair -- no new features, no dev work.

## CRITICAL: Where to Apply Fixes
- **opencode.json.bak** is the backup of your ORIGINAL (broken) config. This is what gets restored when safe mode exits. Apply ALL fixes to this file.
- **opencode.json** is a temporary minimal config that lets safe mode run. Any edits made here will BE LOST when safe mode exits  do NOT rely on it for permanent fixes.
- After fixing opencode.json.bak, run: `validate-config.ps1` on it to verify it's valid.
- Then tell Troy to exit safe mode. The fixed backup will be restored automatically.
"@

$safeConfig = @{
    '$schema' = 'https://opencode.ai/config.json'
    agent = @{
        delegator = @{
            model = 'opencode-go/deepseek-v4-flash'
            mode = 'primary'
            description = 'Safe mode - troubleshoot and repair Glitch configuration'
            color = '#e74c3c'
            temperature = 0.2
            permission = @{
                read = 'allow'
                edit = 'allow'
                bash = 'allow'
                glob = 'allow'
                grep = 'allow'
                list = 'allow'
                webfetch = 'allow'
                question = 'allow'
                skill = 'allow'
                todowrite = 'allow'
                task = 'allow'
            }
            prompt = $safePrompt
        }
    }
    attachment = @{
        image = @{
            auto_resize = $true
            max_width = 2000
            max_height = 2000
            max_base64_bytes = 5242880
        }
    }
}

# Convert to JSON and validate by re-parsing
try {
    $safeJson = $safeConfig | ConvertTo-Json -Depth 10
    $null = $safeJson | ConvertFrom-Json
} catch {
    Write-Host "  CRITICAL: Safe mode config is invalid JSON. This should never happen." -ForegroundColor Red
    Write-Host "  Error: $_" -ForegroundColor Red
    if (Test-Path $BackupPath) {
        Write-Host "  Restoring original config..." -ForegroundColor Yellow
        Move-Item $BackupPath $ConfigPath -Force
    }
    exit 1
}

Write-Host "  Writing safe mode config..." -ForegroundColor Cyan
$safeJson | Out-File -FilePath $ConfigPath -Encoding utf8 -Force

#  Launch opencode with safe config 
Write-Host ""
Write-Host "  Starting OpenCode in safe mode..." -ForegroundColor Cyan
Write-Host "  When you're done fixing, exit normally and the original config will be restored."
Write-Host ""
Write-Host "  IMPORTANT: Fix the ISSUE in opencode.json.bak, not in opencode.json."
Write-Host "  opencode.json will be replaced on exit. The .bak file is what persists."
Write-Host ""

Push-Location $RootDir
try {
    & $OpenCodeBin
} catch {
    Write-Host "  OpenCode exited with error: $_" -ForegroundColor Red
} finally {
    Pop-Location
}

#  Restore original config (with safety check) 
if (Test-Path $BackupPath) {
    $backupHashNow = (Get-FileHash $BackupPath -Algorithm SHA256).Hash
    $configHashNow = (Get-FileHash $ConfigPath -Algorithm SHA256).Hash
    
    if ($backupHashNow -eq $backupHashAtStart) {
        # Backup was NOT modified during safe mode
        Write-Host ""
        Write-Host "  WARNING: opencode.json.bak was NOT modified during safe mode." -ForegroundColor Yellow
        Write-Host "  If you made any fixes, they were applied to the wrong file and will be lost." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  Do you want to:" -ForegroundColor Cyan
        Write-Host "    [R] Restore the original (unfixed) config from backup" -ForegroundColor Gray
        Write-Host "    [K] Keep the current opencode.json as-is (promote safe config)" -ForegroundColor Gray
        $choice = Read-Host "  Choose (R/K)"
        
        if ($choice -eq 'K' -or $choice -eq 'k') {
            Write-Host "  Keeping current config, discarding backup." -ForegroundColor Yellow
            Remove-Item $BackupPath -Force
            Write-Host "  Current opencode.json kept in place." -ForegroundColor Green
        } else {
            Write-Host "  Restoring original (unfixed) config from backup..." -ForegroundColor Yellow
            Move-Item $BackupPath $ConfigPath -Force
            Write-Host "  Original config restored." -ForegroundColor Green
        }
    } else {
        # Backup was modified  agent followed instructions and fixed it
        Write-Host ""
        Write-Host "  Backup was modified  restoring fixed config." -ForegroundColor Green
        Move-Item $BackupPath $ConfigPath -Force
        Write-Host "  Fixed config restored." -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Safe mode ended." -ForegroundColor Cyan
