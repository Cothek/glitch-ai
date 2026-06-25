$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Split-Path -Parent $ScriptDir
$CacheDir = "$RootDir\glitch-memorycore\data"
$CacheFile = "$CacheDir\known-models.json"
$FreeModelsFile = "$RootDir\data\free-models.json"
$StatusFile = "$RootDir\data\model-update-status.json"
$ConfigFile = "$RootDir\opencode.json"

$ErrorActionPreference = "Continue"

# --- Parse flags ----------------------------------------------------------------
$ResetCache = $args -contains "-ResetCache"
$UpdateCache = $args -contains "-UpdateCache"
$CheckOnly = (-not $ResetCache -and -not $UpdateCache) -or $args -contains "-CheckOnly"
$Silent = $args -contains "-Silent"

# --- Helper: normalize model ID (prevents double prefix / backslash issues) ---
function Normalize-ModelId($modelId) {
  if (-not $modelId) { return $modelId }
  # 1. Replace any backslashes with forward slashes (Windows env var issue)
  $normalized = $modelId -replace '\\', '/'
  # 2. Fix double nvidia/nvidia/ prefix (historical bug)
  $normalized = $normalized -replace '^nvidia/nvidia/', 'nvidia/'
  return $normalized
}

# --- Helper: fetch JSON from a URL ----------------------------------------------
function Fetch-Models($url) {
  try {
    $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 15 -ErrorAction Stop
    $ids = if ($response.data) { $response.data.id } else { @() }
    return @($ids | Where-Object { $_ -ne $null } | ForEach-Object { Normalize-ModelId $_ })
  } catch {
    if (-not $Silent) { Write-Host " [WARN] Failed to fetch $url : $_" -ForegroundColor Yellow }
    return $null
      }
}

# --- Helper: fetch NVIDIA models (needs API key) --------------------------------
# API key sources (checked in order):
#   1. NVIDIA_API_KEY environment variable
#   2. OpenCode auth store: ~/.local/share/opencode/auth.json (legacy, set via /connect)
#   3. OpenCode account store: ~/.local/share/opencode/account.json (modern, set via /connect)
function Fetch-NvidiaModels {
  # Try environment variable first
  $apiKey = $env:NVIDIA_API_KEY

  # Fall back to opencode auth store (legacy format: auth.json)
  if (-not $apiKey) {
    $authFile = "$env:USERPROFILE\.local\share\opencode\auth.json"
    if (Test-Path $authFile) {
      try {
        $auth = Get-Content $authFile -Raw | ConvertFrom-Json
        # NVIDIA keys in auth.json are keyed by the provider slug
        $nvidiaAuth = $auth.PSObject.Properties | Where-Object { $_.Name -like "*nvidia*" } | Select-Object -First 1
        if ($nvidiaAuth) {
          $apiKey = $nvidiaAuth.Value.key
        }
      } catch { }
    }
  }

  # Fall back to opencode account store (modern format: account.json)
  if (-not $apiKey) {
    $accountFile = "$env:USERPROFILE\.local\share\opencode\account.json"
    if (Test-Path $accountFile) {
      try {
        $account = Get-Content $accountFile -Raw | ConvertFrom-Json
        # account.json has structure: { accounts: { id: { serviceID: "nvidia", credential: { key: "..." } } }, active: { nvidia: "id" } }
        if ($account.accounts) {
          # Find the active NVIDIA account
          $activeNvidiaId = $account.active.nvidia
          if ($activeNvidiaId -and $account.accounts.$activeNvidiaId) {
            $apiKey = $account.accounts.$activeNvidiaId.credential.key
          } else {
            # No active account found, try to find any NVIDIA account
            $nvidiaAccount = $account.accounts.PSObject.Properties | Where-Object { $_.Value.serviceID -eq "nvidia" } | Select-Object -First 1
            if ($nvidiaAccount) {
              $apiKey = $nvidiaAccount.Value.credential.key
            }
          }
        }
      } catch { }
    }
  }

  if (-not $apiKey) {
    if (-not $Silent) { Write-Host " [WARN] NVIDIA_API_KEY not found. Set env var or run `/connect nvidia` in OpenCode TUI to store key in auth.json" -ForegroundColor Yellow }
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
    if (-not $Silent) { Write-Host " [WARN] Failed to fetch $url : $_" -ForegroundColor Yellow }
    return $null
  }
}

# --- Helper: fetch OpenRouter free models ----------------------------------------
function Fetch-OpenRouterFreeModels {
  try {
    $response = Invoke-RestMethod -Uri "https://openrouter.ai/api/v1/models" -Method Get -TimeoutSec 20 -ErrorAction Stop
    if (-not $response.data) { return @() }
    # OpenRouter free models: pricing.prompt == "0" AND pricing.completion == "0"
    # Also filter to text-capable models (modality contains "->text")
    $freeModels = @()
    foreach ($m in $response.data) {
      # Skip OpenRouter's own routing/free models (not real LLMs)
      if ($m.id -eq "openrouter/free" -or $m.id -eq "openrouter/owl-alpha") { continue }

      $promptPrice = if ($m.pricing.prompt) { $m.pricing.prompt } else { "1" }
      $compPrice = if ($m.pricing.completion) { $m.pricing.completion } else { "1" }
      if ($promptPrice -eq "0" -and $compPrice -eq "0") {
        # Only include text-capable models (skip audio-only like lyria)
        $outputModalities = if ($m.architecture.output_modalities) { @($m.architecture.output_modalities) } else { @() }
        $hasText = $outputModalities -contains "text"
        $hasAudio = $outputModalities -contains "audio"
        if ($hasText -and -not $hasAudio) {
          # Prefix with openrouter/ for consistency
          $freeModels += "openrouter/$($m.id)"
        }
      }
    }
    return $freeModels
  } catch {
    if (-not $Silent) { Write-Host " [WARN] Failed to fetch OpenRouter models: $_" -ForegroundColor Yellow }
    return $null
  }
}

# --- Load our current agent models from opencode.json ---------------------------
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

# --- Load cache -----------------------------------------------------------------
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

# --- Extract short model name from prefixed ID (e.g. nvidia/qwen/... -> qwen3-coder-480b) ---
function Get-ShortName($modelId) {
    if ($modelId -match '^([^/]+/)?(.+)$') { return $matches[2] }
    return $modelId
}

# --- Main -----------------------------------------------------------------------
if (-not $Silent) {
  Write-Host ""
  Write-Host " Model Update Checker" -ForegroundColor Cyan
  Write-Host ""
}

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

if (-not $Silent) {
  Write-Host " Sources: Go (opencode-go), Zen (opencode), NVIDIA, OpenRouter"
  if ($cache) { Write-Host " Previous snapshot: $($cache.lastCheck) ($prevTotal models)" }
}

# 2. Fetch current model lists
if (-not $Silent) {
  Write-Host ""
  Write-Host " Fetching model lists..." -ForegroundColor Cyan
}

$goModels = Fetch-Models "https://opencode.ai/zen/go/v1/models"
$zenModels = Fetch-Models "https://opencode.ai/zen/v1/models"
$nvidiaModels = Fetch-NvidiaModels
$openrouterModels = Fetch-OpenRouterFreeModels

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
    # Normalize to ensure consistent format (single nvidia/ prefix, forward slashes)
    $nvidiaShort = $nvidiaModels | ForEach-Object { Normalize-ModelId "nvidia/$($_.Replace('nvidia/', ''))" }
    $currentSources["nvidia"] = $nvidiaShort
    $newInNvidia = if ($knownModels.ContainsKey("nvidia")) { Compare-Object $nvidiaShort $knownModels["nvidia"] | Where-Object { $_.SideIndicator -eq "<=" } | ForEach-Object { $_.InputObject } } else { $nvidiaShort }
    foreach ($m in $newInNvidia) {
        $newModels += @{ model = $m; source = "NVIDIA" }
        $allNew += $m
    }
  Write-Host " NVIDIA: $($nvidiaShort.Count) models ($($newInNvidia.Count) new)" -ForegroundColor $(if ($newInNvidia.Count -gt 0) { "Green" } else { "Gray" })
}

if ($openrouterModels -ne $null) {
  $currentSources["openrouter"] = $openrouterModels
  $newInOR = if ($knownModels.ContainsKey("openrouter")) { Compare-Object $openrouterModels $knownModels["openrouter"] | Where-Object { $_.SideIndicator -eq "<=" } | ForEach-Object { $_.InputObject } } else { $openrouterModels }
  foreach ($m in $newInOR) {
    $newModels += @{ model = $m; source = "OpenRouter" }
    $allNew += $m
  }
  if (-not $Silent) { Write-Host " OpenRouter: $($openrouterModels.Count) free models ($($newInOR.Count) new)" -ForegroundColor $(if ($newInOR.Count -gt 0) { "Green" } else { "Gray" }) }
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
    Write-Host " Cache updated." -ForegroundColor Green
  }
}

# 6.5. Write free-models.json for the model picker scripts
# This file contains ONLY free models, grouped by provider, with display names
$freeModelsData = @{
  generated_at = (Get-Date).ToString("o")
  providers = @()
}

# --- Helper: fetch OpenRouter model capabilities (authoritative source for vision) ---
# Returns a hashtable mapping model ID -> @{ input_modalities = @(...); output_modalities = @(...) }
$script:openRouterCapabilities = $null

function Fetch-OpenRouterCapabilities {
    if ($script:openRouterCapabilities) { return $script:openRouterCapabilities }
    
    try {
        $response = Invoke-RestMethod -Uri "https://openrouter.ai/api/v1/models" -Method Get -TimeoutSec 20 -ErrorAction Stop
        $capabilities = @{}
        foreach ($m in $response.data) {
            if ($m.architecture -and $m.architecture.input_modalities) {
                $capabilities[$m.id] = @{
                    input_modalities = @($m.architecture.input_modalities)
                    output_modalities = @($m.architecture.output_modalities)
                }
            }
        }
        $script:openRouterCapabilities = $capabilities
        return $capabilities
    } catch {
        Write-Host " [WARN] Failed to fetch OpenRouter capabilities: $_" -ForegroundColor Yellow
        $script:openRouterCapabilities = @{}
        return @{}
    }
}

# --- Helper: normalize model ID for cross-provider matching ---
function Normalize-For-Matching($modelId) {
    # Map NVIDIA provider prefixes to OpenRouter equivalents
    # NVIDIA: nvidia/minimaxai/minimax-m3 -> minimax/minimax-m3
    # NVIDIA: nvidia/qwen/qwen3.5-122b-a10b -> qwen/qwen3.5-122b-a10b
    # NVIDIA: nvidia/stepfun-ai/step-3.7-flash -> stepfun/step-3.7-flash
    # NVIDIA: nvidia/deepseek-ai/deepseek-v4-flash -> deepseek/deepseek-v4-flash
    # NVIDIA: nvidia/z-ai/glm-5.1 -> z-ai/glm-5.1
    $normalized = $modelId
    
    # Strip nvidia/ prefix first
    $normalized = $normalized -replace '^nvidia/', ''
    
    # Map provider prefixes to OpenRouter equivalents
    $normalized = $normalized -replace '^minimaxai/', 'minimax/'
    $normalized = $normalized -replace '^deepseek-ai/', 'deepseek/'
    $normalized = $normalized -replace '^qwen/', 'qwen/'
    $normalized = $normalized -replace '^stepfun-ai/', 'stepfun/'
    $normalized = $normalized -replace '^z-ai/', 'z-ai/'
    
    # Remove :free suffix
    $normalized = $normalized -replace ':free$', ''
    return $normalized
}

# --- Helper: check if a model has vision capabilities using OpenRouter data ---
function Is-VisionModel($modelId) {
    $capabilities = Fetch-OpenRouterCapabilities
    
    # Try exact match first
    if ($capabilities.ContainsKey($modelId)) {
        return $capabilities[$modelId].input_modalities -contains 'image'
    }
    
    # Try normalized match (strip provider prefixes)
    $normalized = Normalize-For-Matching $modelId
    foreach ($key in $capabilities.Keys) {
        $keyNorm = Normalize-For-Matching $key
        if ($keyNorm -eq $normalized) {
            return $capabilities[$key].input_modalities -contains 'image'
        }
    }
    
    # Fallback to heuristics for models not in OpenRouter
    if ($modelId -match 'vision') { return $true }
    if ($modelId -match 'multimodal') { return $true }
    if ($modelId -match '-vl[-]|-vl$') { return $true }
    if ($modelId -match 'omni') { return $true }
    if ($modelId -match 'cosmos') { return $true }
    if ($modelId -match 'kimi-k2') { return $true }
    if ($modelId -match 'step-3\.7') { return $true }
    if ($modelId -match 'gemma-[34]') { return $true }
    if ($modelId -match 'llama-4-maverick') { return $true }
    return $false
}

# --- Helper: check if a NVIDIA model has "Free Endpoint" badge on build.nvidia.com ---
# Cache to avoid repeated HTTP requests
$script:nvidiaFreeEndpointCache = @{}

function Test-NvidiaFreeEndpoint($modelId) {
    # Check cache first
    if ($script:nvidiaFreeEndpointCache.ContainsKey($modelId)) {
        return $script:nvidiaFreeEndpointCache[$modelId]
    }
    
    # Convert API model ID to website URL path
    # The build.nvidia.com URLs use the full path including provider prefix
    # Examples:
    #   minimaxai/minimax-m3 -> https://build.nvidia.com/minimaxai/minimax-m3
    #   nvidia/nemotron-3-nano-30b-a3b -> https://build.nvidia.com/nvidia/nemotron-3-nano-30b-a3b
    #   qwen/qwen3.5-122b-a10b -> https://build.nvidia.com/qwen/qwen3.5-122b-a10b
    # So we use the model ID as-is (it already has the correct provider prefix)
    $cardUrl = "https://build.nvidia.com/$modelId"
    
    try {
        $response = Invoke-WebRequest -Uri $cardUrl -Headers @{ "Accept" = "text/html" } -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        $isFree = $response.Content -match 'Free Endpoint'
        $script:nvidiaFreeEndpointCache[$modelId] = $isFree
        return $isFree
    } catch {
        # If we can't check, return null (unknown)
        return $null
    }
}

# --- Helper: verify all known NVIDIA models against build.nvidia.com ---
function Verify-NvidiaFreeModels {
    $modelsToCheck = @(
        "minimaxai/minimax-m3",
        "minimaxai/minimax-m2.7",
        "nvidia/nemotron-3-nano-30b-a3b",
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        "nvidia/nvidia-nemotron-nano-9b-v2",
        "nvidia/nemotron-mini-4b-instruct",
        "qwen/qwen3.5-122b-a10b",
        "stepfun-ai/step-3.7-flash",
        "nvidia/nemotron-3-content-safety",
        "nvidia/ai-synthetic-video-detector",
        "nvidia/ising-calibration-1-35b-a3b",
        "deepseek-ai/deepseek-v4-flash",
        "deepseek-ai/deepseek-v4-pro",
        "z-ai/glm-5.1"
    )
    
    $results = @{}
    foreach ($model in $modelsToCheck) {
        $isFree = Test-NvidiaFreeEndpoint $model
        $results[$model] = $isFree
        if ($isFree -eq $true) {
            Write-Host "  ✅ $model - Free Endpoint confirmed" -ForegroundColor Green
        } elseif ($isFree -eq $false) {
            Write-Host "  ❌ $model - NOT free (no badge)" -ForegroundColor Red
        } else {
            Write-Host "  ⚠ $model - Could not verify" -ForegroundColor Yellow
        }
        Start-Sleep -Milliseconds 500  # Be nice to the server
    }
    return $results
}

# OpenCode Zen: models ending in -free or named big-pickle
if ($zenModels -ne $null) {
  $zenGroup = @{
    name = "OpenCode Zen (free tier)"
    id_prefix = "opencode"
    models = @()
  }
  foreach ($m in $zenModels) {
    if ($m -match '-free$' -or $m -eq 'big-pickle') {
      # Derive display name: strip -free suffix, capitalize words
      $displayName = $m -replace '-free$', ''
      $displayName = ($displayName -split '-' | ForEach-Object { $_.Substring(0,1).ToUpper() + $_.Substring(1) }) -join ' '
      if (Is-VisionModel $m) { $displayName += ' (image)' }
      $zenGroup.models += @{ id = "opencode/$m"; name = $displayName }
    }
  }
  $freeModelsData.providers += $zenGroup
}

# OpenRouter: already filtered to free-only by Fetch-OpenRouterFreeModels
if ($openrouterModels -ne $null -and $openrouterModels.Count -gt 0) {
  $orGroup = @{
    name = "OpenRouter (free models)"
    id_prefix = "openrouter"
    models = @()
  }
  foreach ($m in $openrouterModels) {
    # Strip openrouter/ prefix to get the raw ID, then derive display name
    $rawId = $m -replace '^openrouter/', ''
    # Strip :free suffix for display
    $displayName = $rawId -replace ':free$', ''
    # Take the part after the first / as the model name
    if ($displayName -match '/') {
      $displayName = ($displayName -split '/')[-1]
    }
    $displayName = ($displayName -split '-' | ForEach-Object { $_.Substring(0,1).ToUpper() + $_.Substring(1) }) -join ' '
    # Tag vision/image models
    if (Is-VisionModel $rawId) { $displayName += ' (image)' }
    $orGroup.models += @{ id = $m; name = $displayName }
  }
  $freeModelsData.providers += $orGroup
}

# --- Helper: filter NVIDIA models to keep only useful ones -----------------------
# Keeps: general chat/reasoning, code models, vision models, MoE/experimental
# Excludes: embedding, retriever, safety/guard, translate, parse, detector, small (<7B non-MoE)
# Input models are raw IDs from API (e.g., "baai/bge-m3", "01-ai/yi-large")
function Filter-NvidiaModels($models) {
  $excludedPatterns = @(
    # Embedding/retrieval models
    '^baai/bge-', '^nvidia/baai/bge-',
    'nemoretriever',  # catches llama-3.2-nemoretriever-* and nvidia/nemoretriever/*
    '^snowflake/arctic-embed', '^nvidia/snowflake/arctic-embed',
    '^nvidia/nv-embed', '^nvidia/nvclip', '^nvidia/nv-embedcode', '^nvidia/nv-embedqa',
    '^nvidia/embed-qa',  # embed-qa-4
    '^nvidia/llama-.*-embed',  # llama-nemotron-embed-*, llama-3.2-nv-embedqa-*
    
    # Safety/guard models
    'guard', 'safety', 'nemoguard', 'llama-guard',
    'content-safety',
    
    # Translation
    'translate', 'riva-translate',
    
    # Parsing/extraction
    'parse', 'nemotron-parse',
    
    # Detectors/specialized
    'detector', 'synthetic-video',
    'gliner', 'pii',
    'ising-calibration',
    'deplot',
    
    # Reward models
    'reward', 'nemotron-4-340b-reward',
    
    # Too small (<7B non-MoE)
    'nemotron-mini-4b',
    'nemotron-nano-3-30b$',  # base nano (keep -omni and -reasoning variants)
    'nemotron-nano-9b$',  # base nano
    'nvidia-nemotron-nano-9b',
    'nemotron-3-nano-30b-a3b$',  # base nano (keep -omni and -reasoning variants)
    'nemotron-nano-3-30b-a3b$',  # base nano variant
    
    # Small models from specific providers
    '^adept/fuyu-8b$',  # vision-only, small
    '^bigcode/starcoder2-15b$',  # code-only, but keeping per user request
    '^databricks/dbrx-instruct$',  # keeping
    '^ibm/granite-3\.0-3b',  # too small
    '^ibm/granite-8b-code-instruct$',  # code-only, keeping per user request
    '^ibm/granite-34b-code-instruct$',  # code-only, keeping per user request
    '^microsoft/phi-3-vision',  # vision, keeping per user request
    '^microsoft/phi-4-mini',  # too small
    '^microsoft/phi-4-multimodal',  # multimodal, keeping per user request
    '^meta/llama-3\.2-(1b|3b)-instruct$',  # too small
    '^google/(gemma-2b|gemma-3n|recurrentgemma|codegemma-1\.1|codegemma-7b|deplot|diffusiongemma)'
    '^google/gemma-2-2b'
    '^google/gemma-3-4b'
    
    # Small/distilled models
    'mistral-nemo-minitron'
  )

  $kept = @()
  foreach ($m in $models) {
    $exclude = $false
    foreach ($pattern in $excludedPatterns) {
      if ($m -match $pattern) {
        $exclude = $true
        break
      }
    }
    if (-not $exclude) {
      $kept += $m
    }
  }
  return $kept
}

# NVIDIA: all models on the free endpoint are free (listed last)
# If API is available, use live list; otherwise use known fallback
$nvidiaGroup = @{
  name = "NVIDIA (free endpoint, requires /connect)"
  id_prefix = "nvidia"
  models = @()
}

if ($nvidiaModels -ne $null) {
  # Filter to keep only useful models
  $filteredModels = Filter-NvidiaModels $nvidiaModels
  
  # Verify free endpoint status for known models (only in non-silent mode)
  if (-not $Silent) {
    Write-Host " Verifying NVIDIA free endpoint status..." -ForegroundColor Cyan
    $freeStatus = Verify-NvidiaFreeModels
  }
  
  foreach ($m in $filteredModels) {
    $fullId = Normalize-ModelId "nvidia/$($m.Replace('nvidia/', ''))"
    $parts = $m -split '/'
    $shortName = if ($parts.Count -ge 2) { $parts[-1] } else { $m }
    $displayName = $shortName -replace '-instruct-\d+$', '' -replace '-a\d+b$', ''
    if (Is-VisionModel $m) { $displayName += ' (image)' }
    $nvidiaGroup.models += @{ id = $fullId; name = $displayName }
  }
} else {
  # No API key or API unavailable - don't write a static fallback list.
  # The picker will show "(no models available)" and the user gets a clear message.
  Write-Host " [WARN] NVIDIA models unavailable - connect via /connect nvidia in OpenCode TUI" -ForegroundColor Yellow
}
$freeModelsData.providers += $nvidiaGroup
# Write free-models.json
$freeModelsDir = Split-Path -Parent $FreeModelsFile
if (-not (Test-Path $freeModelsDir)) { New-Item -ItemType Directory -Path $freeModelsDir -Force | Out-Null }
$freeModelsData | ConvertTo-Json -Depth 4 | Out-File -FilePath $FreeModelsFile -Encoding utf8 -Force

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
if (-not $Silent) {
  Write-Host ""
  Write-Host " -- Summary --" -ForegroundColor Cyan
  Write-Host " Total known models: $totalNow"

  if ($newModels.Count -gt 0) {
    Write-Host " New models found: $($newModels.Count)" -ForegroundColor Green
    $newModels | Group-Object model | ForEach-Object {
      $m = $_.Name
      $src = ($_.Group.source -join ", ")
      Write-Host " + $m ($src)" -ForegroundColor Green
    }

    if ($relatedModels.Count -gt 0) {
      Write-Host ""
      Write-Host " Possibly relevant to current agents:" -ForegroundColor Yellow
      foreach ($r in $relatedModels) {
        Write-Host " @$($r.agent): $($r.currentModel) -> $($r.newModel) ($($r.source))" -ForegroundColor Yellow
      }
    }

    if ($newFreeModels.Count -gt 0) {
      Write-Host ""
      Write-Host " New free models available:" -ForegroundColor Green
      foreach ($f in $newFreeModels) { Write-Host " + $f (FREE)" -ForegroundColor Green }
    }
  } else {
    Write-Host " No new models since last check." -ForegroundColor Gray
  }

    Write-Host ""
    Write-Host " Status written to: model-update-status.json" -ForegroundColor DarkGray
    Write-Host " Cache: glitch-memorycore\data\known-models.json" -ForegroundColor DarkGray
    Write-Host " Free models: data\free-models.json" -ForegroundColor DarkGray
    Write-Host ""
}

# Exit with code indicating if new models were found
if ($newModels.Count -gt 0) { exit 1 } else { exit 0 }
