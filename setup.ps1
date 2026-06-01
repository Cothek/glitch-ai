param(
  [string]$UserName = "",
  [switch]$NewUser = $false
)

$RootDir = Split-Path -Parent $PSCommandPath
$UserBase = "$RootDir\user"
$TemplateDir = "$RootDir\glitch-memorycore\users\_template"

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host " Glitch Setup" -ForegroundColor Magenta
Write-Host ""

# ---- Check prerequisites ----
if (-not (Test-Path $TemplateDir)) {
  Write-Host "  ERROR: Engine template directory not found." -ForegroundColor Red
  Write-Host "  Make sure glitch-memorycore submodule is initialized:" -ForegroundColor Yellow
  Write-Host "    git submodule update --init --recursive" -ForegroundColor Yellow
  exit 1
}

# ---- Create user directory if needed ----
if (-not (Test-Path $UserBase)) {
  New-Item -ItemType Directory -Path $UserBase -Force | Out-Null
  Write-Host "  Created user/ directory" -ForegroundColor Green
}

# ---- Determine user name ----
if (-not $UserName) {
  Write-Host "  No user name provided." -ForegroundColor Yellow
  Write-Host "  Usage: .\setup.ps1 --user <name>  (create or switch to a user profile)" -ForegroundColor Cyan
  Write-Host "  Usage: .\setup.ps1 --new-user     (interactive wizard)" -ForegroundColor Cyan
  Write-Host ""

  # Show existing users
  $existing = Get-ChildItem -Directory $UserBase | Where-Object {
    Test-Path "$($_.FullName)\main-memory.md"
  }
  if ($existing.Count -gt 0) {
    Write-Host "  Existing profiles:" -ForegroundColor Cyan
    foreach ($p in $existing) {
      Write-Host "    $($p.Name)" -ForegroundColor Green
    }
    Write-Host ""
    $UserName = Read-Host "  Enter user name to use (or press Enter for new-user wizard)"
    if (-not $UserName) {
      $NewUser = $true
    }
  } else {
    $NewUser = $true
  }
}

if ($NewUser -or (-not $UserName)) {
  # ---- Interactive setup wizard ----
  Write-Host "  New user setup" -ForegroundColor Cyan
  Write-Host ""

  if (-not $UserName) {
    $UserName = Read-Host "  What's your name? (e.g., 'alice')"
  }
  if (-not $UserName) {
    Write-Host "  ERROR: Name is required." -ForegroundColor Red
    exit 1
  }

  # Sanitize: lowercase, no spaces
  $UserName = $UserName.ToLower().Trim().Replace(' ', '-')

  $UserDir = "$UserBase\$UserName"

  if (Test-Path "$UserDir\main-memory.md") {
    Write-Host "  Profile '$UserName' already exists!" -ForegroundColor Yellow
    Write-Host "  Set `$env:GLITCH_USER=$UserName to use this profile." -ForegroundColor Cyan
    Write-Host "  Or delete user\$UserName to start fresh." -ForegroundColor Gray
    exit 0
  }

  Write-Host ""
  Write-Host "  Setting up profile: $UserName" -ForegroundColor Cyan
  Write-Host ""

  # Create user directory structure
  New-Item -ItemType Directory -Path "$UserDir\daily-diary\current" -Force | Out-Null
  New-Item -ItemType Directory -Path "$UserDir\projects" -Force | Out-Null
  New-Item -ItemType Directory -Path "$UserDir\library" -Force | Out-Null

  # Ask preferences
  $displayName = Read-Host "  What name should Glitch call you? (e.g., '$UserName')"
  if (-not $displayName) { $displayName = $UserName }

  Write-Host ""
  Write-Host "  Creating profile files..." -ForegroundColor Cyan

  # Create main-memory.md from template
  $template = Get-Content "$TemplateDir\main-memory.template.md" -Raw
  $template = $template.Replace('{{USER_NAME}}', $displayName)
  $template = $template.Replace('{{GITHUB_USERNAME}}', $displayName)
  $template = $template.Replace('{{CREATION_DATE}}', (Get-Date -Format "yyyy-MM-dd"))
  $template | Out-File -FilePath "$UserDir\main-memory.md" -Encoding utf8 -Force

  # Create empty session files
  @"
# 🌟 Current Session Memory - RAM
*Temporary working memory*

## Session RAM Status
**Current Session**: New
**Last Activity**: $(Get-Date -Format "yyyy-MM-dd HH:mm")
**Session Focus**: First session
**Context State**: Fresh setup

## 💭 Working Memory (RAM)
### Active Context
- **Current Topic**: New user setup
- **Immediate Goals**: Getting started with Glitch

## Session Recap
*First session — no recap yet*

## 🔌 PROCESS TABLE
*No long-running processes*

---
**Last Memory Update**: $(Get-Date -Format "yyyy-MM-dd HH:mm")
"@ | Out-File -FilePath "$UserDir\current-session.md" -Encoding utf8 -Force

  @"
# 📋 Session Dashboard - $displayName
*Active workstreams with progress tracking*

| Item | Status | Progress | Notes |
|------|--------|----------|-------|

**Last Updated**: $(Get-Date -Format "yyyy-MM-dd")
"@ | Out-File -FilePath "$UserDir\session-dashboard.md" -Encoding utf8 -Force

  @"
# 🔔 Reminders - $displayName
*Persistent cross-session reminders*

## Active Reminders
(none)

## Completed
(none)
"@ | Out-File -FilePath "$UserDir\reminders.md" -Encoding utf8 -Force

  @"
# 📋 Decision Log - $displayName
*Append-only record of non-obvious decisions*

---
*Created: $(Get-Date -Format "yyyy-MM-dd") — Decision Log System installed*
"@ | Out-File -FilePath "$UserDir\decisions.md" -Encoding utf8 -Force

  @"
# 🔥 Post-Mortem Log - $displayName
*Failure learning log — no blame, only lessons*

## Rules
- **No blame** — this is a learning tool, not punishment
- **Append-only** — never rewrite or delete entries
- **Honest** — if it was a mistake, say so plainly
- **Actionable** — every entry must have a Prevention action

---
*Created: $(Get-Date -Format "yyyy-MM-dd") — Post-Mortem System installed*
"@ | Out-File -FilePath "$UserDir\post-mortems.md" -Encoding utf8 -Force

  @"
# 🧠 Patterns & Insights - $displayName
*Abstracted learnings extracted from raw memory*

## How This File Works
This file contains **distilled patterns** — not raw events, but the insights extracted from them.
Updated when a pattern emerges across 2+ events, or during monthly review.

*Created: $(Get-Date -Format "yyyy-MM-dd")*
"@ | Out-File -FilePath "$UserDir\patterns.md" -Encoding utf8 -Force

  @"
# 🔨 Forge Log - $displayName
*Tracking skill creation, automation triggers, and autonomous upgrades*

## Principles
- Repeat 3+ times → propose new skill
- New skill → register in skills-registry.md
- Autonomous creation → note in forge-log.md
"@ | Out-File -FilePath "$UserDir\forge-log.md" -Encoding utf8 -Force

  @"
# 📦 Projects - $displayName
*Active project list with LRU tracking*

| # | Project | Status | Last Active | Duration |
|---|---------|--------|-------------|----------|

**Active limit**: 10 projects
"@ | Out-File -FilePath "$UserDir\projects\project-list.md" -Encoding utf8 -Force

  # Daily diary protocol
  Copy-Item "$TemplateDir\..\..\daily-diary\daily-diary-protocol.md" "$UserDir\daily-diary\" -Force
  Copy-Item "$TemplateDir\..\..\daily-diary\recall-format.md" "$UserDir\daily-diary\" -Force

  Write-Host "  Profile '$UserName' created!" -ForegroundColor Green
  Write-Host ""
  Write-Host "  To use this profile, run:" -ForegroundColor Cyan
  Write-Host "    `$env:GLITCH_USER = '$UserName'" -ForegroundColor Gray
  Write-Host "    .\launch-glitch.bat" -ForegroundColor Gray
  Write-Host ""

} else {
  # ---- Existing user selected ----
  $UserDir = "$UserBase\$UserName"

  if (Test-Path "$UserDir\main-memory.md") {
    Write-Host "  Profile '$UserName' exists." -ForegroundColor Green
    Write-Host "  Set it as active:" -ForegroundColor Cyan
    Write-Host "    `$env:GLITCH_USER = '$UserName'" -ForegroundColor Gray
    Write-Host "    .\launch-glitch.bat" -ForegroundColor Gray
  } else {
    Write-Host "  Profile '$UserName' not found." -ForegroundColor Red
    Write-Host "  Run .\setup.ps1 --new-user to create one." -ForegroundColor Yellow
  }
}

# ---- Offer to set env var permanently ----
$setEnv = Read-Host "  Set GLITCH_USER for future sessions? (y/N)"
if ($setEnv -eq 'y' -or $setEnv -eq 'Y') {
  [Environment]::SetEnvironmentVariable("GLITCH_USER", $UserName, "User")
  Write-Host "  GLITCH_USER set to '$UserName' (persistent)." -ForegroundColor Green
}

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Magenta
