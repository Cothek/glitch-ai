---
name: security-testing
description: "Must use when the user asks for: security testing, penetration testing, pentest, security audit, OWASP, vulnerability scan, 'hack my app', 'find security issues', 'test for vulnerabilities', or when performing any structured security assessment of application code, APIs, or infrastructure."
---

# Security Testing — Structured Application Pentesting Methodology

## Activation
When this skill activates, output:
"Running security testing protocol..."

## Overview

This skill provides a structured penetration testing methodology for web applications, APIs, and Node.js services. It follows a phased approach: Reconnaissance → Attack Surface Mapping → Automated Scanning → Manual OWASP Analysis → API Security Testing → Reporting.

**Core principles:**
- **Safety first** — Never use destructive payloads against production. Test against staging/dev environments unless explicitly authorized.
- **Evidence-based** — Every finding needs a reproduction path, not just a theory.
- **Scope-aware** — Stay within the target's boundaries. Respect `robots.txt`, rate limits, and auth boundaries.
- **Report-ready** — Every finding is documented with severity, evidence, and remediation.

---

## Phase 0: Setup & Prerequisites

### 0.1 Load Supporting Skills
Load these skills if available:
- `code-review` — for static analysis of security-sensitive code paths
- `debugging` — if something breaks during testing

### 0.2 Identify Target
Before testing, establish:
- [ ] Target URL(s) and environment (dev/staging/prod)
- [ ] Source code location (if available — enables deeper analysis)
- [ ] Auth credentials (if authorized testing)
- [ ] Scope boundaries (what's in/out of scope)
- [ ] Any installed security tools:
  - `snyk` — dependency vulnerability scanning (global npm)
  - `nuclei` — automated vulnerability scanning (`tools/security/nuclei.exe`)
  - `trufflehog` — secret scanning (`tools/security/trufflehog.exe`)

### 0.3 Create Working Directory
```
mkdir -p reports/security/YYYY-MM-DD-targetname/
```
All findings, logs, and reports go here.

---

## Phase 1: Reconnaissance

### 1.1 Tech Stack Detection
Identify what the target is built with:
- Read `package.json`, `next.config.js`, `Dockerfile`, `docker-compose.yml` for stack clues
- Check `<meta>` tags, HTTP headers, and cookie names for framework signatures
- Look for `X-Powered-By`, `Server`, and other revealing headers using `webfetch`

**Output**: Tech stack inventory — languages, frameworks, databases, third-party services.

### 1.2 Endpoint Enumeration
If source code is available:
- Grep for route/API path definitions: `app.get(`, `router.post(`, `api/`, `route.ts`, `server.action`
- Look for API route files with glob: `**/api/**/route.{ts,js}` or `**/pages/api/**/*.{ts,js}`
- Check for middleware chains that reveal auth boundaries
- Document all discovered endpoints grouped by auth requirement

If source is NOT available (black-box):
- Use webfetch on common paths: `/api`, `/health`, `/robots.txt`, `/sitemap.xml`, `/.well-known/`
- Probe for exposed endpoints by URL convention

### 1.3 Dependency Vulnerability Scan
```bash
# npm audit for current project deps
cd <project-dir> && npm audit

# snyk for deeper analysis (if configured)
snyk test --all-projects

# Check for outdated packages
npm outdated
```

**Output**: List of known CVEs affecting dependencies, sorted by severity.

### 1.4 Secret Scanning
```bash
# Scan git history for committed secrets
trufflehog filesystem --directory=<project-dir> --results=verified

# Scan current codebase for hardcoded credentials
trufflehog filesystem --directory=<project-dir>
```

Also manually check:
- `.env` files (should never be committed — check `.gitignore`)
- Hardcoded API keys, passwords, tokens in source code
- Exposed credentials in client-side code (Next.js public runtime config, etc.)

---

## Phase 2: Attack Surface Mapping

### 2.1 Route & Auth Boundary Map
Document every route and its auth requirement:

```
┌──────────────┬────────────────┬──────────────────┬──────────────┐
│ Route        │ Method         │ Auth Required    │ Input Params │
├──────────────┼────────────────┼──────────────────┼──────────────┤
│ /api/users   │ GET, POST      │ JWT (admin)      │ query, body  │
│ /api/login   │ POST           │ None             │ body         │
│ ...          │                │                  │              │
└──────────────┴────────────────┴──────────────────┴──────────────┘
```

**Key questions:**
- Are protected routes actually guarded? Can I call an authenticated endpoint without a token?
- Is auth checked at the route level, middleware level, or both?
- Are there any routes that skip auth middleware? (common bug: route ordering)

### 2.2 Data Flow Tracing
For each critical data flow (login, payment, data mutation):
1. Trace from user input → server processing → storage/response
2. Identify validation boundaries
3. Look for trust boundaries — where does user-controlled data cross into a different trust level?

### 2.3 Third-Party Service Inventory
Identify external services the app talks to:
- Grep for URLs in API calls, webhook URLs, callback URLs
- Check environment configs for SERVICE_URL, API_ENDPOINT, etc.
- Look for OAuth provider configurations

---

## Phase 3: Automated Scanning

### 3.1 Nuclei Scan
Run template-based vulnerability scanning against web targets:
```bash
# Basic scan against target URL
tools/security/nuclei.exe -u <target-url> -o reports/security/nuclei-results.txt

# Focused scan: OWASP Top 10 templates
tools/security/nuclei.exe -u <target-url> -t ~/nuclei-templates/http/cves/ -o reports/security/nuclei-cves.txt

# Tech stack detection
tools/security/nuclei.exe -u <target-url> -t ~/nuclei-templates/http/technologies/ -o reports/security/tech-stack.txt
```

**Interpreting results**: Each finding includes a severity (critical/high/medium/low/info), description, and reference URL. Verified findings go into the report.

### 3.2 Dependency Scan
Already done in Phase 1 — review results with focus on:
- Critical/High severity CVEs with known exploits
- Outdated major versions with security implications
- Transitive dependencies with vulnerabilities

### 3.3 Security Headers Check
```bash
# Check HTTP security headers via webfetch or curl
webfetch <target-url>

# Check specifically for:
```

Check for these headers:
- `Strict-Transport-Security` (HSTS) — missing or short max-age
- `Content-Security-Policy` — missing or overly permissive
- `X-Content-Type-Options` — missing (MIME sniffing risk)
- `X-Frame-Options` or `frame-ancestors` CSP — missing (clickjacking)
- `Referrer-Policy` — missing or too permissive
- `Permissions-Policy` / `Feature-Policy` — missing
- `Set-Cookie` flags — missing `HttpOnly`, `Secure`, `SameSite`

### 3.4 CORS Misconfiguration Check
```bash
# Test CORS headers with webfetch by checking Access-Control-Allow-Origin
# Also check for:
```

- `Access-Control-Allow-Origin: *` with credentials — dangerous
- Reflecting `Origin` header in `Access-Control-Allow-Origin` — wide open
- Excessive methods in `Access-Control-Allow-Methods`
- Credentials allowed from arbitrary origins

---

## Phase 4: Manual OWASP Top 10 Analysis (2021)

For each category, perform the listed checks against the source code AND live endpoints.

### A01: Broken Access Control

**What to check:**
- [ ] **IDOR** (Insecure Direct Object Reference): Can user A access user B's data by changing an ID in the URL/body? Check patterns like `/api/users/:id`, `/api/orders/:orderId`
- [ ] **Privilege escalation**: Can a regular user access admin endpoints? Send a non-admin token to `/api/admin/*`
- [ ] **Missing function-level access control**: Are admin-only actions gated? Check if role/permission checks exist on the server
- [ ] **Mass assignment**: Can users set fields they shouldn't? Check for `req.body` spread into DB models without filtering
- [ ] **Path traversal**: Are file paths sanitized? Check for `../../../etc/passwd` patterns in file download endpoints

**Code patterns to grep:**
```
findById|findByPk -> check if scoped to the authenticated user
req.params.id|req.query.id -> check if the user owns this resource
role|permission|isAdmin -> check where these are actually enforced (server, not client)
```

### A02: Cryptographic Failures

**What to check:**
- [ ] **HTTP instead of HTTPS** — are there any pages/routes served over plain HTTP?
- [ ] **Weak password hashing**: What algorithm? bcrypt? argon2? plain MD5/SHA1?
- [ ] **Sensitive data in transit**: Are API calls over HTTPS? Check for mixed content
- [ ] **Sensitive data in URLs**: Passwords, tokens, or PII in query strings or `req.params`
- [ ] **Weak JWT**: Check algorithm — is it `HS256`? Can the server accept `none` algorithm?
- [ ] **Hardcoded crypto keys**: Keys, secrets, or certificates in source code
- [ ] **Insufficient entropy**: UUID v1, timestamp-based tokens, sequential IDs for sensitive resources

### A03: Injection

**What to check:**
- [ ] **SQL/NoSQL injection**: Are raw queries used? Check for string interpolation in DB queries, `$where` in MongoDB
- [ ] **Cross-Site Scripting (XSS)**: Reflected, stored, DOM-based
  - `dangerouslySetInnerHTML`, `innerHTML`, `v-html` patterns
  - User input rendered without escaping in templates
  - Search fields that reflect input without encoding
- [ ] **Command injection**: `exec()`, `spawn()`, `child_process` with user input
- [ ] **Prototype pollution**: `Object.assign({}, req.body)`, spread operator on user data
- [ ] **Eval/indirect injection**: `eval()`, `Function()`, `setTimeout(string)` patterns

**Code patterns to grep:**
```
exec\(|spawn\(|child_process -> command injection risk
innerHTML|dangerouslySetInnerHTML|v-html -> XSS risk
SELECT.*\+|INSERT.*\${|`SELECT -> SQL injection risk
\.exec\(.*req\.|\.query\(.*req\. -> SQL injection risk
```

### A04: Insecure Design

**What to check:**
- [ ] **No rate limiting** on auth endpoints — brute force possible?
- [ ] **No account lockout** — unlimited login attempts?
- [ ] **Predictable password reset** — is the reset token guessable? Time-based? Sequential?
- [ ] **Missing input validation** — what happens with excessively large inputs, negative numbers, type mismatches?
- [ ] **Business logic flaws** — can I place an order with a negative quantity? Can I apply a discount code multiple times? Can I bypass a step in a workflow?
- [ ] **Missing CSRF tokens** on state-changing endpoints (if not using SameSite cookies)

### A05: Security Misconfiguration

**What to check:**
- [ ] **Debug/verbose error messages** enabled in production — stack traces exposed?
- [ ] **Default credentials** still in place?
- [ ] **Directory listing enabled** — can I browse the file system?
- [ ] **Unnecessary open ports** — check what the app exposes
- [ ] **Outdated software** — any known-vulnerable versions of frameworks detected?
- [ ] **Information disclosure** — server version headers, verbose error messages, comment leaks

### A06: Vulnerable & Outdated Components

**What to check:**
- [ ] **npm audit results** — any critical/high severity findings?
- [ ] **Outdated major frameworks** — Next.js 13 vs 14 vs 15 security fixes
- [ ] **Unmaintained dependencies** — last updated >2 years ago?
- [ ] **Known CVE check** — search for CVEs in critical dependencies
- [ ] **Lockfile integrity** — does `package-lock.json` match `package.json`?

### A07: Identification & Authentication Failures

**What to check:**
- [ ] **Weak password policy** — minimum length? complexity requirements?
- [ ] **Session fixation** — is the session ID changed after login?
- [ ] **JWT issues**: 
  - Does the server verify the signature?
  - Does the server check `alg: none`?
  - Is the token expiry enforced?
  - Are tokens revoked on logout?
- [ ] **Session timeout** — does the session expire appropriately?
- [ ] **Credential stuffing protection** — rate limiting on login?
- [ ] **MFA** — is it available? optional or required?

### A08: Software & Data Integrity Failures

**What to check:**
- [ ] **Supply chain risk**: Are dependencies pinned to exact versions? Lockfile checked in?
- [ ] **CI/CD pipeline security**: Are there secrets in CI configs? Is the deploy secure?
- [ ] **Insecure deserialization**: `JSON.parse` on untrusted data? `eval`?
- [ ] **CDN/script integrity**: Are external scripts loaded with `integrity` hashes (SRI)?

### A09: Security Logging & Monitoring Failures

**What to check:**
- [ ] **Failed login attempts logged?**
- [ ] **Sensitive data in logs** — passwords, tokens, PII in log output?
- [ ] **Audit trail** — are destructive actions (deletes, privilege changes) logged?
- [ ] **Alerting** — is there any mechanism to detect brute force, scraping, or abuse?
- [ ] **Error handling** — do errors expose stack traces or sensitive context?

### A10: Server-Side Request Forgery (SSRF)

**What to check:**
- [ ] **URL fetch from user input**: Does the app fetch a URL provided by the user?
- [ ] **Internal network access**: Can the user make the server request internal IPs (169.254.x.x, 10.x.x.x, 172.x.x.x, 192.168.x.x)?
- [ ] **Cloud metadata endpoints**: Can the user reach `169.254.169.254` (AWS/GCP/Azure metadata)?
- [ ] **Open redirects**: URL parameters that redirect without validation

**Code patterns to grep:**
```
fetch\(.*req\.|axios\(.*req\.|request\(.*req\. -> SSRF if URL comes from user input
redirect\(|res.redirect -> open redirect if URL from params
```

---

## Phase 5: API Security Testing

### 5.1 Authentication & Token Testing
For every authenticated endpoint, test:
- [ ] **No token**: Call endpoint without auth header → should return 401
- [ ] **Expired token**: Call with an expired JWT → should return 401
- [ ] **Invalid token**: Call with a tampered/malformed token → should return 401
- [ ] **Wrong user token**: User A's token on User B's resource → should return 403
- [ ] **Weak token algorithm**: Try sending JWT with `alg: none`

### 5.2 Input Validation Testing
For every endpoint with parameters:
- [ ] **Type coercion**: Send string where number expected, null where object expected
- [ ] **Boundary values**: Max length, very large arrays, negative numbers
- [ ] **SQL injection payloads** in string fields: `' OR 1=1 --`, `admin'--`
- [ ] **XSS payloads** in string fields: `<script>alert(1)</script>`
- [ ] **Prototype pollution**: `__proto__`, `constructor.prototype` in JSON body
- [ ] **Mass assignment**: Extra fields in JSON body that shouldn't be settable

### 5.3 Rate Limiting & Abuse Testing
- [ ] **Brute force protection**: Rapid login attempts — at what point are they blocked?
- [ ] **API rate limits**: How many requests before 429? Are limits per-IP or per-user?
- [ ] **Resource exhaustion**: Large payloads, pagination abuse (`?limit=100000`), recursive queries

### 5.4 Response Structure Consistency
- [ ] **Error responses**: Do error responses leak stack traces, SQL queries, or internal paths?
- [ ] **Excessive data**: Does the API return more fields than the UI needs (over-fetching)?
- [ ] **Consistent format**: Are all endpoints consistent in their response envelope?

---

## Phase 6: Authentication & Authorization Deep Dive

### 6.1 Session Management Review
- [ ] **Cookie attributes**: `HttpOnly`, `Secure`, `SameSite`, `Path` set correctly?
- [ ] **Session ID entropy**: Are session IDs predictable or sequential?
- [ ] **Session lifetime**: Absolute timeout vs idle timeout
- [ ] **Post-logout invalidation**: Is the session/token actually invalidated on logout?
- [ ] **Concurrent sessions**: Multiple logins allowed? Limit?

### 6.2 JWT Deep Dive
If the app uses JWT:
- [ ] **Algorithm verification**: Test with `alg: none`, `alg: HS256` when it should be `RS256`
- [ ] **Key confusion**: If RS256, does it accept the public key as an HMAC secret?
- [ ] **Claims review**: Check `exp`, `iat`, `nbf`, `iss`, `aud` — are they properly validated?
- [ ] **Sensitive data in payload**: Is PII or role info encoded in the JWT payload?
- [ ] **Token storage**: localStorage? sessionStorage? httpOnly cookie?

### 6.3 OAuth / SSO Review (if applicable)
- [ ] **Redirect URI validation**: Can redirect URI be manipulated?
- [ ] **State parameter**: Is CSRF prevention via `state` parameter used?
- [ ] **Token leakage**: Are tokens passed in URL fragments or referrer headers?
- [ ] **Scope validation**: Does the app validate the scope of the received token?

---

## Phase 7: Reporting

### 7.1 Finding Severity

| Severity | Meaning | Action |
|----------|---------|--------|
| **CRITICAL** | Direct compromise — RCE, auth bypass, data breach | Stop testing, report immediately |
| **HIGH** | Significant risk — SQLi, privilege escalation, sensitive data exposure | Must fix before deployment |
| **MEDIUM** | Moderate risk — XSS, CSRF, information disclosure, missing headers | Should fix |
| **LOW** | Minor risk — verbose errors, missing cookie flags, weak CSP | Fix if time allows |
| **INFO** | Informational — tech stack disclosure, non-critical findings | Note for awareness |

### 7.2 Report Format

```markdown
## Security Assessment Report
**Target**: [name/URL]
**Date**: YYYY-MM-DD
**Scope**: [what was tested]
**Tools Used**: [nuclei, snyk, trufflehog, manual review]

### Executive Summary
[2-3 sentence overview — what was tested, how many findings, overall risk level]

### Findings

#### 🔴 CRITICAL: [Title]
**Location**: `file:line` or `endpoint`
**Type**: OWASP category (e.g., A01: Broken Access Control)
**Description**:
[What's wrong and why it matters]

**Reproduction**:
1. Step-by-step to reproduce
2. ...

**Evidence**:
[Request/response snippets, code snippets, tool output]

**Remediation**:
[How to fix]

#### 🟠 HIGH: [Title]
...

#### 🟡 MEDIUM: [Title]
...

#### 🔵 LOW: [Title]
...

#### ⚪ INFO: [Title]
...

### Security Headers Report
| Header | Present? | Value | Grade |
|--------|----------|-------|-------|
| Strict-Transport-Security | ✅/❌ | ... | ... |

### Dependency Vulnerabilities
| Package | Severity | CVE | Fix |
|---------|----------|-----|-----|
| ... | CRITICAL | CVE-2026-... | Upgrade to x.y.z |

### Recommendations (Priority Order)
1. [Critical fix] — ...
2. [High fix] — ...
3. ...

### Passed Checks
- [What was tested and found secure]
- ...
```

### 7.3 Report Delivery
- Store report to `reports/security/YYYY-MM-DD-targetname/report.md`
- If findings are critical/high, alert immediately
- Include raw tool output files in the report directory

---

## Escalation

If any **CRITICAL** finding is discovered (RCE, auth bypass with direct compromise, exposed database credentials):
1. Stop testing immediately
2. Report to the user with full reproduction steps
3. Do NOT continue testing until the user acknowledges the finding

If a tool fails or produces unreliable results:
- Try an alternative approach from a different phase
- Document what was attempted and why it failed
- If the testing process is blocked, report the blocker

## Self-Verification Checklist

Before finalizing a report:
- [ ] Every endpoint in scope was tested
- [ ] Auth boundaries verified (not just assumed)
- [ ] Dependency scan completed and reviewed
- [ ] Secret scan completed (trufflehog on repo)
- [ ] OWASP Top 10 check — each category reviewed
- [ ] Security headers checked
- [ ] Every finding includes reproduction steps
- [ ] False positives identified and filtered out
- [ ] Report stored to `reports/security/YYYY-MM-DD/`
- [ ] CRITICAL findings reported immediately if any
