# Pi Remote Access Implementation Plan

> **Date:** September 22, 2026
> **Author:** @coder
> **Status:** Draft v1
> **Scope:** Remote access to Pi from any device (desktop, mobile, tablet) via internet
> **Depends on:** `pi-migration-plan.md`

---

## Executive Summary

Pi has no built-in web UI, but **mature community solutions exist**. The most popular is **pi-web-ui** (22.7K downloads/month), a polished browser interface that runs Pi in-process via the SDK and streams events over WebSocket.

**Solution:** Install pi-web-ui on the host machine → expose via Cloudflare tunnel → secure with Cloudflare Access → access from any device including mobile.

---

## 1. Existing Solutions Analysis

### Option 1: pi-web-ui (Recommended)

**Source:** `npm install -g pi-web-ui` by xingshuyin
**Downloads:** 22.7K/month
**License:** MIT

**Features:**
- ✅ Streaming agent chat over WebSocket
- ✅ Thinking blocks, tool-call cards with live status
- ✅ Built-in terminal (xterm.js)
- ✅ File management (tree view, editor)
- ✅ Model management (switch models, set API keys)
- ✅ Git source control panel
- ✅ Settings panel with presets
- ✅ Sound alerts
- ✅ Chinese/English UI
- ✅ Recent-projects list
- ✅ **Docker/systemd/launchd deployment**
- ✅ **Mobile-friendly** (phone, tablet, laptop)
- ✅ Credentials stay server-side (secure)

**Requirements:**
- Node.js ≥ 22.19
- Configured pi install

**Quick Start:**
```bash
npm i -g pi-web-ui
pi-web-ui  # Starts on http://localhost:8787
```

### Option 2: pi-web (Alternative)

**Source:** github.com/jmfederico/pi-web
**Focus:** Remote-first, persistent sessions

**Features:**
- ✅ Persistent sessions survive browser disconnects
- ✅ Parallel projects, worktrees, and agents
- ✅ PWA (Progressive Web App) support
- ✅ Session dashboard
- ✅ Branch filtering
- ✅ Token auth for LAN/Tailscale

**Better for:** Persistent agent work, multi-project management

### Option 3: pi-webui (Zetaphor)

**Source:** github.com/Zetaphor/pi-webui
**Focus:** Full-stack with VS Code-like editor

**Features:**
- ✅ VS Code-like workbench
- ✅ Multi-root file tree
- ✅ CodeMirror multi-tab editor
- ✅ Remote-SSH file browsing
- ✅ Draggable multi-terminal panel
- ✅ SFTP sync

**Better for:** Developers wanting VS Code-like experience

---

## 2. Recommended Solution: pi-web-ui + Cloudflare Tunnel

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Internet                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Access                        │
│               (Authentication Layer)                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Cloudflare Tunnel                          │
│            (pi.thecooldesigns.com)                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Host Machine                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              pi-web-ui (Port 8787)                  │   │
│  │         WebSocket + HTTP Server                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                              │                              │
│                              ▼                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Pi SDK (In-Process)                    │   │
│  │         Agent Session + Tools                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                              │                              │
│                              ▼                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Project Workspace                      │   │
│  │         Files, Git, Build Tools                     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Why This Works

1. **pi-web-ui runs in-process** — No subprocess, no JSON-RPC shim. Pi SDK runs directly in the Node.js server process.
2. **WebSocket streaming** — Events pushed to browser in real-time (60ms throttled snapshots).
3. **Credentials stay server-side** — Provider API keys never leave the server. Browser only gets event data.
4. **Mobile-friendly** — Responsive design works on phone, tablet, laptop.
5. **Docker/systemd support** — Can run as a background service.

---

## 3. Implementation Steps

### Phase 1: Install pi-web-ui on Host (15 minutes)

```bash
# Install globally
npm i -g --allow-scripts=node-pty,@google/genai,protobufjs pi-web-ui@latest

# Verify installation
pi-web-ui --version

# Test locally
pi-web-ui --cwd /path/to/project
# Opens http://localhost:8787
```

### Phase 2: Configure for Remote Access (30 minutes)

**Option A: Direct tunnel (simplest)**

```bash
# Run on 0.0.0.0 to accept external connections
PI_WEB_HOST=0.0.0.0 pi-web-ui --cwd /path/to/project
```

**Option B: Systemd service (recommended for production)**

```bash
# Install as systemd service
pi-web-ui server install --port 8787 --cwd /path/to/project

# Start service
pi-web-ui server start

# Check status
pi-web-ui server status
```

**Option C: Docker (most isolated)**

```dockerfile
FROM node:22-slim
RUN npm i -g pi-web-ui
EXPOSE 8787
CMD ["pi-web-ui", "--host", "0.0.0.0", "--cwd", "/workspace"]
```

### Phase 3: Cloudflare Tunnel Setup (30 minutes)

We already have:
- `*.cothekdesigns.com` wildcard DNS
- Cloudflare Access policies
- `cloudflared` running

**Add new tunnel route:**

1. **Create tunnel config** (if not exists):
```yaml
# ~/.cloudflared/config.yml
tunnel: <tunnel-id>
credentials-file: ~/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: pi.cothekdesigns.com
    service: http://localhost:8787
  - service: http_status:404
```

2. **Add DNS record:**
```bash
cloudflared tunnel route dns <tunnel-id> pi.cothekdesigns.com
```

3. **Restart tunnel:**
```bash
cloudflared tunnel run <tunnel-id>
```

### Phase 4: Cloudflare Access Authentication (15 minutes)

**Add Access policy for pi subdomain:**

1. Go to Cloudflare Zero Trust Dashboard
2. Access → Applications → Add Application
3. **Application name:** Pi Web UI
4. **Domain:** pi.cothekdesigns.com
5. **Application type:** Self-hosted
6. **Session duration:** 24 hours (or your preference)
7. **Policy:** Add policy
   - **Policy name:** Pi Access
   - **Action:** Allow
   - **Include:** Emails ending in @yourdomain.com (or your email)
8. **Save**

Now accessing `https://pi.cothekdesigns.com` will require Cloudflare Access authentication.

### Phase 5: Mobile Optimization (15 minutes)

pi-web-ui is already mobile-friendly, but we can optimize:

1. **Add to Home Screen (PWA):**
   - Open `https://pi.cothekdesigns.com` on mobile
   - Tap "Add to Home Screen"
   - Now it's a native-like app

2. **Custom theme for mobile:**
   - pi-web-ui supports themes
   - Create a mobile-optimized theme in `~/.pi-web/themes/`

3. **Notification setup:**
   - pi-web-ui has sound alerts
   - Enable browser notifications for completion alerts

---

## 4. Security Considerations

### What's Secure by Default

- ✅ **Credentials stay server-side** — Provider API keys never reach browser
- ✅ **Cloudflare Access** — Authentication layer before reaching pi-web-ui
- ✅ **HTTPS** — Cloudflare tunnel provides TLS termination
- ✅ **No exposed ports** — Only Cloudflare tunnel port exposed

### What We Need to Add

1. **pi-web-ui token auth** (optional additional layer):
```bash
# Set auth token
export PI_WEB_TOKEN="your-secret-token"

# Access requires token in URL or header
# https://pi.cothekdesigns.com?token=your-secret-token
```

2. **Rate limiting** (Cloudflare):
   - Cloudflare provides built-in DDoS protection
   - Add rate limiting rules in Cloudflare dashboard

3. **IP restrictions** (optional):
   - Cloudflare Access can restrict by IP range
   - Useful for corporate networks

### Security Architecture

```
Internet
    │
    ▼
Cloudflare DDoS Protection + Rate Limiting
    │
    ▼
Cloudflare Access (Authentication)
    │
    ▼
Cloudflare Tunnel (TLS termination)
    │
    ▼
pi-web-ui (Port 8787, localhost only)
    │
    ▼
Pi SDK (In-process, no subprocess)
    │
    ▼
Project Workspace (file system access)
```

---

## 5. Comparison with opencode Web Interface

| Feature | opencode | Pi (pi-web-ui) |
|---------|----------|----------------|
| **Web UI** | Built-in (`serve.mjs`) | Community package (pi-web-ui) |
| **Authentication** | Cloudflare Access | Cloudflare Access + optional token |
| **Mobile Support** | Basic | ✅ Responsive + PWA |
| **Terminal** | Basic | ✅ xterm.js with full terminal |
| **File Management** | Basic | ✅ Tree view + editor |
| **Git Integration** | Manual | ✅ Built-in panel |
| **Model Management** | Config files | ✅ UI-based |
| **Session Persistence** | Yes | ✅ Yes + survive disconnects |
| **Credentials Security** | Server-side | ✅ Server-side |
| **Deployment** | Custom scripts | ✅ Docker/systemd/launchd |

**Verdict:** pi-web-ui is **more feature-rich** than opencode's web interface.

---

## 6. Migration from opencode Web Interface

### What Transfers Directly

| Asset | Status | Notes |
|-------|--------|-------|
| `*.cothekdesigns.com` wildcard DNS | ✅ Ready | No changes needed |
| Cloudflare Access policies | ✅ Ready | Add new policy for pi subdomain |
| Cloudflare tunnel daemon | ✅ Ready | Add new ingress rule |
| Authentication config | ✅ Ready | Reuse existing Access policies |

### What Needs Migration

| Component | Action | Effort |
|-----------|--------|--------|
| Pi installation | Install pi + pi-web-ui | 15 min |
| Pi configuration | Set up providers, models | 30 min |
| Pi skills | Copy from `.agents/skills/` | 5 min |
| Pi memory | Set up AGENTS.md with @path imports | 30 min |

### Total Migration Time: ~2 hours

---

## 7. Mobile Experience

### Features Available on Mobile

| Feature | Mobile Support | Notes |
|---------|----------------|-------|
| Chat interface | ✅ Full | Responsive design |
| Tool call inspection | ✅ Full | Collapsible cards |
| Terminal access | ✅ Full | xterm.js works on mobile |
| File browsing | ✅ Full | Touch-friendly tree |
| Model switching | ✅ Full | Dropdown works on mobile |
| Settings | ✅ Full | Responsive panels |
| Sound alerts | ✅ Full | Browser notifications |
| PWA install | ✅ Full | Add to Home Screen |

### Mobile Workflow

1. **Start session on desktop:**
   ```bash
   pi-web-ui --cwd /path/to/project
   ```

2. **Access from phone:**
   - Open `https://pi.cothekdesigns.com`
   - Authenticate via Cloudflare Access
   - Continue session from phone

3. **Add to Home Screen:**
   - iOS: Safari → Share → Add to Home Screen
   - Android: Chrome → Menu → Add to Home Screen
   - Now it's a native-like app

4. **Notifications:**
   - Enable browser notifications
   - Get alerted when agent completes tasks

---

## 8. Rollback Plan

If pi-web-ui doesn't work:

1. **Immediate rollback:**
   - Stop pi-web-ui service
   - opencode web interface still available
   - No changes to existing infrastructure

2. **Alternative solutions:**
   - **pi-web** (persistent sessions focus)
   - **pi-webui** (VS Code-like experience)
   - **Custom build** over Pi's RPC mode

3. **Data preservation:**
   - Pi sessions stored in `~/.pi/sessions/`
   - Project files unchanged
   - Memory files unchanged

---

## 9. Success Criteria

### Phase 1 — Installation
- [ ] pi-web-ui installed globally
- [ ] pi-web-ui starts on localhost:8787
- [ ] Basic chat works in browser

### Phase 2 — Remote Access
- [ ] pi-web-ui accessible via Cloudflare tunnel
- [ ] Authentication works via Cloudflare Access
- [ ] HTTPS working (no mixed content)

### Phase 3 — Mobile
- [ ] Responsive design works on phone
- [ ] Add to Home Screen works (PWA)
- [ ] Notifications work on mobile

### Phase 4 — Production
- [ ] pi-web-ui runs as systemd service
- [ ] Auto-starts on boot
- [ ] Survives reboots

### Overall Success
- [ ] Access Pi from phone anywhere
- [ ] Access Pi from tablet anywhere
- [ ] Access Pi from any computer with browser
- [ ] Session continuity across devices
- [ ] No credential exposure to browser

---

## 10. Timeline

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| Install pi-web-ui | 15 min | Web UI running locally |
| Configure remote access | 30 min | Systemd service, 0.0.0.0 binding |
| Cloudflare tunnel | 30 min | pi.cothekdesigns.com accessible |
| Cloudflare Access | 15 min | Authentication working |
| Mobile optimization | 15 min | PWA, notifications |
| Testing | 30 min | End-to-end verification |
| **Total** | **2.5 hours** | **Full remote access** |

---

## 11. Conclusion

**Pi remote access is solved by existing community packages.** No custom development needed.

**Recommended solution:**
1. Install `pi-web-ui` (22.7K downloads/month, MIT license)
2. Run as systemd service on host
3. Expose via existing Cloudflare tunnel
4. Secure with existing Cloudflare Access policies
5. Access from any device including mobile

**Key advantages over opencode:**
- More feature-rich web UI
- Better mobile support (PWA)
- Built-in terminal (xterm.js)
- Git panel
- Model management UI
- Credentials stay server-side (more secure)

**Migration effort:** ~2.5 hours
**Risk:** Low — existing infrastructure transfers directly
**Rollback:** Stop pi-web-ui, opencode still available

---

*This plan is referenced in `pi-migration-plan.md` Section 4.2 (Remote Browser Access).*

*Next action: Install pi-web-ui and test locally before configuring remote access.*
