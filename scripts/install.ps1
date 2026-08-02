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

.PARAMETER UserRepo
    GitHub user repo URL for profile sync (e.g. https://github.com/user/repo.git).
    When provided, skips the interactive sync prompt and uses this repo directly.

.EXAMPLE
    irm https://raw.githubusercontent.com/Cothek/glitch-ai/main/scripts/install.ps1 | iex

.EXAMPLE
    irm https://raw.githubusercontent.com/Cothek/glitch-ai/main/scripts/install.ps1 | iex -InstallDir "D:\glitch-ai"

.EXAMPLE
    irm https://raw.githubusercontent.com/Cothek/glitch-ai/main/scripts/install.ps1 | iex -NoLaunch

.EXAMPLE
    irm https://raw.githubusercontent.com/Cothek/glitch-ai/develop/scripts/install.ps1 -OutFile "$env:TEMP\glitch-install.ps1"; powershell -ExecutionPolicy Bypass -File "$env:TEMP\glitch-install.ps1" -Branch develop

.EXAMPLE
    irm https://raw.githubusercontent.com/Cothek/glitch-ai/main/scripts/install.ps1 | iex -UserRepo "https://github.com/Cothek/glitch-user-cothek.git"
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$InstallDir = "$HOME\glitch-ai",

    [Parameter(Mandatory=$false)]
    [switch]$NoLaunch,

    [Parameter(Mandatory=$false)]
    [switch]$Help,

    [Parameter(Mandatory=$false)]
    [string]$Branch = "main",

    [Parameter(Mandatory=$false)]
    [string]$UserRepo
)

# Set up logging - captures all output to a file for diagnosis
# Log always goes in the install directory (created after clone)
$script:LogFile = $null
try {
    # For fresh installs, create the directory early so logging works
    if (-not (Test-Path $InstallDir)) {
        $parentDir = Split-Path $InstallDir -Parent
        if (-not (Test-Path $parentDir)) {
            New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
        }
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }
    $script:LogFile = Join-Path $InstallDir "install.log"
    Start-Transcript -Path $script:LogFile -Append | Out-Null
    Write-Host "  Logging to: $script:LogFile" -ForegroundColor DarkGray
} catch {
    # If transcript fails, try temp as fallback
    try {
        $fallbackLog = Join-Path $env:TEMP "glitch-install.log"
        Start-Transcript -Path $fallbackLog -Append | Out-Null
        $script:LogFile = $fallbackLog
        Write-Host "  Logging to: $fallbackLog (install dir not available)" -ForegroundColor DarkGray
    } catch {
        Write-Host "  (Could not start logging)" -ForegroundColor DarkGray
    }
}

# Catch all unhandled errors and log them
$ErrorActionPreference = "Stop"
trap {
    Write-Host "`n  FATAL ERROR: $_" -ForegroundColor Red
    Write-Host "  Log file: $script:LogFile" -ForegroundColor Yellow
    Write-Host "  Please share this log file when reporting the issue." -ForegroundColor Yellow
    try { Stop-Transcript | Out-Null } catch {}
    return
}

# Color output helpers
function Write-Header { param([string]$msg) Write-Host "`n$msg" -ForegroundColor Magenta }
function Write-Step   { param([string]$msg) Write-Host "  $msg" -ForegroundColor Cyan }
function Write-Success{ param([string]$msg) Write-Host "  $msg" -ForegroundColor Green }
function Write-Warn   { param([string]$msg) Write-Host "  $msg" -ForegroundColor Yellow }
function Write-Error  { param([string]$msg) Write-Host "  $msg" -ForegroundColor Red }
function Write-Prompt { param([string]$msg) Write-Host "  $msg" -NoNewline -ForegroundColor Cyan }

# -- Spinner helper for long operations --
# Shows a rotating spinner + elapsed seconds while a background job runs.
# Use $using:varName inside the scriptblock to pass parent variables.
function Invoke-WithSpinner {
  param([string]$Label, [scriptblock]$ScriptBlock, [string]$DoneMessage = "")
  
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $job = Start-Job -ScriptBlock $ScriptBlock 2>$null
  
  $chars = '-\|/'
  $i = 0
  while ($job.State -eq 'Running') {
    $elapsed = $sw.Elapsed.TotalSeconds.ToString('F0')
    Write-Host "`r  $Label $($chars[$($i % 4)]) ($($elapsed)s)" -NoNewline
    Start-Sleep -Milliseconds 200
    $i++
  }
  
  $sw.Stop()
  Write-Host ("`r" + " " * 60 + "`r") -NoNewline
  
  if ($job.State -eq 'Failed') {
    $reason = $job.ChildJobs[0].JobStateInfo.Reason
    $err = if ($reason -ne $null) { $reason.Message } else { $job.ChildJobs[0].Error[0].Exception.Message }
    $null = Receive-Job $job -Wait -AutoRemoveJob 2>$null
    Write-Host "  $Label FAILED" -ForegroundColor Red
    throw $err
  }
  
  $null = Receive-Job $job -Wait -AutoRemoveJob 2>$null
  
  if ($DoneMessage -ne "") {
    Write-Host "  $DoneMessage done! ($($sw.Elapsed.TotalSeconds.ToString('F1'))s)"
  }
}

# Show help
if ($Help) {
    Write-Host @"
Glitch AI Installer for Windows

Usage:
  irm https://raw.githubusercontent.com/Cothek/glitch-ai/main/scripts/install.ps1 | iex [-InstallDir <path>] [-NoLaunch] [-Help] [-UserRepo <url>]

Parameters:
  -InstallDir <path>   Custom install directory (default: $HOME\glitch-ai)
  -NoLaunch            Skip launch prompt after installation
  -Help                Show this help
  -UserRepo <url>      GitHub user repo URL for profile sync (e.g. https://github.com/user/repo.git)

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
+=============================================================================+
|                         GLITCH AI INSTALLER (Windows)                        |
|                    Personal AI Companion - Persistent Memory                 |
+=============================================================================+
"@ -ForegroundColor Magenta

# 1. Check PowerShell version
Write-Header "Checking prerequisites..."
$psVersion = $PSVersionTable.PSVersion.Major
if ($psVersion -lt 5) {
    Write-Error "PowerShell 5.1+ required. Current: $($PSVersionTable.PSVersion)"
    Write-Error "Upgrade: https://github.com/PowerShell/PowerShell/releases"
    throw "Installation failed"
}
Write-Success "PowerShell $($PSVersionTable.PSVersion) OK"

# 2. Choose install location
Write-Header "Installation location"
if (-not $PSBoundParameters.ContainsKey('InstallDir')) {
    Write-Host "  Where should Glitch AI be installed?" -ForegroundColor White
    Write-Host ""
    Write-Host "  [1] Current directory: $(Join-Path (Get-Location).Path "glitch-ai")" -ForegroundColor White
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

# Move log file to the actual installation directory (if different from default)
if ($script:LogFile) {
    $targetLogFile = Join-Path $InstallDir "install.log"
    if ($script:LogFile -ne $targetLogFile) {
        try {
            Stop-Transcript | Out-Null
        } catch {}
        try {
            if (-not (Test-Path $InstallDir)) {
                $parentDir = Split-Path $InstallDir -Parent
                if (-not (Test-Path $parentDir)) {
                    New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
                }
                New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
            }
            if (Test-Path $script:LogFile) {
                Move-Item -Path $script:LogFile -Destination $targetLogFile -Force
            }
            $script:LogFile = $targetLogFile
            Start-Transcript -Path $script:LogFile -Append | Out-Null
        } catch {
            # Keep logging to the original location
        }
    }
}

# 3. Check git -- auto-download portable MinGit if missing
$gitPath = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $gitPath) {
    Write-Warn "Git not found in PATH."
    Write-Step "Downloading MinGit (portable Git for Windows, ~40 MB)..."
    
    $gitToolsDir = Join-Path $InstallDir "data\mingit"
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
        
        $downloadsDir = Join-Path $InstallDir "data\downloads"
        New-Item -ItemType Directory -Force -Path $downloadsDir | Out-Null
        $tempZip = Join-Path $downloadsDir "mingit.zip"
        try {
            Invoke-WithSpinner -Label "Downloading MinGit (40MB)" -DoneMessage "MinGit" -ScriptBlock {
              Invoke-WebRequest -Uri $using:downloadUrl -OutFile $using:tempZip -UseBasicParsing -TimeoutSec 120
            }
            
            New-Item -ItemType Directory -Path $gitToolsDir -Force | Out-Null
            Invoke-WithSpinner -Label "Extracting MinGit" -DoneMessage "MinGit" -ScriptBlock {
              Expand-Archive -Path $using:tempZip -DestinationPath $using:gitToolsDir -Force
            }
            Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
            
            if (-not (Test-Path $gitBin)) {
                throw "MinGit binary not found after extraction at $gitBin"
            }
            Write-Success "MinGit installed to $gitToolsDir"
        } catch {
            Write-Error "Failed to download MinGit: $_"
            Write-Error "Install Git manually from https://git-scm.com/download/win"
            Write-Error "After installing, restart your terminal and re-run the installer."
            throw "Installation failed"
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
    # Existing git repo -- offer update
    Write-Warn "Glitch AI already installed at $InstallDir"
    Write-Prompt "Update to latest version? (Y/n): "
    $update = Read-Host
    if ($update -eq '' -or $update -like 'y*') {
        Write-Step "Pulling latest changes..."
        Push-Location $InstallDir
        try {
            $prevEAP = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            $result = git pull --ff-only 2>&1
            $exitCode = $LASTEXITCODE
            $ErrorActionPreference = $prevEAP
            Pop-Location
            if ($exitCode -eq 0) {
                Write-Success "Updated to latest version"
            } else {
                Write-Error "Update failed: $($result -join "`n")"
                Write-Warn "You may have local changes. Try: cd $InstallDir && git status"
                throw "Installation failed"
            }
        } catch {
            $ErrorActionPreference = $prevEAP
            Pop-Location -ErrorAction SilentlyContinue
            Write-Error "Update failed: $_"
            Write-Warn "You may have local changes. Try: cd $InstallDir && git status"
            throw "Installation failed"
        }
    } else {
        Write-Warn "Skipping update. Using existing installation."
    }
} elseif (Test-Path $InstallDir) {
    # Check if directory has actual content (not just our log file)
    $dirHasContent = (Get-ChildItem $InstallDir -Force | Where-Object { $_.Name -ne "install.log" }).Count -gt 0
    if (-not $dirHasContent) {
        # Empty or only has our log file - delete so clone can create it fresh
        Write-Step "Directory exists but is empty. Proceeding with fresh install..."
        # Stop transcript so install.log isn't locked during delete
        try { Stop-Transcript | Out-Null } catch {}
        Remove-Item $InstallDir -Recurse -Force
        Write-Success "Directory cleared."
    } else {
        # Directory exists and has actual content -- ask what to do
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
                # Stop transcript so install.log isn't locked during delete
                try { Stop-Transcript | Out-Null } catch {}
                Remove-Item $InstallDir -Recurse -Force
                Write-Success "Directory cleared."
                # Now fresh clone below
            }
            '2' {
                $newDir = Read-Host "  Enter new installation path"
                if (-not [string]::IsNullOrWhiteSpace($newDir)) {
                    $InstallDir = $newDir.Trim()
                    # Restart transcript in new location
                    try { Stop-Transcript | Out-Null } catch {}
                    try {
                        if (-not (Test-Path $InstallDir)) {
                            New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
                        }
                        $script:LogFile = Join-Path $InstallDir "install.log"
                        Start-Transcript -Path $script:LogFile -Append | Out-Null
                    } catch {
                        $fallbackLog = Join-Path $env:TEMP "glitch-install.log"
                        Start-Transcript -Path $fallbackLog -Append | Out-Null
                        $script:LogFile = $fallbackLog
                    }
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
}

# Fresh install (or after overwrite)
if (-not (Test-Path "$InstallDir\.git")) {
    $parentDir = Split-Path $InstallDir -Parent
    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }

    # Track submodule status for end-of-install summary
    $script:SubmoduleSuccess = @()
    $script:SubmoduleFailures = @()
    $script:CloneSucceeded = $false

    # Ensure transcript is active for clone (may have been stopped for overwrite)
    try {
        $null = Get-Content $script:LogFile -ErrorAction Stop
    } catch {
        $tempLog = Join-Path $env:TEMP "glitch-install.log"
        Start-Transcript -Path $tempLog -Append | Out-Null
        $script:LogFile = $tempLog
        Write-Host "  Logging to: $tempLog (temp)" -ForegroundColor DarkGray
    }

    try {
      Invoke-WithSpinner -Label "Cloning Glitch AI repository" -DoneMessage "Repository" -ScriptBlock {
        $r = & $using:gitPath clone https://github.com/Cothek/glitch-ai.git "$using:InstallDir" 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Clone failed (exit $LASTEXITCODE)`n$r" }
        $script:CloneSucceeded = $true
      }
      Write-Success "Repository cloned to $InstallDir"
    } catch {
      Write-Error "Clone failed: $_"
      throw "Installation failed"
    }
    if ($Branch -ne "main") {
        Write-Step "Checking out branch: $Branch..."
        Push-Location $InstallDir
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        & $gitPath checkout $Branch 2>$null
        $ErrorActionPreference = $prevEAP
        Pop-Location
    }

    # Initialize submodules individually so one failure doesn't block the others
    if ($script:CloneSucceeded) {
        Push-Location $InstallDir
        try {
            $initOutput = & $gitPath submodule init 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Warn "git submodule init returned non-zero (continuing): $initOutput"
            }
        } catch {
            Write-Warn "git submodule init failed (continuing): $_"
        }

        # Read submodule list from .gitmodules
        $rawLines = git config --file .gitmodules --get-regexp path 2>&1
        $submodules = @()
        foreach ($line in $rawLines) {
            if ($line -match 'submodule\..+\.path\s+(.+)') {
                $submodules += $matches[1].Trim()
            }
        }

        # Initialize each submodule individually so one failure doesn't block the others
        if ($submodules.Count -eq 0) {
            Write-Warn "No submodules found in .gitmodules"
        } else {
            $issueFile = Join-Path $InstallDir "data\install-issues.md"
            $issueDir = Split-Path -Parent $issueFile
            if (-not (Test-Path $issueDir)) {
                New-Item -ItemType Directory -Path $issueDir -Force | Out-Null
            }

            foreach ($submodule in $submodules) {
                Write-Step "Updating submodule: $submodule"
                $subOutput = & $gitPath submodule update --init $submodule 2>&1
                if ($LASTEXITCODE -eq 0) {
                    Write-Success "  ${submodule}: OK"
                    $script:SubmoduleSuccess += $submodule
                } else {
                    Write-Warn "  ${submodule}: FAILED"
                    $subOutput | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkYellow }
                    $script:SubmoduleFailures += $submodule

                    # Log to install-issues.md (same format as install.sh, parseable by check-install-issues.mjs)
                    # NOTE: Use AppendAllText with UTF8Encoding($false) to write UTF-8 WITHOUT BOM.
                    # Out-File -Encoding utf8 on PowerShell 5.1 writes a BOM (EF BB BF), which breaks
                    # check-install-issues.mjs (it reads with readFileSync('utf8') and anchors ^## with /m).
                    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
                    $issueContent = @"

## Install Issue - $timestamp
- **Subsystem**: Submodule clone
- **Component**: $submodule
- **Error**:
````
$subOutput
````
- **Impact**: Some memory/skill files may be missing until resolved
- **Fix**: Tell Glitch "check install issues" or run: cd $InstallDir && git submodule update --init --recursive

"@
                    [System.IO.File]::AppendAllText($issueFile, $issueContent, [System.Text.UTF8Encoding]::new($false))
                }
            }

            Write-Host ""
            if ($script:SubmoduleFailures.Count -eq 0) {
                Write-Success "All submodules initialized successfully"
            } else {
                Write-Warn "Some submodules failed to clone (see above)"
                Write-Warn "Issues logged to: $issueFile"
                Write-Warn "Glitch will attempt to fix these on first launch."
            }
        }
    }
}

# 4. Run bootstrap
Write-Header "Running bootstrap (downloads Node.js, OpenCode, Handy, etc.)..."
$bootstrapPath = "$InstallDir\scripts\bootstrap.ps1"
if (-not (Test-Path $bootstrapPath)) {
    Write-Error "bootstrap.ps1 not found at $bootstrapPath"
    throw "Installation failed"
}

Push-Location $InstallDir
Write-Step "Executing bootstrap.ps1..."
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\bootstrap.ps1"
$bootstrapExit = $LASTEXITCODE
Pop-Location

if ($bootstrapExit -ne 0) {
    Write-Error "Bootstrap failed with exit code $bootstrapExit"
    throw "Installation failed"
}
Write-Success "Bootstrap completed successfully"

# 5. User profile setup
Write-Header "User Profile Setup"

$userDir = "$InstallDir\user"
$userProfileExists = Test-Path "$userDir\main-memory.md"

# First: check if they have an existing GitHub profile to clone
$ghUser = $null
$repoName = $null
$cloneAttempted = $false

if ($UserRepo) {
    $parsed = $UserRepo -replace 'https?://github\.com/', '' -replace '\.git$', ''
    $parts = $parsed -split '/'
    if ($parts.Count -eq 2) {
        $ghUser = $parts[0]
        $repoName = $parts[1]
        $cloneAttempted = $true
        Write-Host "  Using specified user repo: $ghUser/$repoName" -ForegroundColor Cyan
    } else {
        Write-Warn "Could not parse UserRepo URL: $UserRepo"
    }
} else {
    # Always ask about GitHub profile connection
    Write-Host ""
    Write-Host "Do you have an existing Glitch user profile on GitHub?" -ForegroundColor White
    Write-Host "  (If not, you can set this up later inside Glitch.)" -ForegroundColor DarkGray
    Write-Host ""
    Write-Prompt "Connect existing profile from GitHub? (y/N): "
    $syncProfile = Read-Host
    if ($syncProfile -like 'y*') {
        Write-Prompt "GitHub username: "
        $ghUser = Read-Host
        if ($ghUser) {
            Write-Prompt "Repository name (default: glitch-user-$ghUser): "
            $repoName = Read-Host
            if (-not $repoName) { $repoName = "glitch-user-$ghUser" }
            $cloneAttempted = $true
        }
    }
}

# Try to clone existing profile if requested
if ($cloneAttempted -and $ghUser -and $repoName) {
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        Write-Step "Connecting to $ghUser/$repoName..."

        # Clear user dir for clean clone
        if (Test-Path $userDir) {
            Remove-Item "$userDir\*" -Recurse -Force -ErrorAction SilentlyContinue
        }
        if (-not (Test-Path $userDir)) {
            New-Item -ItemType Directory -Path $userDir -Force | Out-Null
        }

        # Clone straight into user dir
        # GCM should handle auth with a browser popup
        $cloneOutput = git clone "https://github.com/$ghUser/$repoName.git" "$userDir" 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Profile downloaded from GitHub"
        } else {
            # Clone failed - offer PAT as fallback
            Write-Warn "  Could not access $ghUser/$repoName."
            Write-Host ""
            Write-Host "  The repository may be private or require authentication." -ForegroundColor Yellow
            Write-Host "  Git Credential Manager was installed earlier in this setup." -ForegroundColor Yellow
            Write-Host "  A browser window should open for you to log into GitHub." -ForegroundColor Yellow
            Write-Host "  If that didn't work, you can use a Personal Access Token." -ForegroundColor Yellow
            Write-Host ""
            Write-Prompt "  Enter GitHub Personal Access Token (or press Enter to skip): "
            $ghToken = Read-Host
            if ($ghToken) {
                # Clean failed clone first
                Remove-Item "$userDir\*" -Recurse -Force -ErrorAction SilentlyContinue
                git clone "https://$ghUser`:$ghToken@github.com/$ghUser/$repoName.git" "$userDir" 2>&1
                if ($LASTEXITCODE -eq 0) {
                    Write-Success "Profile downloaded from GitHub"
                } else {
                    Write-Warn "  Still could not connect."
                    $cloneAttempted = $false
                }
            } else {
                $cloneAttempted = $false
            }
        }
    } catch {
        Write-Warn "  Profile connection failed: $_"
        $cloneAttempted = $false
    } finally {
        $ErrorActionPreference = $prevEAP
    }
}

# If no clone was attempted or it failed, create local starter files
if (-not $cloneAttempted -or -not (Test-Path "$userDir\main-memory.md")) {
    if (-not (Test-Path $userDir)) {
        New-Item -ItemType Directory -Path $userDir -Force | Out-Null
    }

    $needsStarter = -not (Test-Path "$userDir\main-memory.md")
    if ($needsStarter) {
        Write-Step "Creating local user profile..."

        $starterMemory = @"
---
type: UserProfile
title: Main Memory
description: Your personal profile and preferences
tags: [user, profile]
timestamp: $(Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
---
# Main Memory
## User Profile
*To be filled in through interaction with Glitch*
"@
        Set-Content -LiteralPath "$userDir\main-memory.md" -Value $starterMemory -Encoding UTF8

        $starterSession = @"
---
type: SessionMemory
title: Current Session Memory
tags: [session, ram]
timestamp: $(Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
---
# Current Session Memory
## Session Recap
*First session with Glitch*
"@
        Set-Content -LiteralPath "$userDir\current-session.md" -Value $starterSession -Encoding UTF8

        $starterReminders = @"
---
type: ReminderLog
title: Reminders
description: Cross-session reminders
tags: [reminders]
timestamp: $(Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
---
# Reminders
"@
        Set-Content -LiteralPath "$userDir\reminders.md" -Value $starterReminders -Encoding UTF8

        Write-Success "User profile created at $userDir"
    } else {
        Write-Success "User profile already exists at $userDir"
    }
}

# Show next steps for GitHub sync
if ($cloneAttempted -and -not (Test-Path "$userDir\.git")) {
    Write-Host ""
    Write-Host "  To connect your profile to GitHub later, start Glitch and say:" -ForegroundColor Cyan
    Write-Host '    "Connect my user profile to GitHub"' -ForegroundColor Yellow
    Write-Host ""
} elseif (-not $cloneAttempted) {
    Write-Host ""
    Write-Host "  Profile is local-only. To sync with GitHub later, start Glitch and say:" -ForegroundColor Cyan
    Write-Host '    "Connect my user profile to GitHub"' -ForegroundColor Yellow
    Write-Host ""
}

# 6. Verify installation
Write-Header "Verifying installation..."
Push-Location $InstallDir
$checkNode = if (Test-Path "$InstallDir\data\node\node.exe") { "$InstallDir\data\node\node.exe" } else { "node" }
Write-Step "Running install verification..."
& $checkNode scripts/check-install.mjs 2>&1 | Write-Host
$checkExit = $LASTEXITCODE
Pop-Location

if ($checkExit -ne 0) {
    Write-Warn "Some checks did not pass. Review the report above for details."
    Write-Warn "Items marked with [X] under 'Core' indicate critical issues."
}

# 7. Launch
if (-not $NoLaunch) {
    Write-Header "Launch Glitch AI"
    Write-Prompt "Launch Glitch now? (Y/n): "
    $launch = Read-Host
    if ($launch -eq '' -or $launch -like 'y*') {
        Write-Step "Starting Glitch AI..."
        Push-Location $InstallDir
        # Use Start-Process to launch in a new window (detached)
        $proc = Start-Process -FilePath "launch-glitch.bat" -WindowStyle Normal -PassThru
        Write-Success "Glitch AI launched (PID: $($proc.Id))"
        Write-Host ""
        Write-Host "  To launch again later, run:" -ForegroundColor Cyan
        Write-Host "    cd $InstallDir" -ForegroundColor Gray
        Write-Host "    .\launch-glitch.bat" -ForegroundColor Gray
        Pop-Location
    }
}

# Summary of any install issues (shown only if something failed)
if ($script:SubmoduleFailures.Count -gt 0) {
    Write-Host ""
    Write-Host "  WARNING: Some components couldn't be downloaded during install." -ForegroundColor Yellow
    Write-Host "    Issues logged to: $InstallDir\data\install-issues.md" -ForegroundColor Yellow
    Write-Host "    Glitch will review and attempt to fix these on first launch." -ForegroundColor Yellow
    Write-Host "    Manual fix: cd $InstallDir && git submodule update --init --recursive" -ForegroundColor Yellow
    Write-Host ""
}

Write-Header "Installation Complete!"
Write-Host @"
Glitch AI is installed at: $InstallDir

Next steps:
  * Launch:        cd $InstallDir && .\launch-glitch.bat
  * Free mode:     cd $InstallDir && .\launch-glitch.bat (select Free at prompt)
  * Local mode:    cd $InstallDir && .\launch-glitch.bat (select Local at prompt)
  * Safe mode:     cd $InstallDir && .\launch-glitch.bat (select Safe at prompt)
  * Update:        Re-run this installer (it will pull latest)
  * User sync:     .\scripts\sync-user.ps1 -Push  (after making changes)

Documentation: https://github.com/Cothek/glitch-ai
"@ -ForegroundColor Green

# Stop logging
try { Stop-Transcript | Out-Null } catch {}