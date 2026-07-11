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

# --- Helper: check if a NVIDIA model has "Free Endpoint" badge on build.nvidia.com ---
# Cache to avoid repeated HTTP requests
$script:nvidiaFreeEndpointCache = @{}
$script:nvidiaFreeCacheFile = "$RootDir\data\nvidia-free-cache.json"

# Load persistent cache for NVIDIA free endpoint status (24h TTL)
if (Test-Path $script:nvidiaFreeCacheFile) {
    try {
        $cache = Get-Content $script:nvidiaFreeCacheFile -Raw | ConvertFrom-Json
        $cachedAt = [DateTime]::Parse($cache.cached_at)
        if ((Get-Date) - $cachedAt -lt [TimeSpan]::FromHours(24)) {
            foreach ($entry in $cache.results.PSObject.Properties) {
                $script:nvidiaFreeEndpointCache[$entry.Name] = $entry.Value
            }
        }
    } catch { }
}

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

# --- Helper: verify NVIDIA models against build.nvidia.com dynamically ---
# Accepts the full filtered model list and checks each one.
# Uses cached results when available (loaded at script start).
function Verify-NvidiaFreeModels {
    param($models)
    
    if (-not $models -or $models.Count -eq 0) { return @{} }
    
    Write-Host "  Checking $($models.Count) NVIDIA models for free endpoint status..." -ForegroundColor Cyan
    $results = @{}
    $fetchedCount = 0
    $cachedCount = 0
    foreach ($model in $models) {
        # Use cached result if available (from file cache loaded at script start)
        if ($script:nvidiaFreeEndpointCache.ContainsKey($model)) {
            $isFree = $script:nvidiaFreeEndpointCache[$model]
            $cachedCount++
        } else {
            $isFree = Test-NvidiaFreeEndpoint $model
            $fetchedCount++
            Start-Sleep -Milliseconds 300  # Be nice to server during live fetch
        }
        $results[$model] = $isFree
        if ($isFree -eq $true) {
            Write-Host "  [OK] $model - Free Endpoint confirmed" -ForegroundColor Green
        } elseif ($isFree -eq $false) {
            Write-Host "  [FAIL] $model - NOT free (no badge)" -ForegroundColor Red
        } else {
            Write-Host "  [WARN] $model - Could not verify" -ForegroundColor Yellow
        }
    }
    if ($fetchedCount -gt 0) {
        Write-Host "  ($cachedCount from cache, $fetchedCount live fetches)" -ForegroundColor DarkGray
    } elseif ($cachedCount -gt 0) {
        Write-Host "  (all $cachedCount from cache)" -ForegroundColor DarkGray
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
  
    if ($SkipNvidiaFreeCheck) {
      # Normal mode - skip free endpoint verification, include all NVIDIA models
      foreach ($m in $filteredModels) {
        $fullId = Normalize-ModelId "nvidia/$($m.Replace('nvidia/', ''))"
        $parts = $m -split '/'
        $shortName = if ($parts.Count -ge 2) { $parts[-1] } else { $m }
        $displayName = Get-NvidiaDisplayName -modelName $shortName -isVision (Is-VisionModel $m)
        $nvidiaGroup.models += @{ id = $fullId; name = $displayName }
      }
  } else {
    # Free mode - verify free endpoint status, only include confirmed-free models
    Write-Host " Verifying NVIDIA free endpoint status..." -ForegroundColor Cyan
    $freeStatus = Verify-NvidiaFreeModels -models $filteredModels
    
    $confirmedFree = @($freeStatus.Keys | Where-Object { $freeStatus[$_] -eq $true })
    $skippedCount = 0
    
    foreach ($m in $filteredModels) {
      if ($m -notin $confirmedFree) {
        $skippedCount++
        continue
      }
      $fullId = Normalize-ModelId "nvidia/$($m.Replace('nvidia/', ''))"
      $parts = $m -split '/'
      $shortName = if ($parts.Count -ge 2) { $parts[-1] } else { $m }
      $displayName = Get-NvidiaDisplayName -modelName $shortName -isVision (Is-VisionModel $m)
      $nvidiaGroup.models += @{ id = $fullId; name = $displayName }
    }
    
    Write-Host "  Free models: $($nvidiaGroup.models.Count) confirmed, $skippedCount filtered out (unverified/paid)" -ForegroundColor DarkGray
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
$RegistryFile = "$RootDir\data\model-registry.json"
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

# OpenCode Zen models: all free
if ($zenModels -ne $null) {
    foreach ($m in $zenModels) {
        if ($m -match '-free$' -or $m -eq 'big-pickle') {
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
                    vision = ($capabilities -contains "vision"); free = $true
                }
            } else {
                $registryModels += @{
                    id = $fullId; source = "zen"; provider = "opencode"
                    pricing = @{ prompt = 0; completion = 0 }
                    tier = "free"
                    capabilities = $capabilities
                    context_length = $null
                    vision = ($capabilities -contains "vision"); free = $true
                }
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

        if ($orData) {
            $p = 0.0; $c = 0.0
            [void][double]::TryParse($orData.pricing.prompt, [ref]$p)
            [void][double]::TryParse($orData.pricing.completion, [ref]$c)
            $isFreeEndpoint = $false
            try { $isFreeEndpoint = (Test-NvidiaFreeEndpoint $m) -eq $true } catch {}
            $registryModels += @{
                id = $fullId; source = "nvidia"; provider = "nvidia"
                pricing = @{ prompt = $p; completion = $c }
                tier = if ($isFreeEndpoint) { "free" } else { Get-CostTier $p $c }
                capabilities = $capabilities
                context_length = $orData.context_length
                vision = ($capabilities -contains "vision"); free = $isFreeEndpoint
            }
        } else {
            # No OpenRouter match — use free/endpoint heuristic only
            $isFree = $false
            try { $isFree = (Test-NvidiaFreeEndpoint $m) -eq $true } catch {}
            $registryModels += @{
                id = $fullId; source = "nvidia"; provider = "nvidia"
                pricing = $null
                tier = if ($isFree) { "free" } else { "unknown" }
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
$registryData | ConvertTo-Json -Depth 4 | Out-File -FilePath $RegistryFile -Encoding utf8 -Force

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

# 7.5 Save NVIDIA free endpoint cache for next launch
$cacheSave = @{
    cached_at = (Get-Date).ToString("o")
    results = $script:nvidiaFreeEndpointCache
}
$cacheDir = Split-Path -Parent $script:nvidiaFreeCacheFile
if (-not (Test-Path $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null }
$cacheSave | ConvertTo-Json -Depth 4 | Out-File -FilePath $script:nvidiaFreeCacheFile -Encoding utf8 -Force

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
    Write-Host " Model registry: data\model-registry.json ($($dedupedModels.Count) models)" -ForegroundColor DarkGray
    Write-Host ""
}

# Exit with code indicating if new models were found
if ($newModels.Count -gt 0) { exit 1 } else { exit 0 }
