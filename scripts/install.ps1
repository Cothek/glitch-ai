<# 
.SYNOPSIS
    Glitch AI Installer for Windows (PowerShell 5.1+)
    Standalone installer - download and run directly from GitHub.

.DESCRIPTION
    This script installs Glitch AI by cloning the repository, running the bootstrap
    script to download dependencies (Node.js, OpenCode, Handy, etc.), optionally
    setting up a user profile from GitHub, and launching Glitch.

.PARAMETER InstallDir
    Custom installation directory (default: $HOME\glitch-ai)

.PARAMETER NoLaunch
    Skip the launch prompt after installation.

.PARAMETER Help
    Show this help message.

.EXAMPLE
    irm https://raw.githubusercontent.com/Cothek/glitch-ai/main/scripts/install.ps1 | iex

.EXAMPLE
    irm https://raw.githubusercontent.com/Cothek/glitch-ai/main/scripts/install.ps1 | iex -InstallDir "D:\glitch-ai"

.EXAMPLE
    irm https://raw.githubusercontent.com/Cothek/glitch-ai/main/scripts/install.ps1 | iex -NoLaunch
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$InstallDir = "$HOME\glitch-ai",

    [Parameter(Mandatory=$false)]
    [switch]$NoLaunch,

    [Parameter(Mandatory=$false)]
    [switch]$Help
)

# Color output helpers
function Write-Header { param([string]$msg) Write-Host "`n$msg" -ForegroundColor Magenta }
function Write-Step   { param([string]$msg) Write-Host "  $msg" -ForegroundColor Cyan }
function Write-Success{ param([string]$msg) Write-Host "  $msg" -ForegroundColor Green }
function Write-Warn   { param([string]$msg) Write-Host "  $msg" -ForegroundColor Yellow }
function Write-Error  { param([string]$msg) Write-Host "  $msg" -ForegroundColor Red }
function Write-Prompt { param([string]$msg) Write-Host "  $msg" -NoNewline -ForegroundColor Cyan }

# Show help
if ($Help) {
    Write-Host @"
Glitch AI Installer for Windows

Usage:
  irm https://raw.githubusercontent.com/Cothek/glitch-ai/main/scripts/install.ps1 | iex [-InstallDir <path>] [-NoLaunch] [-Help]

Parameters:
  -InstallDir <path>   Custom install directory (default: $HOME\glitch-ai)
  -NoLaunch            Skip launch prompt after installation
  -Help                Show this help

Prerequisites:
  - Git (auto-downloaded if missing -- portable MinGit ~40 MB)
  - Internet connection
  - PowerShell 5.1+ (built into Windows 10/11)

Node.js is NOT required - the bootstrap script downloads a portable Node.js bundle.
"@
    exit 0
}

# Banner
Write-Host @"
╔═══════════════════════════════════════════════════════════════════════════════╗
║                         GLITCH AI INSTALLER (Windows)                        ║
║                    Personal AI Companion - Persistent Memory                 ║
╚══════════════════════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Magenta

# 1. Check PowerShell version
Write-Header "Checking prerequisites..."
$psVersion = $PSVersionTable.PSVersion.Major
if ($psVersion -lt 5) {
    Write-Error "PowerShell 5.1+ required. Current: $($PSVersionTable.PSVersion)"
    Write-Error "Upgrade: https://github.com/PowerShell/PowerShell/releases"
    exit 1
}
Write-Success "PowerShell $($PSVersionTable.PSVersion) OK"

# 2. Choose install location
Write-Header "Installation location"
if (-not $PSBoundParameters.ContainsKey('InstallDir')) {
    Write-Host "  Where should Glitch AI be installed?" -ForegroundColor White
    Write-Host ""
    Write-Host "  [1] Current directory: $(Get-Location)" -ForegroundColor White
    Write-Host "  [2] User home directory: $HOME\glitch-ai (default)" -ForegroundColor White
    Write-Host "  [3] Custom path" -ForegroundColor White
    Write-Host ""
    Write-Prompt "  Choose (Enter=2): "
    $locChoice = Read-Host
    switch ($locChoice) {
        '1' { $InstallDir = Join-Path (Get-Location).Path "glitch-ai" }
        '3' {
            $custom = Read-Host "  Enter installation path"
            if (-not [string]::IsNullOrWhiteSpace($custom)) {
                $InstallDir = $custom.Trim()
            }
        }
    }
}
Write-Success "Installation directory: $InstallDir"

# 3. Check git — auto-download portable MinGit if missing
$gitPath = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $gitPath) {
    Write-Warn "Git not found in PATH."
    Write-Step "Downloading MinGit (portable Git for Windows, ~40 MB)..."
    
    $gitToolsDir = Join-Path $env:LOCALAPPDATA "glitch-mingit"
    $gitBin = Join-Path $gitToolsDir "cmd\git.exe"
    
    if (-not (Test-Path $gitBin)) {
        # Try to get latest release URL from GitHub API
        try {
            $apiUrl = "https://api.github.com/repos/git-for-windows/git/releases/latest"
            $release = Invoke-RestMethod -Uri $apiUrl -UseBasicParsing -TimeoutSec 10
            $minGitAsset = $release.assets | Where-Object { $_.name -like "MinGit-*-64-bit.zip" } | Select-Object -First 1
            if ($minGitAsset) {
                $downloadUrl = $minGitAsset.browser_download_url
                Write-Step "  Found: $($minGitAsset.name)"
            } else {
                throw "No MinGit asset found in latest release"
            }
        } catch {
            # Fallback to known good version
            $downloadUrl = "https://github.com/git-for-windows/git/releases/download/v2.47.0.windows.2/MinGit-2.47.0.2-64-bit.zip"
            Write-Step "  Using fixed MinGit 2.47.0.2 (API failed: $($_.Exception.Message))"
        }
        
        $tempZip = Join-Path $env:TEMP "mingit.zip"
        try {
            Write-Step "  Downloading..."
            Invoke-WebRequest -Uri $downloadUrl -OutFile $tempZip -UseBasicParsing -TimeoutSec 120
            
            New-Item -ItemType Directory -Path $gitToolsDir -Force | Out-Null
            Write-Step "  Extracting..."
            Expand-Archive -Path $tempZip -DestinationPath $gitToolsDir -Force
            Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
            
            if (-not (Test-Path $gitBin)) {
                throw "MinGit binary not found after extraction at $gitBin"
            }
            Write-Success "MinGit installed to $gitToolsDir"
        } catch {
            Write-Error "Failed to download MinGit: $_"
            Write-Error "Install Git manually from https://git-scm.com/download/win"
            Write-Error "After installing, restart your terminal and re-run the installer."
            exit 1
        }
    } else {
        Write-Step "MinGit already installed at $gitToolsDir"
    }
    
    # Add MinGit to PATH for current session
    $env:PATH = "$gitToolsDir\cmd;$env:PATH"
    $gitPath = $gitBin
}
Write-Success "Git found: $gitPath"

# 4. Check install directory
Write-Header "Installation directory: $InstallDir"

if (Test-Path "$InstallDir\.git") {
    # Existing git repo — offer update
    Write-Warn "Glitch AI already installed at $InstallDir"
    Write-Prompt "Update to latest version? (Y/n): "
    $update = Read-Host
    if ($update -eq '' -or $update -like 'y*') {
        Write-Step "Pulling latest changes..."
        Push-Location $InstallDir
        $result = git pull --ff-only 2>&1
        $exitCode = $LASTEXITCODE
        Pop-Location
        if ($exitCode -eq 0) {
            Write-Success "Updated to latest version"
        } else {
            Write-Error "Update failed: $result"
            Write-Warn "You may have local changes. Try: cd $InstallDir && git status"
            exit 1
        }
    } else {
        Write-Warn "Skipping update. Using existing installation."
    }
} elseif (Test-Path $InstallDir) {
    # Directory exists but not a git repo — ask what to do
    Write-Warn "Directory '$InstallDir' already exists (not a git repo)."
    Write-Host ""
    Write-Host "  [1] Overwrite (delete and re-clone)" -ForegroundColor White
    Write-Host "  [2] Choose a different directory" -ForegroundColor White
    Write-Host "  [3] Cancel" -ForegroundColor White
    Write-Host ""
    Write-Prompt "  Choose (Enter=3): "
    $overChoice = Read-Host
    switch ($overChoice) {
        '1' {
            Write-Step "Removing existing directory..."
            Remove-Item $InstallDir -Recurse -Force
            Write-Success "Directory cleared."
            # Now fresh clone below
        }
        '2' {
            $newDir = Read-Host "  Enter new installation path"
            if (-not [string]::IsNullOrWhiteSpace($newDir)) {
                $InstallDir = $newDir.Trim()
                Write-Success "Will install to: $InstallDir"
            } else {
                Write-Warn "Installation cancelled."
                exit 0
            }
        }
        default {
            Write-Warn "Installation cancelled."
            exit 0
        }
    }
}

# Fresh install (or after overwrite)
if (-not (Test-Path "$InstallDir\.git")) {
    $parentDir = Split-Path $InstallDir -Parent
    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }
    
    Write-Step "Cloning Glitch AI repository..."
    $result = git clone --recursive https://github.com/Cothek/glitch-ai.git "$InstallDir" 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        Write-Error "Clone failed: $result"
        exit 1
    }
    Write-Success "Repository cloned to $InstallDir"
}

# 4. Run bootstrap
Write-Header "Running bootstrap (downloads Node.js, OpenCode, Handy, etc.)..."
$bootstrapPath = "$InstallDir\scripts\bootstrap.ps1"
if (-not (Test-Path $bootstrapPath)) {
    Write-Error "bootstrap.ps1 not found at $bootstrapPath"
    exit 1
}

Push-Location $InstallDir
Write-Step "Executing bootstrap.ps1..."
& .\scripts\bootstrap.ps1
$bootstrapExit = $LASTEXITCODE
Pop-Location

if ($bootstrapExit -ne 0) {
    Write-Error "Bootstrap failed with exit code $bootstrapExit"
    exit 1
}
Write-Success "Bootstrap completed successfully"

# 5. User profile setup
Write-Header "User Profile Setup"
Write-Host "Glitch AI stores your personal memory, preferences, and projects in a separate Git repo."
Write-Host "This lets you sync your AI companion across machines via GitHub."
Write-Host ""
Write-Prompt "Set up user profile from GitHub? (Y/n): "
$setupProfile = Read-Host
if ($setupProfile -eq '' -or $setupProfile -like 'y*') {
    Write-Prompt "GitHub username (your GitHub handle): "
    $ghUser = Read-Host
    if ($ghUser) {
        Write-Prompt "Repository name (default: glitch-user-$ghUser): "
        $repoName = Read-Host
        if (-not $repoName) { $repoName = "glitch-user-$ghUser" }
        
        $userDir = "$InstallDir\user"
        if (Test-Path "$userDir\.git") {
            Write-Warn "User profile already exists at $userDir"
        } else {
            Write-Step "Initializing user profile..."
            Push-Location $userDir
            git init | Out-Null
            git remote add origin "https://github.com/$ghUser/$repoName.git" 2>&1 | Out-Null
            $pullResult = git pull origin main --allow-unrelated-histories 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Success "User profile pulled from GitHub"
            } else {
                Write-Warn "No existing profile on GitHub (or pull failed). Starting fresh."
                Write-Host "  Your memory will be saved locally and can be pushed later with: .\scripts\sync-user.ps1 -Push"
            }
            Pop-Location
        }
    }
}

# 6. Launch
if (-not $NoLaunch) {
    Write-Header "Launch Glitch AI"
    Write-Prompt "Launch Glitch now? (Y/n): "
    $launch = Read-Host
    if ($launch -eq '' -or $launch -like 'y*') {
        Write-Step "Starting Glitch AI..."
        Push-Location $InstallDir
        # Use Start-Process to launch in a new window (detached)
        $proc = Start-Process -FilePath "node.exe" -ArgumentList "scripts\launch.mjs" -WindowStyle Normal -PassThru
        Write-Success "Glitch AI launched (PID: $($proc.Id))"
        Write-Host ""
        Write-Host "  To launch again later, run:" -ForegroundColor Cyan
        Write-Host "    cd $InstallDir" -ForegroundColor Gray
        Write-Host "    node scripts\launch.mjs" -ForegroundColor Gray
        Pop-Location
    }
}

Write-Header "Installation Complete!"
Write-Host @"
Glitch AI is installed at: $InstallDir

Next steps:
  • Launch:        cd $InstallDir && node scripts\launch.mjs
  • Free mode:     cd $InstallDir && node scripts\launch-free.mjs
  • Local mode:    cd $InstallDir && node scripts\launch-local.mjs
  • Safe mode:     cd $InstallDir && node scripts\launch-safe.mjs
  • Update:        Re-run this installer (it will pull latest)
  • User sync:     .\scripts\sync-user.ps1 -Push  (after making changes)

Documentation: https://github.com/Cothek/glitch-ai
"@ -ForegroundColor Green