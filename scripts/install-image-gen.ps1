param(
  [string]$ComfyUIPath = "",
  [switch]$SkipPython = $false,
  [switch]$SkipModel = $false,
  [switch]$Force = $false
)

$ErrorActionPreference = "Stop"

# ── Helpers ──
function Write-Step {
  param([string]$Text)
  Write-Host "  $Text" -ForegroundColor Cyan
}

function Write-Ok {
  param([string]$Text)
  Write-Host "    OK $Text" -ForegroundColor Green
}

function Write-Warn {
  param([string]$Text)
  Write-Host "    WARNING: $Text" -ForegroundColor Yellow
}

function Write-Fail {
  param([string]$Text)
  Write-Host "    FAILED: $Text" -ForegroundColor Red
}

function Get-FreeDiskBytes([string]$Path) {
  $drive = (Get-Item $Path).PSDrive
  return $drive.Free
}

function Get-IsoTimestamp {
  return (Get-Date -Format "o")
}

# ── 1. Resolve Paths ──
$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Split-Path -Parent $ScriptDir
$PythonDir = Join-Path $RootDir "data/python"
$ComfyUIDir = if ($ComfyUIPath) { $ComfyUIPath } else { Join-Path $RootDir "data/comfyui" }
$ComfyUIRepo = Join-Path $ComfyUIDir "ComfyUI"
$VenvDir = Join-Path $ComfyUIDir "venv"
$ModelsDir = Join-Path $ComfyUIDir "models/checkpoints"
$WorkflowsDir = Join-Path $ComfyUIDir "workflows"
$ScreenshotsDir = Join-Path $RootDir "data/screenshots"
$TempDir = Join-Path $RootDir "temp"

Write-Host ""
Write-Host "Image Generation Module Installer" -ForegroundColor Magenta
Write-Host "  Root: $RootDir" -ForegroundColor DarkGray
Write-Host ""

# ── 2. Check Prerequisites ──
Write-Step "[1/12] Checking prerequisites..."

$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) {
  Write-Fail "git is not installed or not in PATH. Install git from https://git-scm.com/ and try again."
  exit 1
}
Write-Ok "git found at $($gitCmd.Source)"

$freeBytes = Get-FreeDiskBytes $RootDir
$freeGB = [math]::Round($freeBytes / 1GB, 1)
$requiredGB = 25
if ($freeBytes -lt ($requiredGB * 1GB)) {
  Write-Fail "Insufficient disk space. Need at least ${requiredGB}GB free on drive $((Get-Item $RootDir).PSDrive.Name), have ${freeGB}GB."
  exit 1
}
Write-Ok "Disk space: ${freeGB}GB free (need ${requiredGB}GB)"

# Create required directories
$null = New-Item -ItemType Directory -Path $ComfyUIDir -Force
$null = New-Item -ItemType Directory -Path $ModelsDir -Force
$null = New-Item -ItemType Directory -Path $WorkflowsDir -Force
$null = New-Item -ItemType Directory -Path $TempDir -Force
Write-Ok "Directories created"

# ── 3. Install Portable Python ──
Write-Step "[2/12] Installing portable Python..."

$skipPython = $false
if (-not $SkipPython) {
  if (Test-Path (Join-Path $PythonDir "python.exe")) {
    if ($Force) {
      Write-Warn "Python already installed at $PythonDir, reinstalling due to -Force"
      Remove-Item $PythonDir -Recurse -Force -ErrorAction Continue
    } else {
      Write-Ok "Python already installed at $PythonDir (use -SkipPython to skip, -Force to reinstall)"
      $pythonVer = & (Join-Path $PythonDir "python.exe") --version 2>&1
      Write-Ok "$($pythonVer.Trim())"
      $skipPython = $true
    }
  }

  if (-not $skipPython) {
    Write-Host "    Fetching latest python-build-standalone release..." -ForegroundColor Yellow
    try {
      $releaseJson = Invoke-WebRequest -Uri "https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest" -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop | ConvertFrom-Json
      $tagName = $releaseJson.tag_name
      Write-Ok "Latest release: $tagName"
    } catch {
      Write-Fail "Could not fetch latest Python release from GitHub: $_"
      Write-Warn "Check your internet connection or try again later."
      exit 1
    }

    $assetUrl = "https://github.com/astral-sh/python-build-standalone/releases/download/$tagName/cpython-3.12.13+20250129-x86_64-pc-windows-msvc-shared-install_only.tar.gz"
    $archivePath = Join-Path $TempDir "python.tar.gz"

    Write-Host "    Downloading Python ($tagName)..." -ForegroundColor Yellow
    Write-Host "    URL: $assetUrl" -ForegroundColor DarkGray
    Write-Host "    This may take a minute..." -ForegroundColor DarkGray

    try {
      $wc = New-Object System.Net.WebClient
      $wc.DownloadFile($assetUrl, $archivePath)
      Write-Ok "Downloaded to $archivePath"
    } catch {
      Write-Fail "Download failed: $_"
      exit 1
    }

    Write-Host "    Extracting..." -ForegroundColor Yellow
    $extractTemp = Join-Path $TempDir "python-extracted"
    if (Test-Path $extractTemp) { Remove-Item $extractTemp -Recurse -Force -ErrorAction SilentlyContinue }
    $null = New-Item -ItemType Directory -Path $extractTemp -Force

    try {
      tar -xzf $archivePath -C $extractTemp 2>$null
      if ($LASTEXITCODE -ne 0) { throw "tar extraction failed with exit code $LASTEXITCODE" }
    } catch {
      Write-Warn "tar extraction failed, trying alternative..."

      $7z = Get-Command "7z" -ErrorAction SilentlyContinue
      if ($null -ne $7z) {
        & $7z.Source x $archivePath -o"$extractTemp" -y 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1) { throw "7z extraction failed with exit code $LASTEXITCODE" }
      } else {
        throw "No tar or 7z available for extraction. Install 7-Zip or use Windows 10+ with built-in tar."
      }
    }

    $pythonSubdir = Get-ChildItem -Path $extractTemp -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq "python" } | Select-Object -First 1
    if (-not $pythonSubdir) {
      $pythonSubdir = Get-ChildItem -Path $extractTemp -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    }

    if (-not $pythonSubdir) {
      Write-Fail "Could not find python directory in extracted archive"
      exit 1
    }

    if (Test-Path $PythonDir) { Remove-Item $PythonDir -Recurse -Force -ErrorAction SilentlyContinue }
    $null = New-Item -ItemType Directory -Path $PythonDir -Force
    Copy-Item "$($pythonSubdir.FullName)\*" $PythonDir -Recurse -Force

    Set-Content -Path (Join-Path $PythonDir "version.txt") -Value $tagName -Encoding UTF8
    Write-Ok "Python installed to $PythonDir"

    $pythonVer = & (Join-Path $PythonDir "python.exe") --version 2>&1
    Write-Ok $pythonVer.Trim()

    Remove-Item $archivePath -Force -ErrorAction SilentlyContinue
    Remove-Item $extractTemp -Recurse -Force -ErrorAction SilentlyContinue
    Write-Ok "Temp files cleaned"
  }

  Write-Ok "Python step complete"
} else {
  if (-not (Test-Path (Join-Path $PythonDir "python.exe"))) {
    Write-Warn "-SkipPython specified but no Python found at $PythonDir"
    Write-Warn "Run without -SkipPython first, or install Python manually."
    exit 1
  }
  $pythonVer = & (Join-Path $PythonDir "python.exe") --version 2>&1
  Write-Ok "Python already present: $($pythonVer.Trim())"
}

$PythonExe = Join-Path $PythonDir "python.exe"

# ── 4. Clone ComfyUI ──
Write-Step "[3/12] Cloning ComfyUI..."

if (Test-Path $ComfyUIRepo) {
  if ($Force) {
    Write-Warn "ComfyUI already exists at $ComfyUIRepo, removing due to -Force"
    Remove-Item $ComfyUIRepo -Recurse -Force -ErrorAction Continue
  } else {
    Write-Fail "ComfyUI already installed at $ComfyUIRepo. Use -Force to reinstall."
    exit 1
  }
}

try {
  git clone https://github.com/comfyanonymous/ComfyUI.git $ComfyUIRepo 2>&1 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
  if ($LASTEXITCODE -ne 0) { throw "git clone failed with exit code $LASTEXITCODE" }
  Write-Ok "ComfyUI cloned to $ComfyUIRepo"
} catch {
  Write-Fail "Failed to clone ComfyUI: $_"
  exit 1
}

# ── 5. Create Virtual Environment ──
Write-Step "[4/12] Creating Python virtual environment..."

try {
  & $PythonExe -m venv $VenvDir
  if ($LASTEXITCODE -ne 0) { throw "venv creation failed" }
  Write-Ok "Virtual environment created at $VenvDir"
} catch {
  Write-Fail "Failed to create virtual environment: $_"
  exit 1
}

$VenvPython = Join-Path $VenvDir "Scripts/python.exe"
$VenvPip = Join-Path $VenvDir "Scripts/pip.exe"

Write-Host "    Upgrading pip..." -ForegroundColor Yellow
try {
  & $VenvPip install --upgrade pip 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed" }
  Write-Ok "pip upgraded"
} catch {
  Write-Warn "pip upgrade failed: $_"
  Write-Warn "Continuing with existing pip..."
}

# ── 6. Install ComfyUI Dependencies ──
Write-Step "[5/12] Installing ComfyUI dependencies..."
Write-Host "    Installing torch with CUDA support..." -ForegroundColor Yellow

try {
  & $VenvPip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124 2>&1 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
  if ($LASTEXITCODE -ne 0) { throw "torch installation failed" }
  Write-Ok "torch + torchvision + torchaudio installed"
} catch {
  Write-Warn "CUDA torch installation failed: $_"
  Write-Warn "Falling back to CPU-only torch..."
  try {
    & $VenvPip install torch torchvision torchaudio 2>&1 | Out-Null
    Write-Ok "CPU torch installed (CUDA not available)"
  } catch {
    Write-Warn "CPU torch also failed. Will continue — torch is included in requirements.txt."
  }
}

Write-Host "    Installing ComfyUI requirements..." -ForegroundColor Yellow
try {
  & $VenvPip install -r "$ComfyUIRepo/requirements.txt" 2>&1 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
  if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
  Write-Ok "ComfyUI requirements installed"
} catch {
  Write-Fail "Failed to install ComfyUI requirements: $_"
  exit 1
}

Write-Host "    Installing additional packages..." -ForegroundColor Yellow
try {
  & $VenvPip install xformers einops opencv-python-headless pillow safetensors 2>&1 | Out-Null
  Write-Ok "Additional packages installed (xformers, einops, opencv, pillow, safetensors)"
} catch {
  Write-Warn "Some additional packages failed to install: $_"
  Write-Warn "Core functionality should still work."
}

# ── 7. Download SDXL Model ──
Write-Step "[6/12] Downloading SDXL model..."

if (-not $SkipModel) {
  $modelUrlPrimary = "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0_0.9vae.safetensors"
  $modelFile = Join-Path $ModelsDir "sd_xl_base_1.0.safetensors"

  $skipDownload = $false
  if (Test-Path $modelFile) {
    $existingSize = (Get-Item $modelFile).Length
    if ($existingSize -gt 6GB -and -not $Force) {
      Write-Ok "Model already exists at $modelFile ($([math]::Round($existingSize / 1GB, 1))GB)"
      $skipDownload = $true
    } else {
      Write-Warn "Existing model file is incomplete ($([math]::Round($existingSize / 1GB, 1))GB), re-downloading..."
      Remove-Item $modelFile -Force -ErrorAction SilentlyContinue
    }
  }

  if (-not $skipDownload) {
    Write-Host "    Model: SDXL Base 1.0 (~6.9GB)" -ForegroundColor Yellow
    Write-Host "    This may take 10-30 minutes depending on your connection." -ForegroundColor Yellow
    Write-Host "    Source: $modelUrlPrimary" -ForegroundColor DarkGray

    $freeAfterPython = Get-FreeDiskBytes $RootDir
    if ($freeAfterPython -lt 15GB) {
      Write-Warn "Low disk space ($([math]::Round($freeAfterPython / 1GB, 1))GB free). SDXL model needs ~7GB."
      Write-Warn "Free up space or use -SkipModel to skip model download."
    }

    try {
      $wc = New-Object System.Net.WebClient
      $wc.DownloadFile($modelUrlPrimary, $modelFile)
      Write-Ok "Model downloaded to $modelFile"
    } catch {
      Write-Fail "Primary download failed: $_"
      Write-Warn "Backup URL (download manually):"
      Write-Warn "  https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0_0.9vae.safetensors"
      Write-Warn "Place the file at: $modelFile"
      Write-Warn "Then re-run with -SkipModel to skip this step."
      exit 1
    }

    $dlSize = (Get-Item $modelFile).Length
    Write-Ok "Model size: $([math]::Round($dlSize / 1GB, 1))GB"
  }

  Write-Ok "Model step complete"
} else {
  Write-Ok "Model download skipped (-SkipModel)"
}

# ── 8. Create Default Workflow ──
Write-Step "[7/12] Creating default SDXL workflow..."

$workflow = @{
  "1" = @{
    class_type = "CheckpointLoaderSimple"
    inputs = @{
      ckpt_name = "sd_xl_base_1.0.safetensors"
    }
  }
  "2" = @{
    class_type = "CLIPTextEncode"
    inputs = @{
      text = "beautiful landscape, vibrant colors, highly detailed"
      clip = @("1", 1)
    }
  }
  "3" = @{
    class_type = "CLIPTextEncode"
    inputs = @{
      text = "blurry, low quality, distorted, ugly"
      clip = @("1", 1)
    }
  }
  "4" = @{
    class_type = "EmptyLatentImage"
    inputs = @{
      width = 1024
      height = 1024
      batch_size = 1
    }
  }
  "5" = @{
    class_type = "KSampler"
    inputs = @{
      seed = 42
      steps = 20
      cfg = 7
      sampler_name = "dpmpp_2m_karras"
      scheduler = "karras"
      denoise = 1
      model = @("1", 0)
      positive = @("2", 0)
      negative = @("3", 0)
      latent_image = @("4", 0)
    }
  }
  "6" = @{
    class_type = "VAEDecode"
    inputs = @{
      samples = @("5", 0)
      vae = @("1", 2)
    }
  }
  "7" = @{
    class_type = "SaveImage"
    inputs = @{
      filename_prefix = "Glitch_AI_"
      images = @("6", 0)
    }
  }
}

$workflowJson = $workflow | ConvertTo-Json -Depth 4
Set-Content -Path (Join-Path $WorkflowsDir "sdxl-default.json") -Value $workflowJson -Encoding UTF8
Write-Ok "Default workflow created at $WorkflowsDir\sdxl-default.json"

# ── 9. Write Models Manifest ──
Write-Step "[8/12] Writing models manifest..."

Push-Location $ComfyUIRepo
$comfyuiCommit = (& git rev-parse HEAD 2>$null).Trim()
Pop-Location

$pythonVerFull = (& $PythonExe --version 2>$null).Trim()

$manifest = @{
  installed_at = Get-IsoTimestamp
  models = @(
    @{
      name = "sd_xl_base_1.0.safetensors"
      source = "stabilityai/stable-diffusion-xl-base-1.0"
      url = "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0_0.9vae.safetensors"
      size_gb = 6.9
    }
  )
  comfyui_commit = $comfyuiCommit
  python_version = $pythonVerFull
  last_checked = Get-IsoTimestamp
}

$manifest | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $ComfyUIDir "models-manifest.json") -Encoding UTF8
Write-Ok "Manifest written to $ComfyUIDir\models-manifest.json"

# ── 10. Verify Installation ──
Write-Step "[9/12] Verifying installation..."

$test1 = & $VenvPython -c "import torch; print(torch.cuda.is_available())" 2>&1
if ($LASTEXITCODE -eq 0) {
  $cudaAvailable = $test1.Trim()
  if ($cudaAvailable -eq "True") {
    Write-Ok "CUDA available — GPU acceleration ready"
  } else {
    Write-Warn "CUDA not available. Running on CPU (slower but functional)."
    Write-Warn "  Install CUDA 12.4 toolkit from https://developer.nvidia.com/cuda-downloads"
  }
} else {
  Write-Warn "torch import failed: $test1"
  Write-Warn "  ComfyUI may still work if dependencies are intact."
}

$test2 = & $VenvPython -c "import folder_paths; print('OK')" 2>&1
if ($LASTEXITCODE -eq 0) {
  Write-Ok "ComfyUI import OK (folder_paths loaded)"
} else {
  Write-Warn "ComfyUI import failed: $test2"
  Write-Warn "  Check requirements installation."
}

# ── 11. Create Screenshots Directory ──
Write-Step "[10/12] Creating screenshots directory..."
$null = New-Item -ItemType Directory -Path $ScreenshotsDir -Force
Write-Ok "Screenshots directory: $ScreenshotsDir"

# ── 12. Print Success Message ──
Write-Step "[11/12] Cleaning up..."
Remove-Item (Join-Path $TempDir "python.tar.gz") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $TempDir "python-extracted") -Recurse -Force -ErrorAction SilentlyContinue
Write-Ok "Temp files cleaned"

Write-Step "[12/12] Done!"

Write-Host ""
Write-Host "============================================" -ForegroundColor Magenta
Write-Host " Image generation module installed!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  Python: $PythonExe" -ForegroundColor White
Write-Host "  ComfyUI: $ComfyUIRepo" -ForegroundColor White
Write-Host "  Model: sd_xl_base_1.0.safetensors" -ForegroundColor White
Write-Host "  Workflow: $WorkflowsDir\sdxl-default.json" -ForegroundColor White
Write-Host "  Screenshots: $ScreenshotsDir" -ForegroundColor White
Write-Host ""
Write-Host "Start ComfyUI with: scripts/start-comfyui.ps1" -ForegroundColor Cyan
Write-Host ""
