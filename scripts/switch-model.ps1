# switch-model.ps1 -- Interactive free model picker + preference saver
# Usage:
#   .\scripts\switch-model.ps1          # Interactive menu
#   .\scripts\switch-model.ps1 -List    # List available models
#   .\scripts\switch-model.ps1 -Set "nvidia/z-ai/glm-5.1"  # Set directly (no menu)
#   .\scripts\switch-model.ps1 -Reset   # Clear saved preference

param(
    [switch]$List,
    [string]$Set,
    [switch]$Reset,
    [switch]$Quiet
)

$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Split-Path -Parent $ScriptDir
$PrefFile = "$RootDir\data\free-model-preference.json"

$ErrorActionPreference = "Continue"

# --- Known free models ---------------------------------------------------------
# Grouped by provider for the menu
$ModelGroups = @(
    @{
        Name = "NVIDIA (free endpoint, requires /connect)"
        Models = @(
            @{ ID = "nvidia/z-ai/glm-5.1"; Name = "GLM-5.1"; Tag = "default" }
            @{ ID = "nvidia/qwen/qwen3-coder-480b-a35b-instruct"; Name = "Qwen3-Coder 480B"; Tag = "" }
            @{ ID = "nvidia/minimaxai/minimax-m2.7"; Name = "MiniMax M2.7"; Tag = "" }
            @{ ID = "nvidia/stepfun-ai/step-3.7-flash"; Name = "Step 3.7 Flash"; Tag = "" }
            @{ ID = "nvidia/mistralai/mistral-large-3-675b-instruct-2512"; Name = "Mistral Large 3"; Tag = "" }
        )
    }
    @{
        Name = "OpenCode Zen (free tier)"
        Models = @(
            @{ ID = "opencode/deepseek-v4-flash-free"; Name = "DeepSeek V4 Flash"; Tag = "" }
            @{ ID = "opencode/qwen3.6-plus-free"; Name = "Qwen 3.6 Plus"; Tag = "" }
            @{ ID = "opencode/mimo-v2.5-free"; Name = "Mimo v2.5"; Tag = "" }
            @{ ID = "opencode/minimax-m3-free"; Name = "MiniMax M3"; Tag = "" }
            @{ ID = "opencode/nemotron-3-super-free"; Name = "Nemotron 3 Super"; Tag = "" }
            @{ ID = "opencode/big-pickle"; Name = "Big Pickle"; Tag = "" }
        )
    }
)

# Flat lookup table
$AllModels = @{}
foreach ($group in $ModelGroups) {
    foreach ($m in $group.Models) {
        $AllModels[$m.ID] = @{ Name = $m.Name; Group = $group.Name; Tag = $m.Tag }
    }
}

# --- Helper: Load preference ---------------------------------------------------
function Get-Preference {
    if (-not (Test-Path $PrefFile)) { return $null }
    try {
        $pref = Get-Content $PrefFile -Raw | ConvertFrom-Json
        if ($pref.model) { return $pref.model }
    } catch { }
    return $null
}

# --- Helper: Save preference ---------------------------------------------------
function Set-Preference($modelId) {
    $prefDir = Split-Path -Parent $PrefFile
    if (-not (Test-Path $prefDir)) { New-Item -ItemType Directory -Path $prefDir -Force | Out-Null }
    $pref = @{
        model = $modelId
        name = $AllModels[$modelId].Name
        set_at = (Get-Date).ToString("o")
    }
    $pref | ConvertTo-Json | Out-File -FilePath $PrefFile -Encoding utf8 -Force
}

# --- Helper: Clear preference --------------------------------------------------
function Clear-Preference {
    if (Test-Path $PrefFile) {
        Remove-Item $PrefFile -Force
        if (-not $Quiet) { Write-Host " Preference cleared." -ForegroundColor Yellow }
    }
}

# --- -List: just print models --------------------------------------------------
if ($List) {
    Write-Host ""
    Write-Host " Available Free Models" -ForegroundColor Cyan
    Write-Host ""
    $current = Get-Preference
    foreach ($group in $ModelGroups) {
        Write-Host " $($group.Name)" -ForegroundColor Yellow
        foreach ($m in $group.Models) {
            $marker = if ($m.ID -eq $current) { " < current" } else { "" }
            $tagStr = if ($m.Tag) { " ($($m.Tag))" } else { "" }
            Write-Host "   $($m.ID.PadRight(55)) $($m.Name)$tagStr$marker" -ForegroundColor $(if ($m.ID -eq $current) { "Green" } else { "Gray" })
        }
        Write-Host ""
    }
    if ($current) {
        Write-Host " Saved preference: $current ($($AllModels[$current].Name))" -ForegroundColor Green
    } else {
        Write-Host " No saved preference (will prompt on launch)" -ForegroundColor DarkGray
    }
    Write-Host ""
    exit 0
}

# --- -Reset: clear preference --------------------------------------------------
if ($Reset) {
    Clear-Preference
    exit 0
}

# --- -Set: set directly --------------------------------------------------------
if ($Set -ne "") {
    if (-not $AllModels.ContainsKey($Set)) {
        Write-Host ""
        Write-Host " ERROR: Unknown model '$Set'" -ForegroundColor Red
        Write-Host " Run with -List to see available models." -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }
    Set-Preference $Set
    if (-not $Quiet) {
        Write-Host ""
        Write-Host " Free model set to: $Set ($($AllModels[$Set].Name))" -ForegroundColor Green
        Write-Host " Next launch will use this model. Run with -Reset to clear." -ForegroundColor DarkGray
        Write-Host ""
    }
    exit 0
}

# --- Interactive menu ----------------------------------------------------------
$current = Get-Preference

Write-Host ""
Write-Host " Glitch Free Mode -- Model Picker" -ForegroundColor Green
Write-Host ""
if ($current) {
    Write-Host " Current preference: $current ($($AllModels[$current].Name))" -ForegroundColor Cyan
} else {
    Write-Host " No preference saved -- default is nvidia/z-ai/glm-5.1" -ForegroundColor DarkGray
}
Write-Host ""

# Build flat numbered list
$choices = @()
$idx = 1
foreach ($group in $ModelGroups) {
    Write-Host " $($group.Name)" -ForegroundColor Yellow
    foreach ($m in $group.Models) {
        $marker = if ($m.ID -eq $current) { " *" } else { "" }
        $tagStr = if ($m.Tag) { " ($($m.Tag))" } else { "" }
        Write-Host "   [$idx] $($m.Name)$tagStr$marker" -ForegroundColor $(if ($m.ID -eq $current) { "Green" } else { "White" })
        Write-Host "       $($m.ID)" -ForegroundColor DarkGray
        $choices += $m
        $idx++
    }
    Write-Host ""
}

# Add "clear preference" option
Write-Host "   [0] Clear saved preference (prompt on next launch)" -ForegroundColor DarkYellow
Write-Host ""

# Prompt for selection
$selection = Read-Host "Pick a model (0-$($choices.Count))"

if ($selection -eq "0") {
    Clear-Preference
    Write-Host ""
    Write-Host " Preference cleared. Next launch will prompt or use default." -ForegroundColor Yellow
    Write-Host ""
    exit 0
}

$num = 0
if ([int]::TryParse($selection, [ref]$num) -and $num -ge 1 -and $num -le $choices.Count) {
    $chosen = $choices[$num - 1]
    Set-Preference $chosen.ID
    Write-Host ""
    Write-Host " Set: $($chosen.ID) ($($chosen.Name))" -ForegroundColor Green
    Write-Host " Next launch will use this model." -ForegroundColor DarkGray
    Write-Host ""
    exit 0
} else {
    Write-Host ""
    Write-Host " Invalid selection: '$selection'" -ForegroundColor Red
    Write-Host " Run again and pick a number from 0 to $($choices.Count)." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
