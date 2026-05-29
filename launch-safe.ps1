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

# ── Backup current config ──
if (Test-Path $ConfigPath) {
  Write-Host "  Backing up opencode.json -> opencode.json.bak" -ForegroundColor Yellow
  Copy-Item $ConfigPath $BackupPath -Force
}

# ── Build safe config programmatically (guaranteed valid JSON via ConvertTo-Json) ──
# No instructions files — fully self-contained so nothing external can break safe mode.
# No sub-agents — only the delegator with full permissions.
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

# ── Launch opencode with safe config ──
Write-Host ""
Write-Host "  Starting OpenCode in safe mode..." -ForegroundColor Cyan
Write-Host "  When you're done fixing, exit normally and the original config will be restored."
Write-Host ""

Push-Location $RootDir
try {
    & $OpenCodeBin
} catch {
    Write-Host "  OpenCode exited with error: $_" -ForegroundColor Red
} finally {
    Pop-Location
}

# ── Restore original config ──
if (Test-Path $BackupPath) {
    Write-Host ""
    Write-Host "  Restoring original opencode.json..." -ForegroundColor Yellow
    Move-Item $BackupPath $ConfigPath -Force
    Write-Host "  Original config restored." -ForegroundColor Green
}

Write-Host ""
Write-Host "Safe mode ended." -ForegroundColor Cyan
