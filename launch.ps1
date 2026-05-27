$RootDir = Split-Path -Parent $PSCommandPath
$OpenCodeBin = "$RootDir\opencode\opencode.exe"
$HandyBin = "$RootDir\handy-voice\Handy\handy.exe"

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "🧠 Glitch AI - Launching..." -ForegroundColor Magenta
Write-Host ""

# ── Check prerequisites ──
if (-not (Test-Path $OpenCodeBin)) {
  Write-Host "OpenCode not found. Run bootstrap.ps1 first." -ForegroundColor Red
  Write-Host "Or run: powershell -File bootstrap.ps1" -ForegroundColor Yellow
  exit 1
}

# ── Self-heal: initialize git submodules if needed ──
if (-not (Test-Path "$RootDir\glitch-memorycore\prompt-rules.md")) {
  Write-Host "  Initializing glitch-memorycore submodule..." -ForegroundColor Cyan
  try {
    git submodule update --init --recursive 2>&1 | Out-Null
    if (Test-Path "$RootDir\glitch-memorycore\prompt-rules.md") {
      Write-Host "  glitch-memorycore ready!" -ForegroundColor Green
    } else {
      Write-Host "  WARNING: Could not load glitch-memorycore." -ForegroundColor Yellow
      Write-Host "  Run: git submodule update --init --recursive" -ForegroundColor Yellow
    }
  } catch {
    Write-Host "  WARNING: Could not initialize submodules. Error: $_" -ForegroundColor Yellow
    Write-Host "  OpenCode may not start correctly without memory files." -ForegroundColor Yellow
  }
} else {
  Write-Host "  glitch-memorycore found" -ForegroundColor DarkGreen
}

# ── Self-heal: install MCP server dependencies if needed ──
$mcpSdkPath = "$RootDir\plugins\mcp-server\node_modules\@modelcontextprotocol\sdk"
if (-not (Test-Path $mcpSdkPath)) {
  Write-Host "  Installing MCP server dependencies..." -ForegroundColor Cyan
  try {
    if (Test-Path "$RootDir\plugins\mcp-server\package.json") {
      Push-Location "$RootDir\plugins\mcp-server"
      npm install --no-audit --no-fund 2>&1 | Out-Null
      Pop-Location
      if (Test-Path $mcpSdkPath) {
        Write-Host "  glitch-connector ready!" -ForegroundColor Green
      } else {
        Write-Host "  WARNING: MCP server install may have failed." -ForegroundColor Yellow
      }
    }
  } catch {
    Write-Host "  WARNING: Could not install MCP dependencies: $_" -ForegroundColor Yellow
    Write-Host "  OpenCode will start but MCP tools won't be available." -ForegroundColor Yellow
  }
} else {
  Write-Host "  glitch-connector found" -ForegroundColor DarkGreen
}

# ── Ensure Handy portable flag ──
$portableFlag = "$RootDir\handy-voice\Handy\portable"
if (Test-Path $HandyBin) {
  if (-not (Test-Path $portableFlag)) {
    Set-Content -Path $portableFlag -Value "" -NoNewline
  }
}

# ── Normalize backslash paths in session DB ──
try { & "$RootDir\fix-paths.ps1" } catch { }

# ── Start Handy (if not already running) ──
$handyProcess = Get-Process -Name "handy" -ErrorAction SilentlyContinue
if (-not $handyProcess) {
  if (Test-Path $HandyBin) {
    Write-Host "  Starting Handy voice input..." -ForegroundColor Cyan
    Start-Process -FilePath $HandyBin -WindowStyle Minimized
    Start-Sleep -Seconds 1
  } else {
    Write-Host "  Handy not found (optional). Voice input disabled." -ForegroundColor DarkYellow
  }
} else {
  Write-Host "  Handy already running" -ForegroundColor DarkGreen
}

# ── Start API server (background process) ──
$apiServerScript = "$RootDir\plugins\mcp-server\api-server.mjs"
if (Test-Path $apiServerScript) {
  Write-Host "  Starting glitch-connector API..." -ForegroundColor Cyan
  $apiProc = Start-Process -FilePath "node" -ArgumentList "`"$apiServerScript`"" -WindowStyle Hidden -PassThru
  Start-Sleep -Milliseconds 500
  if (-not $apiProc.HasExited) {
    Write-Host "  glitch-connector running on http://127.0.0.1:4390" -ForegroundColor Green
  } else {
    Write-Host "  glitch-connector API failed to start" -ForegroundColor Yellow
  }
}

# ── Launch OpenCode ──
Write-Host "  Starting OpenCode..." -ForegroundColor Cyan
Write-Host ""

# OpenCode reads opencode.json + tui.json from the current directory automatically
Push-Location $RootDir
try {
  & $OpenCodeBin
} finally {
  Pop-Location
}

# ── Done ──
Write-Host ""
Write-Host "Glitch session ended." -ForegroundColor Magenta
