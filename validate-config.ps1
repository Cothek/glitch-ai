<#
.SYNOPSIS
  Validate opencode.json for JSON syntax and file reference integrity.
.DESCRIPTION
  Checks:
    1. JSON syntax (must parse with ConvertFrom-Json)
    2. All referenced instruction files exist
    3. All agent model references exist
    4. No duplicate agent names
    5. All required top-level keys are present
  This can be run independently, called from git hooks, or used as a CI gate.
.EXAMPLE
  .\validate-config.ps1
  .\validate-config.ps1 -Path .\opencode.json
  .\validate-config.ps1 -Path .\opencode.json -Quiet
#>

param(
    [string]$Path = "",
    [switch]$Quiet
)

# ---- Resolve path ----
if (-not $Path) {
    $ScriptDir = Split-Path -Parent $PSCommandPath
    $Path = "$ScriptDir\opencode.json"
}

if (-not (Test-Path $Path)) {
    if (-not $Quiet) { Write-Host "ERROR: File not found: $Path" -ForegroundColor Red }
    exit 1
}

$RootDir = Split-Path -Parent (Resolve-Path $Path)
$exitCode = 0
$errors = @()

# ---- 1. JSON Syntax Check ----
if (-not $Quiet) { Write-Host "==> Validating: $Path" -ForegroundColor Cyan }
try {
    $raw = Get-Content $Path -Raw
    $config = $raw | ConvertFrom-Json
    if (-not $Quiet) { Write-Host "  [OK] Valid JSON" -ForegroundColor Green }
} catch {
    $errors += "JSON syntax error: $_"
    if (-not $Quiet) { Write-Host "  [FAIL] $($errors[-1])" -ForegroundColor Red }
    $exitCode = 1
    # Can't continue checks if JSON is invalid
    exit $exitCode
}

# ---- 2. Check instructions files exist ----
if ($config.instructions) {
    $missingInstructions = @()
    foreach ($file in $config.instructions) {
        $fullPath = Join-Path $RootDir $file
        if (-not (Test-Path $fullPath)) {
            $missingInstructions += $file
        }
    }
    if ($missingInstructions.Count -gt 0) {
        $errors += "Missing instruction files: $($missingInstructions -join ', ')"
        if (-not $Quiet) { Write-Host "  [FAIL] Missing instruction files: $($missingInstructions -join ', ')" -ForegroundColor Red }
        $exitCode = 1
    } else {
        if (-not $Quiet) { Write-Host "  [OK] All instruction files exist" -ForegroundColor Green }
    }
}

# ---- 3. Check agent configs ----
if ($config.agent) {
    $agentNames = @()
    foreach ($agent in $config.agent.PSObject.Properties) {
        $agentNames += $agent.Name
        $agentConfig = $agent.Value

        # Check model field exists
        if (-not $agentConfig.model) {
            $errors += "Agent '$($agent.Name)' has no model specified"
            if (-not $Quiet) { Write-Host "  [FAIL] Agent '$($agent.Name)' has no model specified" -ForegroundColor Red }
            $exitCode = 1
        }

        # Check mode is valid
        if ($agentConfig.mode -and @('primary', 'subagent') -notcontains $agentConfig.mode) {
            $errors += "Agent '$($agent.Name)' has invalid mode '$($agentConfig.mode)'"
            if (-not $Quiet) { Write-Host "  [FAIL] Agent '$($agent.Name)' has invalid mode '$($agentConfig.mode)'" -ForegroundColor Red }
            $exitCode = 1
        }

        # Check temperature range
        if ($agentConfig.temperature -and ($agentConfig.temperature -lt 0 -or $agentConfig.temperature -gt 2)) {
            $errors += "Agent '$($agent.Name)' has temperature out of range (0-2): $($agentConfig.temperature)"
            if (-not $Quiet) { Write-Host "  [FAIL] Agent '$($agent.Name)' has temperature out of range (0-2): $($agentConfig.temperature)" -ForegroundColor Red }
            $exitCode = 1
        }
    }

    # Check for duplicate agent names
    $dupes = $agentNames | Group-Object | Where-Object { $_.Count -gt 1 }
    if ($dupes) {
        foreach ($d in $dupes) {
            $errors += "Duplicate agent name: '$($d.Name)'"
            if (-not $Quiet) { Write-Host "  [FAIL] Duplicate agent name: '$($d.Name)'" -ForegroundColor Red }
        }
        $exitCode = 1
    }

    if ($errors.Count -eq 0 -and (-not $Quiet)) {
        Write-Host "  [OK] Agents: $($agentNames.Count) configured, all valid" -ForegroundColor Green
    }
}

# ---- 4.5 Check PowerShell scripts for non-ASCII characters ----
# Non-ASCII chars in .ps1 files (em dashes, box drawing, emojis) break
# PowerShell 5.1 on Windows because it reads BOM-less UTF-8 as Windows-1252,
# where byte 0x94 (part of em dash U+2014) becomes a quote character.
$psScripts = @('launch.ps1', 'launch-safe.ps1', 'launch-free.ps1', 'serve-glitch.ps1', 'validate-config.ps1')
$encodingErrors = @()
foreach ($script in $psScripts) {
    $scriptPath = Join-Path $RootDir $script
    if (-not (Test-Path $scriptPath)) { continue }
    $bytes = [System.IO.File]::ReadAllBytes($scriptPath)
    $hasNonAscii = $false
    foreach ($b in $bytes) {
        if ($b -gt 0x7F) { $hasNonAscii = $true; break }
    }
    if ($hasNonAscii) {
        $encodingErrors += "$script contains non-ASCII bytes"
        if (-not $Quiet) { Write-Host "  [FAIL] $script has non-ASCII characters (will break PowerShell 5.1)" -ForegroundColor Red }
        $exitCode = 1
    } else {
        if (-not $Quiet) { Write-Host "  [OK] $script is pure ASCII" -ForegroundColor Green }
    }
}

# ---- 5. Check required top-level keys ----
$requiredKeys = @('agent')
foreach ($key in $requiredKeys) {
    if (-not $config.PSObject.Properties.Name.Contains($key)) {
        $errors += "Missing required key: '$key'"
        if (-not $Quiet) { Write-Host "  [FAIL] Missing required key: '$key'" -ForegroundColor Red }
        $exitCode = 1
    }
}

# ---- Summary ----
if ($exitCode -eq 0) {
    if (-not $Quiet) { Write-Host "
[PASS] Config validation PASSED" -ForegroundColor Green }
} else {
    if (-not $Quiet) {
        Write-Host "
[FAIL] Config validation FAILED - $($errors.Count) error(s)" -ForegroundColor Red
        Write-Host "  Run launch-glitch-safe.bat to enter safe mode and fix issues." -ForegroundColor Yellow
    }
}

exit $exitCode
