$RootDir = Split-Path -Parent $PSCommandPath
$CacheDir = "$RootDir\glitch-memorycore\data"
$CacheFile = "$CacheDir\known-models.json"
$StatusFile = "$RootDir\model-update-status.json"
$ConfigFile = "$RootDir\opencode.json"

$ErrorActionPreference = "Continue"

# ─── Parse flags ──────────────────────────────────────────────────────────────
$ResetCache = $args -contains "-ResetCache"
$UpdateCache = $args -contains "-UpdateCache"
$CheckOnly = (-not $ResetCache -and -not $UpdateCache) -or $args -contains "-CheckOnly"

# ─── Helper: fetch JSON from a URL ────────────────────────────────────────────
function Fetch-Models($url) {
    try {
        $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 15 -ErrorAction Stop
        $ids = if ($response.data) { $response.data.id } else { @() }
        return @($ids | Where-Object { $_ -ne $null })
    } catch {
        Write-Host "    [WARN] Failed to fetch $url : $_" -ForegroundColor Yellow
        return $null
    }
}

# ─── Helper: fetch NVIDIA models (needs API key) ──────────────────────────────
function Fetch-NvidiaModels {
    # Try environment variable first
    $apiKey = $env:NVIDIA_API_KEY

    # Fall back to opencode auth store
    if (-not $apiKey) {
        $authFile = "$env:USERPROFILE\.local\share\opencode\auth.json"
        if (Test-Path $authFile) {
            try {
                $auth = Get-Content $authFile -Raw | ConvertFrom-Json
                # NVIDIA keys in auth.json are keyed by the provider slug
                $nvidiaAuth = $auth.PSObject.Properties | Where-Object { $_.Name -like "*nvidia*" } | Select-Object -First 1
                if ($nvidiaAuth) {
                    $apiKey = $nvidiaAuth.Value.apiKey
                }
            } catch { }
        }
    }

    if (-not $apiKey) {
        Write-Host "    [WARN] NVIDIA_API_KEY not found (env or opencode auth) - skipping NVIDIA models" -ForegroundColor Yellow
        return $null
    }

    $headers = @{ "Authorization" = "Bearer $apiKey" }
    $result = Fetch-ModelsWithHeaders "https://integrate.api.nvidia.com/v1/models" $headers
    return $result
}

function Fetch-ModelsWithHeaders($url, $headers) {
    try {
        $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 15 -Headers $headers -ErrorAction Stop
        $ids = if ($response.data) { $response.data.id } else { @() }
        return @($ids | Where-Object { $_ -ne $null })
    } catch {
        Write-Host "    [WARN] Failed to fetch $url : $_" -ForegroundColor Yellow
        return $null
    }
}

# ─── Load our current agent models from opencode.json ─────────────────────────
function Get-CurrentAgentModels {
    if (-not (Test-Path $ConfigFile)) { return @{} }

    try {
        $config = Get-Content $ConfigFile -Raw | ConvertFrom-Json
        $agentModels = @{}
        if ($config.agent) {
            foreach ($agent in $config.agent.PSObject.Properties) {
                $name = $agent.Name
                $model = $agent.Value.model
                if ($model) { $agentModels[$name] = $model }
            }
        }
        return $agentModels
    } catch {
        Write-Host "    [WARN] Could not read opencode.json: $_" -ForegroundColor Yellow
        return @{}
    }
}

# ─── Load cache ───────────────────────────────────────────────────────────────
function Load-Cache {
    if (-not (Test-Path $CacheFile)) { return $null }
    try {
        return Get-Content $CacheFile -Raw | ConvertFrom-Json
    } catch { return $null }
}

function Save-Cache($data) {
    # Ensure cache dir exists
    if (-not (Test-Path $CacheDir)) { New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null }
    $data | ConvertTo-Json -Depth 4 | Out-File -FilePath $CacheFile -Encoding utf8
}

# ─── Extract short model name from prefixed ID (e.g. nvidia/qwen/... -> qwen3-coder-480b) ──
function Get-ShortName($modelId) {
    if ($modelId -match '^([^/]+/)?(.+)$') { return $matches[2] }
    return $modelId
}

# ─── Main ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Model Update Checker" -ForegroundColor Cyan
Write-Host ""

# Reset cache if requested
if ($ResetCache) {
    if (Test-Path $CacheFile) {
        Remove-Item $CacheFile -Force
        Write-Host "  Cache cleared." -ForegroundColor Yellow
    } else {
        Write-Host "  No cache to clear." -ForegroundColor Gray
    }
    if (Test-Path $StatusFile) { Remove-Item $StatusFile -Force }
    exit 0
}

# 1. Load cache
$cache = Load-Cache
$knownModels = @{}
if ($cache -and $cache.sources) {
    foreach ($src in $cache.sources.PSObject.Properties) {
        $knownModels[$src.Name] = @($src.Value)
    }
}
$prevTotal = ($knownModels.Values | ForEach-Object { $_ }).Count

Write-Host "  Sources: Go (opencode-go), Zen (opencode), NVIDIA"
if ($cache) { Write-Host "  Previous snapshot: $($cache.lastCheck)  ($prevTotal models)" }

# 2. Fetch current model lists
Write-Host ""
Write-Host "  Fetching model lists..." -ForegroundColor Cyan

$goModels = Fetch-Models "https://opencode.ai/zen/go/v1/models"
$zenModels = Fetch-Models "https://opencode.ai/zen/v1/models"
$nvidiaModels = Fetch-NvidiaModels

$currentSources = @{}
$newModels = @()
$allNew = @()

if ($goModels -ne $null) {
    $currentSources["go"] = $goModels
    $newInGo = if ($knownModels.ContainsKey("go")) { Compare-Object $goModels $knownModels["go"] | Where-Object { $_.SideIndicator -eq "<=" } | ForEach-Object { $_.InputObject } } else { $goModels }
    foreach ($m in $newInGo) {
        $newModels += @{ model = $m; source = "Go (opencode-go)" }
        $allNew += $m
    }
    Write-Host "    Go: $($goModels.Count) models ($($newInGo.Count) new)" -ForegroundColor $(if ($newInGo.Count -gt 0) { "Green" } else { "Gray" })
}

if ($zenModels -ne $null) {
    $currentSources["zen"] = $zenModels
    $newInZen = if ($knownModels.ContainsKey("zen")) { Compare-Object $zenModels $knownModels["zen"] | Where-Object { $_.SideIndicator -eq "<=" } | ForEach-Object { $_.InputObject } } else { $zenModels }
    foreach ($m in $newInZen) {
        $newModels += @{ model = $m; source = "Zen (opencode)" }
        $allNew += $m
    }
    Write-Host "    Zen: $($zenModels.Count) models ($($newInZen.Count) new)" -ForegroundColor $(if ($newInZen.Count -gt 0) { "Green" } else { "Gray" })
}

if ($nvidiaModels -ne $null) {
    # NVIDIA returns full model IDs like "nvidia/qwen/qwen3-coder-480b-a35b-instruct"
    # Shorten them to just the path for cache consistency
    $nvidiaShort = $nvidiaModels | ForEach-Object { "nvidia/$_".Replace("nvidia/nvidia/", "nvidia/") }
    $currentSources["nvidia"] = $nvidiaShort
    $newInNvidia = if ($knownModels.ContainsKey("nvidia")) { Compare-Object $nvidiaShort $knownModels["nvidia"] | Where-Object { $_.SideIndicator -eq "<=" } | ForEach-Object { $_.InputObject } } else { $nvidiaShort }
    foreach ($m in $newInNvidia) {
        $newModels += @{ model = $m; source = "NVIDIA" }
        $allNew += $m
    }
    Write-Host "    NVIDIA: $($nvidiaShort.Count) models ($($newInNvidia.Count) new)" -ForegroundColor $(if ($newInNvidia.Count -gt 0) { "Green" } else { "Gray" })
}

# 3. Load current agent config for cross-reference
$agentModels = Get-CurrentAgentModels

# 4. Find models related to our current agents (same family)
$relatedModels = @()
foreach ($newM in $allNew) {
    $short = Get-ShortName $newM
    foreach ($agentName in $agentModels.Keys) {
        $currentModel = $agentModels[$agentName]
        $currentShort = Get-ShortName $currentModel
        # Check if they share a common prefix (same model family)
        $currentPrefix = ($currentShort -split '-')[0]
        $newPrefix = ($short -split '-')[0]
        # Also check if the new model's short name contains the current model's family
        $currentFamily = ($currentShort -split '-')[0..1] -join '-'
        if ($short -match [regex]::Escape($currentFamily) -or $newPrefix -eq $currentPrefix) {
            $relatedModels += @{
                agent = $agentName
                currentModel = $currentModel
                newModel = $newM
                source = ($newModels | Where-Object { $_.model -eq $newM } | Select-Object -First 1).source
            }
        }
    }
}

# 5. Check for free model additions
$newFreeModels = $allNew | Where-Object { $_ -match "free" }

# 6. Save updated cache
if ($UpdateCache -or $CheckOnly) {
    $cacheData = @{
        lastCheck = (Get-Date).ToString("o")
        sources = $currentSources
    }
    Save-Cache $cacheData
    if ($UpdateCache) {
        Write-Host ""
        Write-Host "  Cache updated." -ForegroundColor Green
    }
}

# 7. Write status file
$totalNow = ($currentSources.Values | ForEach-Object { $_ }).Count

$status = @{
    checked_at = (Get-Date).ToString("o")
    total_models_known = $totalNow
    new_models_count = $newModels.Count
    new_models = $newModels | Group-Object model | ForEach-Object {
        @{
            model = $_.Name
            sources = @($_.Group.source)
        }
    }
    new_free_models = $newFreeModels
    related_to_current_agents = $relatedModels
    current_agent_models = $agentModels
}
$status | ConvertTo-Json -Depth 4 | Out-File -FilePath $StatusFile -Encoding utf8 -Force

# 8. Print summary
Write-Host ""
Write-Host "  ── Summary ──" -ForegroundColor Cyan
Write-Host "  Total known models: $totalNow"

if ($newModels.Count -gt 0) {
    Write-Host "  New models found: $($newModels.Count)" -ForegroundColor Green
    $newModels | Group-Object model | ForEach-Object {
        $m = $_.Name
        $src = ($_.Group.source -join ", ")
        Write-Host "    + $m  ($src)" -ForegroundColor Green
    }

    if ($relatedModels.Count -gt 0) {
        Write-Host ""
        Write-Host "  Possibly relevant to current agents:" -ForegroundColor Yellow
        foreach ($r in $relatedModels) {
            Write-Host "    @$($r.agent): $($r.currentModel)  →  $($r.newModel)  ($($r.source))" -ForegroundColor Yellow
        }
    }

    if ($newFreeModels.Count -gt 0) {
        Write-Host ""
        Write-Host "  New free models available:" -ForegroundColor Green
        foreach ($f in $newFreeModels) { Write-Host "    + $f (FREE)" -ForegroundColor Green }
    }
} else {
    Write-Host "  No new models since last check." -ForegroundColor Gray
}

Write-Host ""
Write-Host "  Status written to: model-update-status.json" -ForegroundColor DarkGray
Write-Host "  Cache: glitch-memorycore\data\known-models.json" -ForegroundColor DarkGray
Write-Host ""

# Exit with code indicating if new models were found
if ($newModels.Count -gt 0) { exit 1 } else { exit 0 }
