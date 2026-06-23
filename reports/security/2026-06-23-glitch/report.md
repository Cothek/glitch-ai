# Security Assessment Report
**Target**: Glitch AI — E:\Glitch AI\glitch-ai
**Date**: 2026-06-23
**Scope**: Full project audit — config, scripts, git history, dependencies, secrets
**Tools Used**: trufflehog, npm audit, git log analysis, manual code review

## Executive Summary
Comprehensive security scan of the Glitch AI project. No CRITICAL findings detected. No secrets or hardcoded credentials were found in source code or git history. The primary concerns are around implicit agent permissions (least-privilege violation) and a moderate dependency vulnerability in the embed-search plugin. The network exposure via `hostname: "0.0.0.0"` is partially mitigated by Cloudflare Tunnel and the auth proxy.

## Findings

### 🟡 MEDIUM: Implicit Agent Permissions — Least Privilege Violation
**Location**: `opencode.json` (agents without permission blocks)
**Type**: A05: Security Misconfiguration

**Description**:
8 of 12 subagents have no explicit `permission` block in `opencode.json`, meaning they inherit OpenCode's default subagent permissions. The following agents lack explicit restrictions:

| Agent | Has permission block? | Risk |
|-------|----------------------|------|
| @explore | ❌ No | Read-only research — should have edit:deny |
| @plan | ❌ No | Architecture planning — no code, should have edit:deny, bash:deny |
| @build | ❌ No | Code scaffolding — should have edit:allow (needs it) but bash:deny |
| @coder | ❌ No (in JSON) | Code generation — has permissions via coder.md, not aligned |
| @ui-designer | ❌ No (in JSON) | UI code — has permissions via ui-designer.md, not aligned |
| @reviewer | ❌ No (in JSON) | Read-only review — should have edit:deny, bash:deny |
| @testing | ❌ No (in JSON) | Test writing — should have edit:allow but restricted |
| @glitch-omni | ❌ No (in JSON) | Full-access variant — has permissions via glitch-omni.md |

**Contrast with well-configured agents**:
- @vision: edit:deny, bash:deny, glob:deny, grep:deny (properly sandboxed)
- @pentester: edit:deny (properly read-only for security scanning)
- @general: bash:allow, edit:allow, websearch:deny (properly explicit)

**Remediation**:
Add explicit `permission` blocks to all agents in `opencode.json`, matching their intended function:
- @explore: edit:deny, bash:deny (read-only research)
- @plan: edit:deny, bash:deny (no code execution)
- @reviewer: edit:deny, bash:deny (read-only reviewer)
- @coder: edit:allow, bash:deny (code generation only)
- etc.

---

### 🟡 MEDIUM: Server Binds to All Network Interfaces
**Location**: `opencode.json` line 164-165
**Type**: A05: Security Misconfiguration

```
"server": {
    "port": 4100,
    "hostname": "0.0.0.0"
}
```

**Description**:
The opencode web UI binds to `0.0.0.0` (all interfaces), making it accessible to every device on the local network. If the Cloudflare Tunnel or auth proxy is misconfigured or bypassed, this could expose the OpenCode session to unauthorized LAN access.

**Mitigating factors**:
- The auth proxy runs on port 4100 and the actual OpenCode server is on 4102, so direct access to 4100 hits the proxy
- The auth proxy requires a password token for non-local connections
- Cloudflare Tunnel requires authentication before reaching the proxy

**Remediation**:
Change to `"127.0.0.1"` if remote/LAN access is handled exclusively through the auth proxy and Cloudflare Tunnel. This ensures raw OpenCode access is always local-only.

---

### 🟡 MEDIUM: Moderate Dependency Vulnerability — protobufjs
**Location**: `glitch-memorycore/plugins/embed-search/node_modules/protobufjs`
**Type**: A06: Vulnerable & Outdated Components

**Description**:
protobufjs <=7.6.2 has a moderate-severity vulnerability: "Schema-derived names can shadow runtime-significant properties" (GHSA-f38q-mgvj-vph7). This affects the ONNX runtime used by the FTS5+embedding search plugin.

**Status**: Fixable via `npm audit fix` (upgrade 7.6.1 → 7.6.4)
**Command**: `cd glitch-memorycore/plugins/embed-search && npm audit fix`

---

### 🔵 LOW: Account Credentials in Config Script
**Location**: `scripts/check-models.ps1` lines 59-69
**Type**: A05: Security Misconfiguration

**Description**:
`check-models.ps1` reads NVIDIA API keys from both `$env:NVIDIA_API_KEY` (secure) and a local `account.json` file (plaintext on disk). If `account.json` exists outside the gitignored `data/` directory, it could be exposed.

**Status**: Env var reading is best practice. `account.json` location needs verification. The script is already in the repo and could be audited for exposure.

---

### 🔵 LOW: Server Password Logged to Console
**Location**: `scripts/lib/server-mode.mjs` line 294
**Type**: A09: Logging & Monitoring Failures

```
log(YELLOW, `  Server password: ${pw}`);
log(GREEN, `  Web access URL: https://.../?auth_token=${authToken}`);
```

**Description**:
The server password and auth token are printed to stdout during startup. While this is useful for setup visibility, it means the password appears in terminal scrollback and logs.

**Remediation**:
Consider logging a masked version (`${pw.substring(0,4)}...`) by default, with a `--show-password` flag for setup scenarios.

---

### 🔵 LOW: Hardcoded Path in restart-glitch.bat
**Location**: `scripts/restart-glitch.bat` line 2
**Type**: Portability concern (not a vulnerability)

```
cd /d "E:\Glitch AI\glitch-ai"
```

**Description**:
Hardcoded absolute path prevents the script from working if the project is moved or deployed on another machine. Not a security vulnerability but a robustness issue.

---

### 🔵 LOW: NVIDIA API Key in Git History
**Location**: Commit messages `13a65e5` and `eb04065`
**Type**: Information disclosure

**Description**:
Commit messages reference "NVIDIA API key" in the context of `account.json`/`auth.json` file handling. The actual key values were never committed (trufflehog confirmed), but the presence of these references in commit history is a minor information leak about credential storage.

---

## Passed Checks

### Secret Scanning — ✅ CLEAN
- **trufflehog filesystem scan**: 161,046 chunks scanned, 1.96 GB
- **Verified secrets**: 0
- **Unverified findings**: 1,533 (all false positives from git objects, node_modules, ONNX models, browser cache)
- **Hardcoded credentials in source code**: None found

### Git History — ✅ CLEAN
- No `.env`, `.pem`, `.key`, credential, secret, or token files ever committed
- Commit messages do not contain credential values
- Sensitive files (.server-password, data/, user/) properly gitignored
- opencode.json is auto-generated and gitignored (templates are the committed source of truth)

### .gitignore — ✅ COMPREHENSIVE
- `.server-password`: ✅ gitignored (line 23)
- `data/`: ✅ gitignored (line 86) — covers config backups, node bundle, screenshots, logs
- `user/`: ✅ gitignored (line 77) — separate git submodule
- `handy-voice/`: ✅ gitignored (line 89) — third-party binaries
- `tools/security/*.exe`: ✅ gitignored (lines 81-83)
- `opencode.json`: ✅ gitignored (line 26) — generated from templates
- `screenshots/`: ✅ gitignored (line 40)
- `.opencode/session-history/`: ✅ gitignored (line 46)

### Agent Sandboxing — ✅ PARTIALLY CONFIGURED
- @vision: Properly restricted (edit:deny, bash:deny, glob:deny, grep:deny)
- @pentester: Properly restricted (edit:deny)
- @general: Properly configured (websearch:deny)
- @pentester-paid: Properly restricted (edit:deny)

### Dependency Scanning — ✅ ONE ACTIONABLE FINDING
- **npm audit** (embed-search): 1 moderate vulnerability (protobufjs, GHSA-f38q-mgvj-vph7) — fixable
- **npm audit** (.opencode): No vulnerabilities
- **snyk**: Not authenticated (needs `snyk auth` for full remote database, not critical)

### Script Injection — ✅ NO COMMAND INJECTIONS
- Launch scripts (.bat, .ps1, .mjs) reviewed for injection patterns (eval, exec with user input)
- `restart-glitch.bat`: Uses `tasklist` with tokenized output, hardcoded path — no injection vector
- `check-models.ps1`: Reads from env vars and local config — standard practice
- `server-mode.mjs`: Password managed via file read and env — standard practice
- No dynamic eval, no unsanitized user input in shell commands

## Recommendations (Priority Order)

1. **🟡 Add explicit permission blocks to all agents in opencode.json** (A05)
   Define `edit`, `bash`, `glob` permissions for every agent — don't rely on defaults.
   Priority: Next config change cycle (restart required).

2. **🟡 Fix protobufjs vulnerability** (A06)
   Run: `cd glitch-memorycore/plugins/embed-search && npm audit fix`
   Priority: This session (non-breaking change).

3. **🟡 Consider changing hostname to 127.0.0.1** (A05)
   Only if Cloudflare Tunnel + auth proxy is confirmed as the exclusive remote access path.
   Priority: Next config change cycle.

4. **🔵 Mask server password in console output** (A09)
   Show truncated password by default, require a flag for full display.
   Priority: Low.

## Scanning Summary

| Check | Tool | Result |
|-------|------|--------|
| Secret scan | trufflehog | ✅ CLEAN |
| Dep scan (glitch-ai root) | npm audit | ⚠️ No lockfile (expected — not a project) |
| Dep scan (embed-search) | npm audit | 🟡 1 moderate |
| Dep scan (opencode) | npm audit | ✅ CLEAN |
| Dep scan (snyk) | snyk | ⚠️ Not authenticated |
| Git history secrets | Manual | ✅ CLEAN |
| Config audit | Manual | 🟡 2 findings |
| Script review | Manual | ✅ CLEAN (3 low findings) |
| .gitignore review | Manual | ✅ COMPREHENSIVE |
