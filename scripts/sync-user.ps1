param(
  [switch]$Push = $false,
  [switch]$Pull = $false,
  [switch]$Status = $false,
  [string]$Message = "",
  [switch]$Help = $false
)

<#
.SYNOPSIS
  Sync user memory files between machines via the private glitch-user-troy repo.

.DESCRIPTION
  The user/ directory is a standalone nested git repo (not a submodule of glitch-ai).
  It has its own remote at Cothek/glitch-user-troy. Use this script to
  sync memory files between machines.

  Default (no flags): Shows status (behind/ahead) and prompts for action.

.PARAMETER Push
  Commit any pending changes and push to origin/main.

.PARAMETER Pull
  Pull latest user data from origin/main.

.PARAMETER Status
  Show behind/ahead status only (no changes made).

.PARAMETER Message
  Custom commit message for push mode. Default: "memory: auto-sync [timestamp]"

.PARAMETER Help
  Show this help.

.EXAMPLES
  .\scripts\sync-user.ps1 -Status
  .\scripts\sync-user.ps1 -Push -Message "memory: notes from laptop session"
  .\scripts\sync-user.ps1 -Pull
  .\scripts\sync-user.ps1 -Push -Pull  # full round-trip sync
#>

$RootDir = "E:\Glitch AI\glitch-ai"
$UserDir = Join-Path $RootDir "user"

function Write-Color {
  param([string]$Text, [string]$Color = "White")
  Write-Host $Text -ForegroundColor $Color
}

function Show-Help {
  Get-Content $PSCommandPath | Select-String -Pattern "^# " | ForEach-Object { $_.Line -replace "^# ", "" }
  exit 0
}

if ($Help) { Show-Help }

# --- Validate user/ is a git repo ---
if (-not (Test-Path (Join-Path $UserDir ".git"))) {
  Write-Color "ERROR: user/ is not a git repository. No .git directory found." "Red"
  Write-Color "Run: cd user && git init && git remote add origin <url> && git add -A && git commit -m 'init'" "Yellow"
  exit 1
}

Push-Location $UserDir

try {
  # --- Check remote ---
  $remoteUrl = & "git" "remote" "get-url" "origin" 2>$null
  if (-not $remoteUrl) {
    Write-Color "ERROR: No 'origin' remote configured in user/" "Red"
    Write-Color "Run: cd user && git remote add origin <url>" "Yellow"
    exit 1
  }

  # --- Fetch to get latest remote state ---
  Write-Color "Fetching from origin..." "Gray"
  $null = & "git" "fetch" "origin" "main" 2>&1

  # --- Status: behind / ahead ---
  $behindRaw = & "git" "rev-list" "--count" "HEAD..origin/main" 2>&1
  $aheadRaw = & "git" "rev-list" "--count" "origin/main..HEAD" 2>&1
  $behind = 0; $ahead = 0
  if ($behindRaw -match '^\d+$') { $behind = [int]$behindRaw.Trim() }
  if ($aheadRaw -match '^\d+$') { $ahead = [int]$aheadRaw.Trim() }

  # --- Check for dirty files ---
  $dirtyRaw = & "git" "status" "--porcelain" 2>&1
  $dirty = ($dirtyRaw | Where-Object { $_ -match '.' }).Count

  Write-Color ("=" * 60) "White"
  Write-Color "  GLITCH USER MEMORY SYNC" "White"
  Write-Color "  Remote: $remoteUrl" "Gray"
  Write-Color ("=" * 60) "White"
  Write-Color "  Local branch: main" "White"
  if ($dirty -gt 0) {
    Write-Color ("  Uncommitted changes: $dirty file(s)") "Yellow"
  } else {
    Write-Color "  Uncommitted changes: none" "Green"
  }
  Write-Color ("  Ahead of origin: $ahead commit(s)") $(if ($ahead -gt 0) {"Yellow"} else {"Green"})
  Write-Color ("  Behind origin: $behind commit(s)") $(if ($behind -gt 0) {"Yellow"} else {"Green"})
  Write-Color ("=" * 60) "White"

  # --- Decide action ---
  $doPush = $Push -or (-not $Pull -and -not $Status)
  $doPull = $Pull -or (-not $Push -and -not $Status)
  $statusOnly = $Status -or (-not $Push -and -not $Pull)

  if ($statusOnly) {
    # Status-only mode: show what to do
    if ($dirty -gt 0 -or $ahead -gt 0) {
      Write-Color "  Run: .\scripts\sync-user.ps1 -Push  (to push changes)" "Cyan"
    }
    if ($behind -gt 0) {
      Write-Color "  Run: .\scripts\sync-user.ps1 -Pull  (to pull latest)" "Cyan"
    }
    if ($dirty -eq 0 -and $ahead -eq 0 -and $behind -eq 0) {
      Write-Color "  Everything is in sync." "Green"
    }
    Write-Color ""
    Write-Color "  .\scripts\sync-user.ps1 (no flags) = interactive mode" "Gray"
    Write-Color "  .\scripts\sync-user.ps1 -Push -Pull  = full round-trip" "Gray"
    exit 0
  }

  # --- Push mode ---
  if ($doPush -and ($dirty -gt 0 -or $ahead -gt 0)) {
    if ($dirty -gt 0) {
      $commitMsg = if ($Message) { $Message } else { "memory: auto-sync $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
      Write-Color "Committing $dirty file(s)..." "Cyan"
      $null = & "git" "add" "-A" 2>&1
      $null = & "git" "commit" "-m" $commitMsg 2>&1
      Write-Color "  Done." "Green"
    }

    Write-Color "Pushing to origin/main..." "Cyan"
    $pushResult = & "git" "push" "origin" "main" 2>&1
    if ($LASTEXITCODE -eq 0) {
      Write-Color "  Done." "Green"
    } else {
      Write-Color "  PUSH FAILED: $pushResult" "Red"
      Write-Color "  Check your network and GitHub credentials." "Yellow"
    }
  } elseif ($doPush) {
    Write-Color "Nothing to push. Working tree is clean and up to date." "Green"
  }

  # --- Pull mode ---
  if ($doPull -and $behind -gt 0) {
    Write-Color "Pulling from origin/main..." "Cyan"
    $pullResult = & "git" "pull" "origin" "main" 2>&1
    if ($LASTEXITCODE -eq 0) {
      $newHead = & "git" "rev-parse" "--short" "HEAD" 2>$null
      Write-Color "  Done. HEAD is now $newHead" "Green"
    } else {
      Write-Color "  PULL FAILED: $pullResult" "Red"
      Write-Color "  You may have conflicting local changes." "Yellow"
    }
  } elseif ($doPull) {
    Write-Color "Already up to date with origin/main." "Green"
  }

  # --- Final summary ---
  $newBehind = & "git" "rev-list" "--count" "HEAD..origin/main" 2>$null
  if ($newBehind -match '^\d+$' -and [int]$newBehind -eq 0) {
    Write-Color "Result: In sync with origin/main." "Green"
  } else {
    Write-Color "Result: $newBehind commit(s) behind origin/main remaining." "Yellow"
  }

} catch {
  Write-Color "ERROR: $_" "Red"
  exit 1
} finally {
  Pop-Location
}
