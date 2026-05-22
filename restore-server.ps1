$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSCommandPath
$HistoryFile = "$RootDir\.opencode\session-history\db.json"
$OpenCodePort = 4096
$ProxyPort = 4097

# Build injection script from the session history data
function Build-InjectionScript {
  if (-not (Test-Path $HistoryFile)) {
    Write-Host "No session history found at $HistoryFile" -ForegroundColor Yellow
    return $null
  }
  $json = Get-Content $HistoryFile -Raw | ConvertFrom-Json
  if (-not $json -or -not $json.sessions -or $json.sessions.Count -eq 0) {
    Write-Host "Session history is empty" -ForegroundColor Yellow
    return $null
  }
  return $json
}

$global:SessionsData = Build-InjectionScript

# Create the HTTP listener
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$ProxyPort/")
try {
  $listener.Start()
} catch {
  Write-Host "Failed to start restore server on port $ProxyPort" -ForegroundColor Red
  Write-Host "Error: $_"
  exit 1
}

Write-Host "Restore server running on http://0.0.0.0:$ProxyPort" -ForegroundColor Green
Write-Host "Visit http://localhost:$ProxyPort/  or  http://<tailscale-ip>:$ProxyPort/" -ForegroundColor Cyan

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $request = $context.Request
  $response = $context.Response
  $url = $request.Url.AbsolutePath

  try {
    if ($url -eq "/data.json") {
      # Serve the session history JSON
      if (Test-Path $HistoryFile) {
        $bytes = [System.IO.File]::ReadAllBytes($HistoryFile)
        $response.ContentType = "application/json"
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $response.StatusCode = 404
        $msg = [Text.Encoding]::UTF8.GetBytes('{"error":"No session history found"}')
        $response.ContentType = "application/json"
        $response.OutputStream.Write($msg, 0, $msg.Length)
      }
    } elseif ($url -eq "/" -or $url -eq "/restore") {
      # Serve the helper injection page
      $html = @"
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Glitch Session History Restore</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #131010; color: #e0dcdc; line-height: 1.6; padding: 20px; }
.container { max-width: 800px; margin: 0 auto; }
h1 { color: #c084fc; margin-bottom: 8px; }
.subtitle { color: #888; font-size: 14px; margin-bottom: 24px; }
.instructions { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
.instructions h2 { color: #c084fc; font-size: 16px; margin-bottom: 8px; }
.instructions ol { margin-left: 20px; }
.instructions li { margin-bottom: 6px; font-size: 14px; }
.instructions code { background: #2a2a2a; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
.session { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; }
.session-info { flex: 1; }
.session-title { font-weight: 600; margin-bottom: 2px; }
.session-meta { font-size: 12px; color: #888; }
.btn { background: #c084fc; color: #000; border: none; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px; }
.btn:hover { background: #a855f7; }
.btn:disabled { opacity: 0.5; cursor: default; }
.status { margin-top: 16px; padding: 12px; border-radius: 8px; display: none; }
.status.success { display: block; background: #14532d; border: 1px solid #22c55e; color: #bbf7d0; }
.status.error { display: block; background: #450a0a; border: 1px solid #ef4444; color: #fecaca; }
.injection-box { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 12px; margin-bottom: 24px; display: none; }
.injection-box textarea { width: 100%; min-height: 80px; background: #0a0a0a; color: #e0dcdc; border: 1px solid #333; border-radius: 4px; padding: 8px; font-family: monospace; font-size: 12px; }
.btn-copy { background: #333; color: #e0dcdc; border: 1px solid #555; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; margin-top: 4px; }
.btn-copy:hover { background: #444; }
</style>
</head>
<body>
<div class="container">
<h1>Glitch Session History Restore</h1>
<p class="subtitle">Inject session history into the OpenCode web app</p>

<div class="instructions">
<h2>How to restore</h2>
<ol>
  <li>Open the OpenCode web app at <code>http://&lt;tailscale-ip&gt;:4096/</code> on this device</li>
  <li>Click a session below to copy its injection script</li>
  <li>On the web app tab, open <code>F12 → Console</code></li>
  <li>Paste and press Enter</li>
  <li>Refresh the web app — the session messages will appear</li>
</ol>
</div>

<div id="sessions" style="margin-bottom: 24px;">
<h2 style="color: #c084fc; font-size: 16px; margin-bottom: 12px;">Sessions loaded from server</h2>
</div>

<div id="injectionBox" class="injection-box">
  <h3 style="color: #c084fc; font-size: 14px; margin-bottom: 8px;">Injection Script</h3>
  <textarea id="scriptText" readonly></textarea>
  <button class="btn-copy" onclick="copyScript()">Copy to Clipboard</button>
</div>

<div id="status" class="status"></div>
</div>

<script>
const SESSIONS_DATA = null; // will be populated from server

async function loadData() {
  try {
    const resp = await fetch('/data.json');
    const data = await resp.json();
    const container = document.getElementById('sessions');
    for (const s of data.sessions) {
      const el = document.createElement('div');
      el.className = 'session';
      el.innerHTML = '<div class="session-info"><div class="session-title">' + escapeHtml(s.title) + '</div><div class="session-meta">' + s.message_count + ' messages | ' + s.session_id + '</div></div><button class="btn" onclick="generateScript(\'' + s.session_id + '\')">Inject</button>';
      container.appendChild(el);
    }
  } catch(e) {
    showStatus('error', 'Failed to load session data: ' + e.message);
  }
}

function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

function getWorkspaceId() {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('opencode.workspace.') && key.includes('.dat:workspace:')) {
      const match = key.match(/^opencode\.workspace\.([^:]+?)\.dat:workspace:/);
      if (match) return match[1];
    }
  }
  return null;
}

async function generateScript(sessionId) {
  try {
    const resp = await fetch('/data.json');
    const data = await resp.json();
    const session = data.sessions.find(s => s.session_id === sessionId);
    if (!session) { showStatus('error', 'Session not found'); return; }

    // Build the injection script
    const workspaceId = getWorkspaceId() || 'E--Glitch-AI';

    let script = '// Glitch Session History Injection\n';
    script += '(function() {\n';
    script += '  const wsId = "' + workspaceId + '";\n';
    script += '  const sid = "' + sessionId + '";\n';

    // Set prompt (composer state) and comments
    const promptData = { prompt: [{ type: "text", content: "", start: 0, end: 0 }], context: { items: [] }, cursor: 0 };
    const commentsData = { comments: {} };

    script += '  localStorage.setItem("opencode.workspace." + wsId + ".dat:session:" + sid + ":prompt", ' + JSON.stringify(JSON.stringify(promptData)) + ');\n';
    script += '  localStorage.setItem("opencode.workspace." + wsId + ".dat:session:" + sid + ":comments", ' + JSON.stringify(JSON.stringify(commentsData)) + ');\n';

    // Set layout to mark this as the last active session
    script += '  try { var layout = JSON.parse(localStorage.getItem("opencode.global.dat:layout.page") || "{}"); if (!layout.lastProjectSession) { layout.lastProjectSession = {}; } layout.lastProjectSession["E:\\\\Glitch AI\\\\glitch-ai"] = { directory: "E:\\\\Glitch AI\\\\glitch-ai", id: sid, at: Date.now() }; localStorage.setItem("opencode.global.dat:layout.page", JSON.stringify(layout)); } catch(e) {}\n';

    script += '  console.log("Session history injected: " + sid);\n';
    script += '  alert("Session history injected! Refresh the web app tab.");\n';
    script += '})();';

    document.getElementById('scriptText').value = script;
    document.getElementById('injectionBox').style.display = 'block';
    showStatus('success', 'Script generated for: ' + session.title);
  } catch(e) {
    showStatus('error', 'Error: ' + e.message);
  }
}

function copyScript() {
  const ta = document.getElementById('scriptText');
  ta.select();
  document.execCommand('copy');
  showStatus('success', 'Copied to clipboard! Paste it in the web app console and press Enter.');
}

function showStatus(type, msg) {
  const el = document.getElementById('status');
  el.className = 'status ' + type;
  el.textContent = msg;
}

loadData();
</script>
</body>
</html>
"@
      $bytes = [Text.Encoding]::UTF8.GetBytes($html)
      $response.ContentType = "text/html"
      $response.ContentLength64 = $bytes.Length
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      # 404 for unknown paths
      $response.StatusCode = 404
      $msg = [Text.Encoding]::UTF8.GetBytes("Not found")
      $response.ContentType = "text/plain"
      $response.OutputStream.Write($msg, 0, $msg.Length)
    }
  } catch {
    try { $response.StatusCode = 500 } catch {}
  } finally {
    $response.OutputStream.Close()
  }
}

$listener.Stop()
