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

# â”€â”€ Resolve path â”€â”€
if (-not $Path) {
    $ScriptDir = Split-Path -Parent $PSCommandPath
    $Path = "$ScriptDir\opencode.json"
}

if (-not (Test-Path $Path)) {
    if (-not $Quiet) { Write-Host "âŒ File not found: $Path" -ForegroundColor Red }
    exit 1
}

$RootDir = Split-Path -Parent (Resolve-Path $Path)
$exitCode = 0
$errors = @()

# â”€â”€ 1. JSON Syntax Check â”€â”€
if (-not $Quiet) { Write-Host "ðŸ” Validating: $Path" -ForegroundColor Cyan }
try {
    $raw = Get-Content $Path -Raw
    $config = $raw | ConvertFrom-Json
    if (-not $Quiet) { Write-Host "  âœ… Valid JSON" -ForegroundColor Green }
} catch {
    $errors += "JSON syntax error: $_"
    if (-not $Quiet) { Write-Host "  âŒ $($errors[-1])" -ForegroundColor Red }
    $exitCode = 1
    # Can't continue checks if JSON is invalid
    exit $exitCode
}

# â”€â”€ 2. Check instructions files exist â”€â”€
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
        if (-not $Quiet) { Write-Host "  âŒ Missing instruction files: $($missingInstructions -join ', ')" -ForegroundColor Red }
        $exitCode = 1
    } else {
        if (-not $Quiet) { Write-Host "  âœ… All instruction files exist" -ForegroundColor Green }
    }
}

# â”€â”€ 3. Check agent configs â”€â”€
if ($config.agent) {
    $agentNames = @()
    foreach ($agent in $config.agent.PSObject.Properties) {
        $agentNames += $agent.Name
        $agentConfig = $agent.Value

        # Check model field exists
        if (-not $agentConfig.model) {
            $errors += "Agent '$($agent.Name)' has no model specified"
            if (-not $Quiet) { Write-Host "  âŒ Agent '$($agent.Name)' has no model specified" -ForegroundColor Red }
            $exitCode = 1
        }

        # Check mode is valid
        if ($agentConfig.mode -and @('primary', 'subagent') -notcontains $agentConfig.mode) {
            $errors += "Agent '$($agent.Name)' has invalid mode '$($agentConfig.mode)'"
            if (-not $Quiet) { Write-Host "  âŒ Agent '$($agent.Name)' has invalid mode '$($agentConfig.mode)'" -ForegroundColor Red }
            $exitCode = 1
        }

        # Check temperature range
        if ($agentConfig.temperature -and ($agentConfig.temperature -lt 0 -or $agentConfig.temperature -gt 2)) {
            $errors += "Agent '$($agent.Name)' has temperature out of range (0-2): $($agentConfig.temperature)"
            if (-not $Quiet) { Write-Host "  âŒ Agent '$($agent.Name)' has temperature out of range (0-2): $($agentConfig.temperature)" -ForegroundColor Red }
            $exitCode = 1
        }
    }

    # Check for duplicate agent names
    $dupes = $agentNames | Group-Object | Where-Object { $_.Count -gt 1 }
    if ($dupes) {
        foreach ($d in $dupes) {
            $errors += "Duplicate agent name: '$($d.Name)'"
            if (-not $Quiet) { Write-Host "  âŒ Duplicate agent name: '$($d.Name)'" -ForegroundColor Red }
        }
        $exitCode = 1
    }

    if ($errors.Count -eq 0 -and (-not $Quiet)) {
        Write-Host "  âœ… Agents: $($agentNames.Count) configured, all valid" -ForegroundColor Green
    }
}

# â”€â”€ 4. Check required top-level keys â”€â”€
$requiredKeys = @('agent')
foreach ($key in $requiredKeys) {
    if (-not $config.PSObject.Properties.Name.Contains($key)) {
        $errors += "Missing required key: '$key'"
        if (-not $Quiet) { Write-Host "  âŒ Missing required key: '$key'" -ForegroundColor Red }
        $exitCode = 1
    }
}

# â”€â”€ Summary â”€â”€
if ($exitCode -eq 0) {
    if (-not $Quiet) { Write-Host "`nâœ… Config validation PASSED" -ForegroundColor Green }
} else {
    if (-not $Quiet) {
        Write-Host "`nâŒ Config validation FAILED â€” $($errors.Count) error(s)" -ForegroundColor Red
        Write-Host "  Run launch-glitch-safe.bat to enter safe mode and fix issues." -ForegroundColor Yellow
    }
}

exit $exitCode
