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
    exit 1
}

# Color output helpers
function Write-Header { param([string]$msg) Write-Host "`n$msg" -ForegroundColor Magenta }
function Write-Step   { param([string]$msg) Write-Host "  $msg" -ForegroundColor Cyan }
function Write-Success{ param([string]$msg) Write-Host "  $msg" -ForegroundColor Green }
function Write-Warn   { param([string]$msg) Write-Host "  $msg" -ForegroundColor Yellow }
function Write-Error  { param([string]$msg) Write-Host "  $msg" -ForegroundColor Red }
function Write-Prompt { param([string]$msg) Write-Host "  $msg" -NoNewline -ForegroundColor Cyan }

# ── Spinner helper for long operations ──
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

    # Track submodule status for end-of-install summary
    $script:SubmoduleSuccess = @()
    $script:SubmoduleFailures = @()
    $script:CloneSucceeded = $false

    try {
      Invoke-WithSpinner -Label "Cloning Glitch AI repository" -DoneMessage "Repository" -ScriptBlock {
        # Clone WITHOUT --recursive so submodule failures don't kill the install
        $r = git clone https://github.com/Cothek/glitch-ai.git "$using:InstallDir" 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Clone failed (exit $LASTEXITCODE)`n$r" }
        $script:CloneSucceeded = $true
      }
      Write-Success "Repository cloned to $InstallDir"
    } catch {
      Write-Error "Clone failed: $_"
      exit 1
    }

    # Initialize submodules individually so one failure doesn't block the others
    if ($script:CloneSucceeded) {
        Push-Location $InstallDir
        try {
            # Init submodule paths (registers them in .git/config)
            $initOutput = git submodule init 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Warn "git submodule init returned non-zero (continuing): $initOutput"
            }
        } catch {
            Write-Warn "git submodule init failed (continuing): $_"
        }

        # Read submodule list from .gitmodules (authoritative source)
        $rawLines = git config --file .gitmodules --get-regexp path 2>&1
        $submodules = @()
        foreach ($line in $rawLines) {
            if ($line -match 'submodule\..+\.path\s+(.+)') {
                $submodules += $matches[1].Trim()
            }
        }
        if ($submodules.Count -eq 0) {
            Write-Warn "No submodules found in .gitmodules"
        }
        foreach ($sub in $submodules) {
            try {
                Write-Step "Fetching submodule: $sub"
                $updateOutput = git submodule update --init "$sub" 2>&1
                if ($LASTEXITCODE -ne 0) {
                    throw "git submodule update --init $sub failed (exit $LASTEXITCODE)`n$updateOutput"
                }
                $script:SubmoduleSuccess += $sub
                Write-Success "  $sub ready"
            } catch {
                $script:SubmoduleFailures += @{
                    Name = $sub
                    Error = $_.ToString()
                }
                Write-Warn "  $sub failed (logged to data\install-issues.md)"

                # Log the issue to data/install-issues.md
                try {
                    $issueFile = Join-Path $InstallDir "data\install-issues.md"
                    $issueDir = Split-Path $issueFile -Parent
                    if (-not (Test-Path $issueDir)) {
                        New-Item -ItemType Directory -Path $issueDir -Force | Out-Null
                    }
                    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
                    $cleanError = ($_.ToString() -replace "`r`n", " " -replace "`n", " ") -replace '\s+', ' '
                    $entry = @"

## Install Issue - $timestamp
- **Subsystem**: Submodule clone
- **Component**: $sub
- **Error**: $cleanError
- **Impact**: Some memory/skill files may be missing until resolved
- **Fix**: Tell Glitch "check install issues" or run: cd $InstallDir && git submodule update --init --recursive

"@
                    Add-Content -LiteralPath $issueFile -Value $entry -Encoding UTF8
                } catch {
                    Write-Warn "  Could not write to install-issues.md: $_"
                }
            }
        }
        Pop-Location

        # Show clear status to user
        Write-Host ""
        Write-Step "Submodule status:"
        foreach ($s in $script:SubmoduleSuccess) {
            Write-Success "  [OK]   $s"
        }
        foreach ($f in $script:SubmoduleFailures) {
                Write-Warn "  [WARN] $($f.Name) - see data\install-issues.md"
        }
        if ($script:SubmoduleFailures.Count -gt 0) {
            Write-Step "Glitch will attempt to fix these on first launch."
        }
    }
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

$userDir = "$InstallDir\user"
$userProfileExists = Test-Path "$userDir\main-memory.md"

if (-not $userProfileExists) {
    Write-Step "Creating local user profile..."
    if (-not (Test-Path $userDir)) {
        New-Item -ItemType Directory -Path $userDir -Force | Out-Null
    }
    
    # Create starter files
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

# Optional: Sync with GitHub for cross-machine access
$shouldSync = $false
$ghUser = $null
$repoName = $null

if ($UserRepo) {
    # Parse URL: https://github.com/user/repo.git or user/repo
    $parsed = $UserRepo -replace 'https?://github\.com/', '' -replace '\.git$', ''
    $parts = $parsed -split '/'
    if ($parts.Count -eq 2) {
        $ghUser = $parts[0]
        $repoName = $parts[1]
        $shouldSync = $true
        Write-Host "  Using specified user repo: $ghUser/$repoName" -ForegroundColor Cyan
    } else {
        Write-Warn "Could not parse UserRepo URL: $UserRepo"
        Write-Warn "Expected format: https://github.com/username/repo.git"
    }
} else {
    Write-Host ""
    Write-Host "Glitch AI stores your personal memory in the user/ directory." -ForegroundColor White
    Write-Host "You can optionally sync it to GitHub for cross-machine access." -ForegroundColor White
    Write-Host ""
    Write-Prompt "Sync user profile to GitHub? (y/N): "
    $syncProfile = Read-Host
    if ($syncProfile -like 'y*') {
        $shouldSync = $true
        Write-Prompt "GitHub username: "
        $ghUser = Read-Host
        if ($ghUser) {
            Write-Prompt "Repository name (default: glitch-user-$ghUser): "
            $repoName = Read-Host
            if (-not $repoName) { $repoName = "glitch-user-$ghUser" }
        } else {
            $shouldSync = $false
        }
    }
}

if ($shouldSync -and $ghUser) {
    Push-Location $userDir
    # Check if already a git repo
    if (-not (Test-Path ".git")) {
        git init | Out-Null
        $localBranch = git rev-parse --abbrev-ref HEAD
        git remote add origin "https://github.com/$ghUser/$repoName.git" 2>&1 | Out-Null
    } else {
        $localBranch = git rev-parse --abbrev-ref HEAD
    }
    
    # Try to detect remote's default branch
    $remoteHead = git ls-remote --symref origin HEAD 2>$null
    if ($remoteHead -match 'ref: refs/heads/(\S+)') {
        $defaultBranch = $matches[1]
        if ($localBranch -ne $defaultBranch) {
            git branch -m $defaultBranch 2>&1 | Out-Null
        }
        $pullResult = git pull origin $defaultBranch --allow-unrelated-histories 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Success "User profile synced from GitHub"
            git branch --set-upstream-to="origin/$defaultBranch" $defaultBranch 2>&1 | Out-Null
        } else {
            Write-Warn "No existing profile on GitHub (or pull failed). Starting fresh."
            Write-Host "  Push later with: cd $userDir && git push -u origin $defaultBranch"
        }
    } else {
        Write-Warn "Remote repository not found. Profile is local-only."
        Write-Host "  Push later with: cd $userDir && git push -u origin $localBranch"
    }
    Pop-Location
} elseif (-not $UserRepo) {
    Write-Host "  Profile stays local-only. To sync later:" -ForegroundColor DarkGray
    Write-Host "    cd $userDir && git init && git remote add origin <url> && git push" -ForegroundColor DarkGray
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
    Write-Warn "Items marked with ✗ under 'Core' indicate critical issues."
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
  • Launch:        cd $InstallDir && .\launch-glitch.bat
  • Free mode:     cd $InstallDir && .\launch-glitch.bat (select Free at prompt)
  • Local mode:    cd $InstallDir && .\launch-glitch.bat (select Local at prompt)
  • Safe mode:     cd $InstallDir && .\launch-glitch.bat (select Safe at prompt)
  • Update:        Re-run this installer (it will pull latest)
  • User sync:     .\scripts\sync-user.ps1 -Push  (after making changes)

Documentation: https://github.com/Cothek/glitch-ai
"@ -ForegroundColor Green

# Stop logging
try { Stop-Transcript | Out-Null } catch {}