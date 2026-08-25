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
$SkipNvidiaFreeCheck = $args -contains "-SkipNvidiaFreeCheck"
$Force = $args -contains "-Force"
$StaleMinutes = 15  # default staleness threshold (minutes)
$staleIdx = [array]::IndexOf($args, '-StaleMinutes')
if ($staleIdx -ge 0 -and $staleIdx -lt $args.Count - 1) {
    $StaleMinutes = [int]$args[$staleIdx + 1]
}

# --- Helper: normalize model ID (prevents double prefix / backslash issues) ---
# --- Helper: name override dict for well-known NVIDIA models --------------------
$NvidiaNameOverrides = @{
  "deepseek-v4-flash" = "DeepSeek V4 Flash"
  "deepseek-v4-pro" = "DeepSeek V4 Pro"
  "minimax-m3" = "MiniMax M3"
  "minimax-m2.7" = "MiniMax M2.7"
  "nemotron-3-ultra-550b" = "Nemotron 3 Ultra 550B"
  "nemotron-3-super-120b" = "Nemotron 3 Super 120B"
  "nemotron-3-nano-omni-30b-a3b-reasoning" = "Nemotron 3 Nano Omni 30B"
  "nemotron-4-340b" = "Nemotron 4 340B"
  "nemotron-nano-12b" = "Nemotron Nano 12B VL"
  "llama-3.1-nemotron-ultra-253b" = "Nemotron Ultra 253B"
  "llama-3.3-nemotron-super-49b" = "Nemotron Super 49B"
  "mistral-large-3-675b" = "Mistral Large 3"
  "kimi-k2.6" = "Kimi K2.6"
  "qwen3-next-80b" = "Qwen3 Next 80B"
  "qwen3.5-122b" = "Qwen 3.5 122B"
  "qwen3.5-397b" = "Qwen 3.5 397B"
  "llama-3.1-70b" = "Llama 3.1 70B"
  "llama-3.1-8b" = "Llama 3.1 8B"
  "llama-3.2-11b-vision" = "Llama 3.2 11B Vision"
  "llama-3.3-70b" = "Llama 3.3 70B"
  "llama-4-maverick-17b-128e" = "Llama 4 Maverick 17B"
  "gemma-3-12b" = "Gemma 3 12B"
  "gemma-4-31b" = "Gemma 4 31B"
  "step-3.7-flash" = "Step 3.7 Flash"
  "step-3.5-flash" = "Step 3.5 Flash"
  "glm-5.1" = "GLM 5.1"
  "yi-large" = "Yi Large"
  "codestral-22b" = "Codestral 22B"
  "mistral-nemo-12b" = "Mistral Nemo 12B"
  "mistral-nemotron" = "Mistral Nemotron"
  "granite-3.0-8b" = "Granite 3.0 8B"
}

# --- Helper: generate a readable display name for NVIDIA models ------------------
function Get-NvidiaDisplayName($modelName, $isVision) {
  # Step 1: strip version suffixes
  $cleaned = $modelName -replace '-instruct(-\d+)?$', '' -replace '-a\d+b$', '' -replace '-v\d+(\.\d+)?$', '' -replace '-it$', ''

  # Step 2: check override dictionary
  if ($NvidiaNameOverrides.ContainsKey($cleaned)) {
    $displayName = $NvidiaNameOverrides[$cleaned]
  } else {
    # Step 3: capitalize each dash-separated word
    $displayName = ($cleaned -split '-' | ForEach-Object {
      if ($_ -match '^(\d+\.?\d*)([a-z])$') {
        # e.g., "550b" -> "550B", "8b" -> "8B"
        $matches[1] + $matches[2].ToUpper()
      } elseif ($_ -match '^[a-z]') {
        $_.Substring(0,1).ToUpper() + $_.Substring(1)
      } else { $_ }
    }) -join ' '
  }

  if ($isVision) { $displayName += ' (image)' }
  return $displayName
}

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

# --- Helper: get NVIDIA API key (used by Fetch-NvidiaModels) ---
# API key sources (checked in order):
#   1. NVIDIA_API_KEY environment variable
#   2. OpenCode auth store: ~/.local/share/opencode/auth.json (legacy, set via /connect)
#   3. OpenCode account store: ~/.local/share/opencode/account.json (modern, set via /connect)
$script:nvidiaApiKey = $null
$script:nvidiaApiKeyResolved = $false

function Get-NvidiaApiKey {
    if ($script:nvidiaApiKeyResolved) { return $script:nvidiaApiKey }
    $script:nvidiaApiKeyResolved = $true

    $key = $env:NVIDIA_API_KEY

    if (-not $key) {
        $authFile = "$env:USERPROFILE\.local\share\opencode\auth.json"
        if (Test-Path $authFile) {
            try {
                $auth = Get-Content $authFile -Raw | ConvertFrom-Json
                $nvidiaAuth = $auth.PSObject.Properties | Where-Object { $_.Name -like "*nvidia*" } | Select-Object -First 1
                if ($nvidiaAuth) { $key = $nvidiaAuth.Value.key }
            } catch { }
        }
    }

    if (-not $key) {
        $accountFile = "$env:USERPROFILE\.local\share\opencode\account.json"
        if (Test-Path $accountFile) {
            try {
                $account = Get-Content $accountFile -Raw | ConvertFrom-Json
                if ($account.accounts) {
                    $activeNvidiaId = $account.active.nvidia
                    if ($activeNvidiaId -and $account.accounts.$activeNvidiaId) {
                        $key = $account.accounts.$activeNvidiaId.credential.key
                    } else {
                        $nvidiaAccount = $account.accounts.PSObject.Properties | Where-Object { $_.Value.serviceID -eq "nvidia" } | Select-Object -First 1
                        if ($nvidiaAccount) { $key = $nvidiaAccount.Value.credential.key }
                    }
                }
            } catch { }
        }
    }

    $script:nvidiaApiKey = $key
    return $key
}

# --- Helper: fetch NVIDIA models (needs API key) --------------------------------
function Fetch-NvidiaModels {
  $apiKey = Get-NvidiaApiKey

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

# 1.5 Staleness gate — skip API fetches if cache is fresh enough
if ($cache -and -not $Force) {
    $cacheAge = (Get-Date) - (Get-Item $CacheFile).LastWriteTime
    if ($cacheAge -lt [TimeSpan]::FromMinutes($StaleMinutes)) {
        if (-not $Silent) {
            Write-Host ""
            Write-Host " Cache is fresh ($([math]::Round($cacheAge.TotalMinutes, 0)) min old, threshold: ${StaleMinutes}min). Skipping API fetch." -ForegroundColor DarkGray
            Write-Host " Use -Force to bypass." -ForegroundColor DarkGray
        }

        # Write status file with 0 new models (keeps launch scripts happy)
        $status = @{
            checked_at = (Get-Date).ToString("o")
            total_models_known = $prevTotal
            new_models_count = 0
            new_models = @()
            new_free_models = @()
            related_to_current_agents = @()
            current_agent_models = (Get-CurrentAgentModels)
            skipped = $true
            skip_reason = "cache_fresh"
        }
        $status | ConvertTo-Json -Depth 4 | Out-File -FilePath $StatusFile -Encoding utf8 -Force

        if (-not $Silent) {
            Write-Host ""
            Write-Host " -- Summary --" -ForegroundColor Cyan
            Write-Host " Total known models: $prevTotal"
            Write-Host " No new models (cache fresh, fetch skipped)." -ForegroundColor Gray
            Write-Host ""
        }
        exit 0
    }
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

# --- Helper: derive cost tier from pricing -----------------------------------------
# OpenCode Zen/Go don't expose per-model pricing; we estimate or fall back to "unknown".
# - Both prices at/under $0.28 / Mtok  -> "budget_paid"
# - Both prices at/under $0.50 / Mtok  -> "mid_paid"
# - Higher                            -> "premium_paid"
# - Both $0 (numeric)                 -> "free"
# - Missing/null pricing              -> "unknown"
function Get-CostTier($promptPrice, $completionPrice) {
    # Both null/missing -> unknown
    if ($null -eq $promptPrice -or $null -eq $completionPrice) { return "unknown" }
    # Strings from OpenRouter JSON ("0", "0.0000005") need to be parsed
    $p = 0.0
    $c = 0.0
    $hasP = [double]::TryParse([string]$promptPrice, [ref]$p)
    $hasC = [double]::TryParse([string]$completionPrice, [ref]$c)
    if (-not $hasP -or -not $hasC) { return "unknown" }
    if ($p -eq 0.0 -and $c -eq 0.0) { return "free" }
    $max = [Math]::Max($p, $c)
    if ($max -le 0.28) { return "budget_paid" }
    if ($max -le 0.50) { return "mid_paid" }
    return "premium_paid"
}

# --- Helper: derive capability tags for a model -----------------------------------
# Returns an array of capability strings. "text" is always included as a baseline.
# - "vision"            : image inputs (from Is-VisionModel)
# - "code"              : name contains code/coder/codestral/deepseek/qwen/qwen3-coder/granite-code keywords
# - "large_context"     : context_length > 128000 (OpenRouter data only; null otherwise)
# Mirrors the ai-gm agent routing logic kept in user/decisions.md.
function Get-ModelCapabilities($modelId, $provider = "", $contextLength = $null) {
    $caps = @("text")
    if (Is-VisionModel $modelId) { $caps = @("text", "vision") }
    $lc = [string]$modelId
    # Match vendor/code family naming. Lowercased comparison only.
    if ($lc -match 'coder|code|deepseek|qwen|codestral|granite.*code|starcoder|gpt-oss|kimi-k2') {
        $caps += "code"
    }
    if ($null -ne $contextLength) {
        try {
            $ctx = [int]$contextLength
            if ($ctx -gt 128000) { $caps += "large_context" }
        } catch { }
    }
    return $caps
}

# --- Helper: fetch all OpenRouter models with pricing (for the model registry) ----
# Distinct from Fetch-OpenRouterFreeModels which only extracts free IDs.
# Returns a hashtable: modelId -> @{ prompt = "..."; completion = "..."; context_length = <int|null> }
$script:openRouterFullModels = $null

function Fetch-OpenRouterFullModels {
    if ($script:openRouterFullModels) { return $script:openRouterFullModels }
    try {
        $response = Invoke-RestMethod -Uri "https://openrouter.ai/api/v1/models" -Method Get -TimeoutSec 20 -ErrorAction Stop
        $models = @{}
        foreach ($m in $response.data) {
            $pricing = @{
                prompt = if ($m.pricing -and $null -ne $m.pricing.prompt) { [string]$m.pricing.prompt } else { $null }
                completion = if ($m.pricing -and $null -ne $m.pricing.completion) { [string]$m.pricing.completion } else { $null }
            }
            $ctx = $null
            if ($m.context_length) {
                try { $ctx = [int]$m.context_length } catch { $ctx = $null }
            }
            $models[$m.id] = @{
                pricing = $pricing
                context_length = $ctx
            }
        }
        $script:openRouterFullModels = $models
        return $models
    } catch {
        if (-not $Silent) { Write-Host " [WARN] Failed to fetch OpenRouter full models: $_" -ForegroundColor Yellow }
        $script:openRouterFullModels = @{}
        return @{}
    }
}

# --- Helper: determine NVIDIA free models from OpenRouter pricing data ---
# A NVIDIA model is free if OpenRouter has a :free variant with zero pricing.
# This replaces the broken API probe (Test-NvidiaFreeEndpoint) which only tested
# whether a model responded to a ping, not whether it was free vs paid.
# OpenRouter pricing is authoritative: free models have pricing.prompt == "0" AND pricing.completion == "0" on :free variants.
$script:nvidiaFreeFromOpenRouter = $null

function Get-NvidiaFreeSetFromOpenRouter {
    if ($null -ne $script:nvidiaFreeFromOpenRouter) { return $script:nvidiaFreeFromOpenRouter }

    $orFull = Fetch-OpenRouterFullModels
    $freeSet = @{}

    foreach ($orId in $orFull.Keys) {
        if ($orId -notmatch ':free$') { continue }

        $data = $orFull[$orId]
        $p = 0.0; $c = 0.0
        $hasP = [double]::TryParse([string]$data.pricing.prompt, [ref]$p)
        $hasC = [double]::TryParse([string]$data.pricing.completion, [ref]$c)
        if ($hasP -and $hasC -and $p -eq 0.0 -and $c -eq 0.0) {
            $baseId = $orId -replace ':free$', ''
            $normalized = Normalize-For-Matching $baseId
            $freeSet[$normalized] = $true
        }
    }

    if (-not $Silent) {
        Write-Host "  OpenRouter free NVIDIA models: $($freeSet.Count) confirmed" -ForegroundColor DarkGray
    }
    $script:nvidiaFreeFromOpenRouter = $freeSet
    return $freeSet
}

function Test-NvidiaFreeFromOpenRouter($nvidiaModelId) {
    $freeSet = Get-NvidiaFreeSetFromOpenRouter
    $fullId = Normalize-ModelId "nvidia/$($nvidiaModelId.Replace('nvidia/', ''))"
    $normalized = Normalize-For-Matching $fullId
    return $freeSet.ContainsKey($normalized)
}

# --- Checking NVIDIA free models ---
# Classification rationale (Troy, 2026-08-10): Troy's NVIDIA API key has NO billing
# attached (free tier only, no credits, no payment method). Therefore a 200 response
# from the chat completions API means the model is served without payment = FREE.
# The burst rate-limit test was removed because it was disambiguating a non-existent
# ambiguity (200 already means free when the key has no billing).
#
# Classification:
#   200       -> free  (no_billing_200_free — served without payment)
#   429       -> free  (rate_limited_429 — rate-limited but accessible)
#   402 / 403 -> paid  (billing_required — payment needed)
#   410       -> deprecated (deprecated_410 — no retry, genuinely gone)
#   404       -> deprecated (deprecated_404 — last candidate not found)
#   500+ / 0  -> error
#
# Two-form retry: prefixed ID first, bare form on 404. 410 = no retry.
# Cache: data/nvidia-free-cache.json with 24h TTL.

$NvidiaFreeCacheFile = "$RootDir\data\nvidia-free-cache.json"
$NvidiaFreeCacheTTLHours = 24

# FIX 1/FIX 4 helper: classify a behavioral result reason as DEFINITIVE or TRANSIENT.
# Definitive reasons represent a real free/paid/deprecated verdict and should NOT be
# re-tested (cache hit). Transient reasons (error_0, error_5xx, unexpected_*) represent
# network/timeout failures, not a real verdict -- they must be re-tested every run so a
# poisoned entry can heal, and the registry must label them "unverified" not "budget_paid".
function Test-BehavioralReasonDefinitive {
    param([string]$Reason)
    if (-not $Reason) { return $false }
    # Definitive: a real verdict was reached.
    if ($Reason -eq "no_billing_200_free") { return $true }
    if ($Reason -like "rate_limited_429*") { return $true }
    if ($Reason -like "billing_required_*") { return $true }
    if ($Reason -like "deprecated_*") { return $true }
    # error_0_preserved_free is a preserved known-good entry (FIX 2) -- treat as definitive free.
    if ($Reason -eq "error_0_preserved_free") { return $true }
    # error_0_cached_free is a prior-known-good fallback -- treat as definitive free.
    if ($Reason -eq "error_0_cached_free") { return $true }
    # Everything else (error_0, error_5xx, unexpected_*) is transient.
    return $false
}

function Load-NvidiaFreeCache {
    param([switch]$Force)
    if ($Force) { return $null }
    if (-not (Test-Path $NvidiaFreeCacheFile)) { return $null }
    try {
        $cache = Get-Content $NvidiaFreeCacheFile -Raw | ConvertFrom-Json
        if ($cache.generated_at) {
            $age = (Get-Date) - (Get-Date $cache.generated_at)
            if ($age.TotalHours -lt $NvidiaFreeCacheTTLHours) {
                return $cache
            }
        }
        return $null
    } catch { return $null }
}

function Save-NvidiaFreeCache($results) {
    <#
        Bug C: robust .tmp promotion. The old code did Rename-Item -Force against
        a possibly-existing destination and could leave a stranded .tmp on silent
        failure. Now: remove destination first, then Move-Item (no -Force on the
        move -- Move-Item -Force against an existing file throws in PS 5.1), with
        a Copy-Item fallback and a finally block that always cleans up the .tmp.
        Returns $true on success, $false on failure.
    #>
    $cacheDir = Split-Path -Parent $NvidiaFreeCacheFile
    if (-not (Test-Path $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null }
    $data = @{
        generated_at = (Get-Date).ToString("o")
        ttl_hours = $NvidiaFreeCacheTTLHours
        results = $results
    }
    $tmpFile = "$NvidiaFreeCacheFile.tmp"
    $data | ConvertTo-Json -Depth 4 | Out-File -FilePath $tmpFile -Encoding utf8 -Force

    $success = $false
    try {
        if (Test-Path -LiteralPath $NvidiaFreeCacheFile) {
            Remove-Item -LiteralPath $NvidiaFreeCacheFile -Force
        }
        try {
            Move-Item -LiteralPath $tmpFile -Destination $NvidiaFreeCacheFile -ErrorAction Stop
            $success = $true
        } catch {
            # Move failed (e.g. lock/permission): fall back to copy-then-delete.
            Copy-Item -LiteralPath $tmpFile -Destination $NvidiaFreeCacheFile -Force
            $success = $true
        }
    } catch {
        $success = $false
    } finally {
        # Never leave a stale .tmp behind, regardless of outcome.
        if (Test-Path -LiteralPath $tmpFile) {
            try { Remove-Item -LiteralPath $tmpFile -Force } catch { }
        }
    }
    return $success
}

# Behavioral probe: tries the model ID as-is first. If the NVIDIA API returns 404
# and the ID has an "nvidia/" prefix, retries once with the bare form (prefix stripped).
# Some models are only reachable without the prefix. 410 (Gone) is NOT retried.
function Test-NvidiaFreeEndpoint {
    param(
        [string]$ModelId,
        [string]$ApiKey
    )

    $result = @{
        model = $ModelId
        isFree = $false
        statusCode = 0
        reason = "unknown"
        rateLimitLimit = $null
        rateLimitRemaining = $null
        tested_at = (Get-Date).ToString("o")
    }

    # Bug A: per-call guard so the error_0 retry fires once per Test-NvidiaFreeEndpoint
    # invocation, not once per process lifetime.
    $script:errorZeroRetried = $false

    $url = "https://integrate.api.nvidia.com/v1/chat/completions"
    $reqHeaders = @{
        "Authorization" = "Bearer $ApiKey"
        "Content-Type" = "application/json"
    }

    # Build candidate ID list: prefixed form first, bare form as fallback on 404
    $candidateIds = @($ModelId)
    if ($ModelId -match '^nvidia/') {
        $bareId = $ModelId -replace '^nvidia/+', ''
        if ($bareId) { $candidateIds += $bareId }
    }

    $body = $null

    for ($ci = 0; $ci -lt $candidateIds.Count; $ci++) {
        $tryId = $candidateIds[$ci]
        $isLastCandidate = ($ci -eq ($candidateIds.Count - 1))

        # FIX 3 (2026-08-19): cap BOTH attempts at 10s. Launch-time probes were
        # taking up to 45.5s per slow model (15s + 0.5s sleep + 30s retry). The
        # cache-preservation machinery (error_0_preserved_free / error_0_cached_free)
        # keeps known-good free entries alive on timeout, so a shorter timeout only
        # degrades fresh-probe accuracy, never the free list itself. The retry still
        # gives a slow model one second chance, but each attempt is max 10s.
        $timeoutSec = 10

        $bodyObj = @{
            model = $tryId
            messages = @(@{ role = "user"; content = "ping" })
            max_tokens = 1
        }
        $body = $bodyObj | ConvertTo-Json -Depth 3

        try {
            $response = Invoke-WebRequest -Uri $url -Method Post -Body $body -Headers $reqHeaders -TimeoutSec $timeoutSec -UseBasicParsing -ErrorAction Stop
            $result.statusCode = [int]$response.StatusCode

            if ($response.Headers.ContainsKey("X-RateLimit-Limit")) {
                $result.rateLimitLimit = [string]$response.Headers["X-RateLimit-Limit"]
            }
            if ($response.Headers.ContainsKey("X-RateLimit-Remaining")) {
                $result.rateLimitRemaining = [string]$response.Headers["X-RateLimit-Remaining"]
            }

            $result.isFree = $true
            $result.reason = "no_billing_200_free"
            $result.model = $tryId
            return $result
        } catch {
            $statusCode = 0
            $respHeaders = $null
            if ($_.Exception.Response) {
                $statusCode = [int]$_.Exception.Response.StatusCode
                $respHeaders = $_.Exception.Response.Headers
            }
            $result.statusCode = $statusCode

            if ($respHeaders) {
                try {
                    $rlLimit = $respHeaders["X-RateLimit-Limit"]
                    if ($rlLimit) { $result.rateLimitLimit = [string]$rlLimit }
                } catch { }
                try {
                    $rlRemain = $respHeaders["X-RateLimit-Remaining"]
                    if ($rlRemain) { $result.rateLimitRemaining = [string]$rlRemain }
                } catch { }
            }

            if ($statusCode -eq 429) {
                $result.isFree = $true
                $result.model = $tryId
                $hasRetryAfter = $false
                if ($respHeaders) {
                    try {
                        $ra = $respHeaders["Retry-After"]
                        if ($ra) { $hasRetryAfter = $true }
                    } catch { }
                }
                if ($hasRetryAfter) {
                    $result.reason = "rate_limited_429_retry_after"
                } else {
                    $result.reason = "rate_limited_429"
                }
                return $result
            } elseif ($statusCode -eq 402 -or $statusCode -eq 403) {
                $result.isFree = $false
                $result.reason = "billing_required_$statusCode"
                $result.model = $tryId
                return $result
            } elseif ($statusCode -eq 410) {
                $result.isFree = $false
                $result.reason = "deprecated_410"
                $result.model = $tryId
                return $result
            } elseif ($statusCode -eq 404) {
                if (-not $isLastCandidate) {
                    continue
                }
                $result.isFree = $false
                $result.reason = "deprecated_404"
                $result.model = $tryId
                return $result
            } elseif ($statusCode -eq 0) {
                # Bug A: error_0 is a transient network timeout/connection failure,
                # not a definitive "not free" signal. Retry the same effective ID
                # once before falling back to the last-known-good cache entry.
                if (-not $script:errorZeroRetried) {
                    $script:errorZeroRetried = $true
                    if (-not $Silent) {
                        Write-Progress -Activity "Checking NVIDIA free models" -Status "Retrying $ModelId (timeout, 10s)..."
                    }
                    Start-Sleep -Milliseconds 500
                    $ci--  # re-run this same candidate iteration
                    continue
                }
                # Still error_0 after retry: fall back to last-known-good cache.
                # Bug A round-2: Load-NvidiaFreeCache respects the 24h TTL and returns
                # $null for a stale cache, so during a -Force refresh (which runs when
                # the cache is often stale) the fallback found no prior entry and kept
                # error_0/isFree=false. Read the cache FILE directly, bypassing the
                # TTL (mirror the Bug B pattern at the UseCacheOnly stale-cache block).
                $cachedFree = $false
                if (Test-Path $NvidiaFreeCacheFile) {
                    try {
                        $cached = Get-Content $NvidiaFreeCacheFile -Raw | ConvertFrom-Json
                        if ($cached -and $cached.results) {
                            $cachedEntry = $null
                            foreach ($prop in $cached.results.PSObject.Properties) {
                                if ($prop.Name -eq $ModelId) { $cachedEntry = $prop.Value; break }
                            }
                            if ($cachedEntry -and $cachedEntry.isFree -eq $true) { $cachedFree = $true }
                        }
                    } catch { }
                }
                if ($cachedFree) {
                    $result.isFree = $true
                    $result.reason = "error_0_cached_free"
                    $result.model = $tryId
                } else {
                    $result.isFree = $false
                    $result.reason = "error_0"
                    $result.model = $tryId
                }
                return $result
            } elseif ($statusCode -ge 500) {
                $result.isFree = $false
                $result.reason = "error_$statusCode"
                $result.model = $tryId
                return $result
            } else {
                $result.isFree = $false
                $result.reason = "unexpected_$statusCode"
                $result.model = $tryId
                return $result
            }
        }
    }

    return $result
}

function Get-NvidiaBehavioralFreeSet {
    param(
        [array]$FilteredModels,
        [string]$ApiKey,
        [switch]$UseCacheOnly,
        [switch]$Force
    )

    $freeSet = @{}

    $cache = Load-NvidiaFreeCache -Force:$Force
    if ($cache -and $cache.results) {
        foreach ($prop in $cache.results.PSObject.Properties) {
            $entry = $prop.Value
            if ($entry.isFree -eq $true) {
                $freeSet[$prop.Name] = $true
            }
            # FIX 4b: record the behavioral reason for registry tier honesty.
            $script:behavioralReasons[$prop.Name] = [string]$entry.reason
        }
        if (-not $Silent) {
            Write-Host "  NVIDIA free-model cache: $($freeSet.Count) free models (cached)" -ForegroundColor DarkGray
        }
        if ($UseCacheOnly) { return $freeSet }
    }

    # Bug B: when UseCacheOnly is set (launch path with -SkipNvidiaFreeCheck) and the
    # cache is stale or missing, returning an empty set drops ALL NVIDIA-only-free
    # models. A stale 24h-old result is better than no result. Fall back to reading
    # the cache file directly (bypass the TTL) before giving up.
    if ($UseCacheOnly) {
        $staleCache = $null
        if (Test-Path $NvidiaFreeCacheFile) {
            try { $staleCache = Get-Content $NvidiaFreeCacheFile -Raw | ConvertFrom-Json } catch { $staleCache = $null }
        }
        if ($staleCache -and $staleCache.results) {
            foreach ($prop in $staleCache.results.PSObject.Properties) {
                $entry = $prop.Value
                if ($entry.isFree -eq $true) {
                    $freeSet[$prop.Name] = $true
                }
                # FIX 4b: record the behavioral reason for registry tier honesty.
                $script:behavioralReasons[$prop.Name] = [string]$entry.reason
            }
            if (-not $Silent) {
                Write-Host "  NVIDIA free-model cache: $($freeSet.Count) free models (STALE - cache past TTL, using last-known-good)" -ForegroundColor Yellow
            }
            return $freeSet
        }
        # No cache file exists at all — fall through to probe instead of returning empty.
        # First launch on a fresh machine needs the probe to build the initial cache.
        if (-not $Silent) {
            Write-Host "  NVIDIA free-model cache: not found, running probe (first launch)..." -ForegroundColor Yellow
        }
    }
    if (-not $ApiKey) {
        if (-not $Silent) {
            Write-Host "  NVIDIA free-model check: no API key, skipping" -ForegroundColor DarkGray
        }
        return $freeSet
    }

    $results = @{}
    if ($cache -and $cache.results) {
        foreach ($prop in $cache.results.PSObject.Properties) {
            $results[$prop.Name] = $prop.Value
        }
    }

    $toTest = @()
    foreach ($m in $FilteredModels) {
        $fullId = Normalize-ModelId "nvidia/$($m.Replace('nvidia/', ''))"
        # FIX 1: skip only models with a DEFINITIVE cached result. Transient results
        # (error_0, error_5xx, unexpected_*) must be re-tested every run so a poisoned
        # entry can heal. Previously ANY cached entry was skipped, which locked a
        # flaky model (e.g. glm-5.2) out of re-testing forever after one timeout.
        if (-not $results.ContainsKey($fullId)) {
            $toTest += $m
        } else {
            $cachedReason = [string]$results[$fullId].reason
            if (-not (Test-BehavioralReasonDefinitive $cachedReason)) {
                $toTest += $m
            }
        }
    }

    if ($toTest.Count -gt 0) {
        if (-not $Silent) {
            Write-Host "  Checking NVIDIA free models: testing $($toTest.Count) models..." -ForegroundColor Cyan
        }

        $tested = 0
        if (-not $Silent) {
            Write-Progress -Activity "Checking NVIDIA free models" -Status "Testing $tested / $($toTest.Count) models" -PercentComplete 0
        }
        foreach ($m in $toTest) {
            $fullId = Normalize-ModelId "nvidia/$($m.Replace('nvidia/', ''))"
            $testResult = Test-NvidiaFreeEndpoint -ModelId $fullId -ApiKey $ApiKey

            # FIX 2: cache-poisoning guard. If the NEW result is transient (error_0 /
            # error_* / unexpected_*) AND the PRIOR cached entry (seeded into $results
            # from the cache at lines 962-967) was isFree=true, PRESERVE the prior
            # entry instead of overwriting it with the transient failure. This
            # prevents a single timeout from destroying a known-good free entry.
            $newReason = [string]$testResult.reason
            $priorEntry = $null
            if ($results.ContainsKey($fullId)) { $priorEntry = $results[$fullId] }

            if (-not (Test-BehavioralReasonDefinitive $newReason) -and $priorEntry -and $priorEntry.isFree -eq $true) {
                # Preserve: keep isFree=true, mark the reason so it is visible in the cache.
                $priorEntry.reason = "error_0_preserved_free"
                $priorEntry.tested_at = $testResult.tested_at
                $results[$fullId] = $priorEntry
                $freeSet[$fullId] = $true
                # FIX 4b: record the FINAL (preserved) reason.
                $script:behavioralReasons[$fullId] = "error_0_preserved_free"
            } else {
                # Normal path: overwrite with the fresh result.
                $results[$fullId] = $testResult
                if ($testResult.isFree) {
                    $freeSet[$fullId] = $true
                }
                # FIX 4b: record the FINAL reason.
                $script:behavioralReasons[$fullId] = $newReason
            }

            $tested++
            if (-not $Silent) {
                $shortName = ($m -split '/')[-1]
                Write-Progress -Activity "Checking NVIDIA free models" -Status "Testing $tested / $($toTest.Count): $shortName" -PercentComplete ([math]::Round(($tested / $toTest.Count) * 100))
            }
            Start-Sleep -Milliseconds 200
        }

        # Bug C fix made Save-NvidiaFreeCache return $success (bool). A BARE call
        # emits that bool to this function's output stream, where it pollutes the
        # caller's $script:behavioralFreeSet (becomes @($true, $freeSet)) and breaks
        # .ContainsKey() with a Boolean member-enumeration error on every model.
        # Absorb the return value so it never reaches the pipeline.
        $null = Save-NvidiaFreeCache $results

        if (-not $Silent) {
            Write-Host "  Checking NVIDIA free models: complete ($($freeSet.Count) free, $tested tested)" -ForegroundColor DarkGray
            Write-Progress -Activity "Checking NVIDIA free models" -Completed
        }
    } elseif (-not $Silent) {
        Write-Host "  Checking NVIDIA free models: all cached, no new tests needed" -ForegroundColor DarkGray
    }

    return $freeSet
}

$script:behavioralFreeSet = $null
# FIX 4a: map fullId -> behavioral reason string, populated by Get-NvidiaBehavioralFreeSet.
# Used by the registry build loop to label transient-error models "unverified" instead
# of the OpenRouter-derived tier (which would falsely call a timeout "budget_paid").
$script:behavioralReasons = @{}

function Test-NvidiaFreeCombined($nvidiaModelId) {
    if (Test-NvidiaFreeFromOpenRouter $nvidiaModelId) { return $true }
    if (-not $script:behavioralFreeSet) {
        if (-not $Silent) {
            Write-Host "  [WARN] Test-NvidiaFreeCombined: behavioralFreeSet not computed, falling back to OpenRouter-only" -ForegroundColor Yellow
        }
        return $false
    }
    $fullId = Normalize-ModelId "nvidia/$($nvidiaModelId.Replace('nvidia/', ''))"
    if ($script:behavioralFreeSet.ContainsKey($fullId)) { return $true }
    return $false
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

# NVIDIA: free models determined by OpenRouter pricing data (zero-cost :free variants)
$nvidiaGroup = @{
  name = "NVIDIA (free endpoint, requires /connect)"
  id_prefix = "nvidia"
  models = @()
}

if ($nvidiaModels -ne $null) {
  # Filter to keep only useful models
  $filteredModels = Filter-NvidiaModels $nvidiaModels

    # Compute NVIDIA free model set (loads from cache or runs HTTP probes).
    # Combined with OpenRouter pricing: either source saying free -> model is free.
    $nvidiaApiKey = Get-NvidiaApiKey
    $useCacheOnly = $SkipNvidiaFreeCheck
    $script:behavioralFreeSet = Get-NvidiaBehavioralFreeSet -FilteredModels $filteredModels -ApiKey $nvidiaApiKey -UseCacheOnly:$useCacheOnly -Force:$Force

    # Determine free status from OpenRouter pricing + behavioral detection.
    # OpenRouter is fast (already fetched). Behavioral catches NVIDIA-only free endpoints.
    if (-not $Silent) {
        Write-Host " Checking NVIDIA free status (OpenRouter + NVIDIA API)..." -ForegroundColor Cyan
    }
    $confirmedFreeCount = 0
    $skippedCount = 0

    foreach ($m in $filteredModels) {
        $isFree = Test-NvidiaFreeCombined $m
        if (-not $isFree) {
            $skippedCount++
            continue
        }
        $confirmedFreeCount++
        $fullId = Normalize-ModelId "nvidia/$($m.Replace('nvidia/', ''))"
        $parts = $m -split '/'
        $shortName = if ($parts.Count -ge 2) { $parts[-1] } else { $m }
        $displayName = Get-NvidiaDisplayName -modelName $shortName -isVision (Is-VisionModel $m)
        $nvidiaGroup.models += @{ id = $fullId; name = $displayName }
    }

    if (-not $Silent) {
        Write-Host "  Free models: $($nvidiaGroup.models.Count) confirmed, $skippedCount filtered out (paid/unverified)" -ForegroundColor DarkGray
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

# 6.75. Build model-registry.json (all models with pricing, tier, capabilities)
# This is the primary input for resolve-models.mjs
$RegistryFile = "$RootDir\config\model-registry.json"
$registryModels = @()

# Fetch OpenRouter full model data (pricing, context) for cross-referencing
$orFullModels = Fetch-OpenRouterFullModels

# Build a normalized lookup: "short name without prefix/free suffix" -> OpenRouter data
$orLookup = @{}
foreach ($orId in $orFullModels.Keys) {
    $normalized = Normalize-For-Matching $orId
    $orLookup[$normalized] = $orFullModels[$orId]
}

# --- Helper: try to find OpenRouter pricing for a model by normalized matching ---
function Get-OpenRouterPricing($modelId) {
    $orFull = Fetch-OpenRouterFullModels
    # Try exact match
    if ($orFull.ContainsKey($modelId)) { return $orFull[$modelId] }
    # Try normalized match
    $normalized = Normalize-For-Matching $modelId
    foreach ($key in $orFull.Keys) {
        $keyNorm = Normalize-For-Matching $key
        if ($keyNorm -eq $normalized) { return $orFull[$key] }
    }
    # Try last-segment match (e.g. "minimax-m3" from "nvidia/minimaxai/minimax-m3")
    $parts = $modelId -split '/'
    $lastSegment = $parts[-1]
    foreach ($key in $orFull.Keys) {
        if ($key -match [regex]::Escape($lastSegment)) {
            return $orFull[$key]
        }
    }
    return $null
}

# OpenCode Zen models: both free and paid tiers exist; tier/free derived from OpenRouter pricing
# Free-tier heuristic: model ID ends in "-free" or equals "big-pickle" (fallback when no OpenRouter data)
# Unknown non-free: pricing = $null, tier = "budget_paid" (mirrors Go provider L1345-1354 convention)
if ($zenModels -ne $null) {
    foreach ($m in $zenModels) {
        $fullId = "opencode/$m"
        $orData = Get-OpenRouterPricing $fullId
        $capabilities = @(Get-ModelCapabilities -modelId $m -provider "opencode")
        if ($orData) {
            $p = 0.0; [void][double]::TryParse($orData.pricing.prompt, [ref]$p)
            $c = 0.0; [void][double]::TryParse($orData.pricing.completion, [ref]$c)
            $registryModels += @{
                id = $fullId; source = "zen"; provider = "opencode"
                pricing = @{ prompt = $p; completion = $c }
                tier = Get-CostTier $p $c
                capabilities = $capabilities
                context_length = $orData.context_length
                vision = ($capabilities -contains "vision"); free = ($p -eq 0.0 -and $c -eq 0.0)
            }
        } elseif ($m -match '-free$' -or $m -eq 'big-pickle') {
            # Known free pattern — no OpenRouter data, trust the ID convention
            $registryModels += @{
                id = $fullId; source = "zen"; provider = "opencode"
                pricing = @{ prompt = 0; completion = 0 }
                tier = "free"
                capabilities = $capabilities
                context_length = $null
                vision = ($capabilities -contains "vision"); free = $true
            }
        } else {
            # No pricing data and not a known-free pattern — same as Go unknown path
            $registryModels += @{
                id = $fullId; source = "zen"; provider = "opencode"
                pricing = $null
                tier = "budget_paid"
                capabilities = $capabilities
                context_length = $null
                vision = ($capabilities -contains "vision"); free = $false
            }
        }
    }
}

# OpenCode Go models: paid, estimate budget_paid unless OpenRouter says otherwise
if ($goModels -ne $null) {
    foreach ($m in $goModels) {
        $fullId = "opencode-go/$m"
        $orData = Get-OpenRouterPricing $fullId
        $capabilities = @(Get-ModelCapabilities -modelId $m -provider "opencode-go")
        if ($orData) {
            $p = 0.0; $c = 0.0
            [void][double]::TryParse($orData.pricing.prompt, [ref]$p)
            [void][double]::TryParse($orData.pricing.completion, [ref]$c)
            $registryModels += @{
                id = $fullId; source = "go"; provider = "opencode-go"
                pricing = @{ prompt = $p; completion = $c }
                tier = Get-CostTier $p $c
                capabilities = $capabilities
                context_length = $orData.context_length
                vision = ($capabilities -contains "vision"); free = ($p -eq 0.0 -and $c -eq 0.0)
            }
        } else {
            $registryModels += @{
                id = $fullId; source = "go"; provider = "opencode-go"
                pricing = $null
                tier = "budget_paid"
                capabilities = $capabilities
                context_length = $null
                vision = ($capabilities -contains "vision"); free = $false
            }
        }
    }
}

# NVIDIA models (all filtered, includes both free and paid)
if ($nvidiaModels -ne $null) {
    $filteredModels = Filter-NvidiaModels $nvidiaModels
    foreach ($m in $filteredModels) {
        $fullId = Normalize-ModelId "nvidia/$($m.Replace('nvidia/', ''))"
        $orData = Get-OpenRouterPricing $fullId
        $capabilities = @(Get-ModelCapabilities -modelId $m -provider "nvidia")

        # Free status from OpenRouter pricing + behavioral detection (either says free -> free)
        $isFree = Test-NvidiaFreeCombined $m

        if ($orData) {
            $p = 0.0; $c = 0.0
            [void][double]::TryParse($orData.pricing.prompt, [ref]$p)
            [void][double]::TryParse($orData.pricing.completion, [ref]$c)
            # tier = "free" if OpenRouter confirms free; otherwise use OpenRouter pricing tier
            $costTier = Get-CostTier $p $c
            if ($isFree) { $costTier = "free" }
            # FIX 4c: if not free AND the behavioral reason is transient (error_0 /
            # error_* / unexpected_*), the model is UNVERIFIED, not "budget_paid".
            # A transient timeout must not be mislabeled as a definitive paid tier.
            if (-not $isFree) {
                $bhReason = [string]$script:behavioralReasons[$fullId]
                if (-not (Test-BehavioralReasonDefinitive $bhReason) -and $bhReason -ne "") {
                    $costTier = "unverified"
                }
            }
            $registryModels += @{
                id = $fullId; source = "nvidia"; provider = "nvidia"
                pricing = @{ prompt = $p; completion = $c }
                tier = $costTier
                capabilities = $capabilities
                context_length = $orData.context_length
                vision = ($capabilities -contains "vision"); free = $isFree
            }
        } else {
            # No OpenRouter match — tier from OpenRouter free check only
            $costTier = "unknown"
            if ($isFree) { $costTier = "free" }
            # FIX 4c: if not free AND the behavioral reason is transient, label
            # "unverified" instead of "unknown" to signal the probe failed (not
            # that the model is genuinely paid/unknown).
            if (-not $isFree) {
                $bhReason = [string]$script:behavioralReasons[$fullId]
                if (-not (Test-BehavioralReasonDefinitive $bhReason) -and $bhReason -ne "") {
                    $costTier = "unverified"
                }
            }
            $registryModels += @{
                id = $fullId; source = "nvidia"; provider = "nvidia"
                pricing = $null
                tier = $costTier
                capabilities = $capabilities
                context_length = $null
                vision = ($capabilities -contains "vision"); free = $isFree
            }
        }
    }
}

# OpenRouter models (all, including free and paid)
foreach ($orId in $orFullModels.Keys) {
    $orData = $orFullModels[$orId]
    $capabilities = @(Get-ModelCapabilities -modelId $orId -provider "openrouter" -contextLength $orData.context_length)
    $p = 0.0; $c = 0.0
    [void][double]::TryParse($orData.pricing.prompt, [ref]$p)
    [void][double]::TryParse($orData.pricing.completion, [ref]$c)
    # Skip OpenRouter routing models
    if ($orId -match '^openrouter/(auto|free|fusion|bodybuilder|pareto-code)$') { continue }
    $registryModels += @{
        id = $orId; source = "openrouter"; provider = "openrouter"
        pricing = @{ prompt = $p; completion = $c }
        tier = Get-CostTier $p $c
        capabilities = $capabilities
        context_length = $orData.context_length
        vision = ($capabilities -contains "vision"); free = ($p -eq 0.0 -and $c -eq 0.0)
    }
}

# Deduplicate by model ID (keep first occurrence — source priority: zen > go > nvidia > openrouter)
$seen = @{}
$dedupedModels = @()
foreach ($entry in $registryModels) {
    if (-not $seen.ContainsKey($entry.id)) {
        $seen[$entry.id] = $true
        $dedupedModels += $entry
    }
}

$registryData = @{
    generated_at = (Get-Date).ToString("o")
    total_models = $dedupedModels.Count
    models = $dedupedModels
}
$registryDir = Split-Path -Parent $RegistryFile
if (-not (Test-Path $registryDir)) { New-Item -ItemType Directory -Path $registryDir -Force | Out-Null }
$registryData | ConvertTo-Json -Depth 4 | Out-File -FilePath $RegistryFile -Encoding utf8 -Force

# 6.76. Sync providers.json — additive merge of nvidia models from registry
# Prevents static drift where providers.json is missing models discovered at runtime.
$ProvidersFile = "$RootDir\config\providers.json"
$addedCount = 0
try {
    if (Test-Path $ProvidersFile) {
        $providersData = Get-Content $ProvidersFile -Raw | ConvertFrom-Json
        if (-not ($providersData.nvidia.models -is [PSCustomObject])) {
            $providersData.nvidia | Add-Member -NotePropertyName "models" -NotePropertyValue ([ordered]@{}) -Force
        }
        foreach ($entry in $dedupedModels) {
            if ($entry.id -like "nvidia/*") {
                $modelKey = $entry.id  # e.g. "nvidia/nemotron-3.5-lightning-30b-a3b"
                if (-not ($providersData.nvidia.models.PSObject.Properties.Name -contains $modelKey)) {
                    $displayName = "$($entry.id -replace 'nvidia/', '') (free)"
                    $providersData.nvidia.models | Add-Member -NotePropertyName $modelKey -NotePropertyValue ([ordered]@{ name = $displayName }) -Force
                    $addedCount++
                }
            }
        }
        if ($addedCount -gt 0) {
            $providersData | ConvertTo-Json -Depth 4 | Out-File -FilePath $ProvidersFile -Encoding utf8 -Force
            if (-not $Silent) { Write-Host " + Synced $addedCount nvidia model(s) to providers.json" -ForegroundColor Green }
        } else {
            if (-not $Silent) { Write-Host " providers.json: no nvidia models to sync (all present)" -ForegroundColor DarkGray }
        }
    }
} catch {
    if (-not $Silent) { Write-Host " [WARN] providers.json sync failed: $($_.Exception.Message)" -ForegroundColor Yellow }
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
    Write-Host " Model registry: config\model-registry.json ($($dedupedModels.Count) models)" -ForegroundColor DarkGray
    Write-Host ""
}

# Exit with code indicating if new models were found
if ($newModels.Count -gt 0) { exit 1 } else { exit 0 }
