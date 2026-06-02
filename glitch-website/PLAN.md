# Glitch Website — Implementation Plan

**Goal**: Build a beautiful, fast marketing site for Glitch AI that showcases what it does and lets friends download it with one click. Deploy to Vercel.

**Status**: Plan complete, ready to execute autonomously.

---

## Assumptions (Confirm or Override)

| Assumption | Rationale | Override? |
|---|---|---|
| "Vercelle" = **Vercel** | Deployment platform, fits the use case | Tell me if you meant something else |
| Download = **ZIP archive of public repo** | Most universal, no auth, works on any OS | Want GitHub Releases instead? |
| Stack = **Next.js 15 + Tailwind v4 + TypeScript** | Vercel-native, supports API routes for ZIP, modern DX | Want plain HTML/Astro instead? |
| Theme = **Dark mode primary** | Matches existing `index.html` + Glitch CLI aesthetic | Want light mode or theme toggle? |
| Brand colors = **Purple `#a855f7` + Cyan `#22d3ee`** | Already established in existing site + MemoryCore | Keep |
| Location = **New `glitch-website/` subdirectory** | Keeps the launcher repo clean; separate deployable unit | Want it in the root instead? |
| Existing `index.html` | **Kept as-is** (it's a separate doc site); new site is the marketing landing | Want to replace it? |

---

## Architecture

**Stack**: Next.js 15 (App Router) + Tailwind CSS v4 + TypeScript

**Why this stack**:
- **Vercel-native** — zero-config deploy, edge caching, serverless functions
- **Static-first** — pre-rendered HTML for SEO + speed
- **One API route** — `GET /api/download` serves a ZIP archive of the public repo
- **Image optimization** — built-in `<Image>` for screenshots
- **Type safety** — TypeScript catches bugs at build time

**Project structure**:
```
glitch-website/
├── app/
│   ├── layout.tsx              # Root layout, fonts, metadata
│   ├── page.tsx                # Landing page
│   ├── globals.css             # Tailwind v4 + custom CSS
│   └── api/
│       └── download/
│           └── route.ts        # ZIP archive endpoint
├── components/
│   ├── hero.tsx
│   ├── features.tsx
│   ├── showcase.tsx
│   ├── architecture.tsx
│   ├── install.tsx
│   ├── download-cta.tsx
│   ├── footer.tsx
│   └── ui/                     # Buttons, cards, code blocks
├── public/
│   ├── images/                 # Screenshots, logos (copy from ../screenshots/)
│   └── favicon.svg
├── lib/
│   └── zip.ts                  # Build ZIP from parent repo
├── next.config.ts
├── package.json
├── tsconfig.json
├── tailwind.config.ts (or @theme in CSS for v4)
├── postcss.config.mjs
├── vercel.json
└── README.md                   # Deploy instructions
```

---

## Pages / Sections (one-page landing, anchor-linked)

1. **Hero** — "Your AI companion that actually remembers." Big visual (the chat-screenshot.png), primary CTA "Download for Windows" + secondary "View on GitHub"
2. **The Glitch Difference** — 3-4 cards: Memory that persists, Skills that adapt, Agents that delegate, Voice-first
3. **See it in Action** — Real screenshot showcase with subtle scroll-triggered animation
4. **3-Layer Architecture** — Visual diagram: engine (public) + user data (private) + launcher (public)
5. **Install in 30 Seconds** — Numbered steps with copy-paste commands
6. **Download** — Section with download button (ZIP), system requirements, file size
7. **Footer** — Credits, links, GitHub

---

## Download Flow

**Endpoint**: `GET /api/download` returns `application/zip`

**Contents** (filtered from parent `glitch-ai/`):
- ✅ Engine code (`glitch-memorycore/`), scripts, config, launchers, README
- ❌ `.git/`, `node_modules/`, `user/` (Troy's private data), `data/`, `tmp/`
- ❌ `*.bak`, `.env*`, secrets, large binaries not needed for first run

**Build strategy**:
- Read the parent repo at request time (read-only file system on Vercel)
- Stream the ZIP from memory, no temp files
- Cache for 1 hour at the edge (re-zips on each deploy)
- Filename: `glitch-ai-v{commit-sha}.zip`

**Estimated size**: 5-15 MB compressed (currently ~30 MB uncompressed minus `node_modules`)

---

## Design System (UI Craft)

**Tokens** (3-layer spine: primitive → semantic → component):
- Primitive: 8-step gray scale, accent purple, accent cyan
- Semantic: `--bg`, `--bg-elevated`, `--text`, `--text-muted`, `--border`, `--accent`, `--accent-soft`
- Component: button (primary/secondary/ghost), card (default/hover/elevated), code block (terminal frame)

**Typography**:
- Display: Geist (or Inter fallback)
- Body: Geist
- Mono: JetBrains Mono (matches Glitch CLI)

**Motion** (UI Craft motion system):
- Durations: 150ms micro, 250ms standard, 400ms hero
- Easing: `cubic-bezier(0.16, 1, 0.3, 1)` (out-expo) for entrances, `cubic-bezier(0.4, 0, 0.2, 1)` for state changes
- Reduced-motion: all animations gated by `prefers-reduced-motion`
- Budget: max 3 simultaneous animations per viewport
- Purposeful: scroll-triggered reveals, hover micro-interactions, hero scan-line ambient (reused from existing site)

**Anti-slop checks** (avoid AI-generated look):
- ❌ No stock photos
- ❌ No "Trusted by 10,000+ companies" social proof
- ❌ No generic gradient backgrounds everywhere
- ❌ No cookie-cutter 3-column features
- ❌ No Tailwind default blue-500
- ✅ Real product screenshots
- ✅ Real CLI in hero
- ✅ Hand-crafted details (scan lines, terminal frames, custom cursors)
- ✅ Restrained color: 90% neutral, accent only on CTAs and key elements

---

## Deploy Strategy

1. Build locally: `npm run build` → `npm run start` to verify
2. Test the download endpoint with `curl` + `unzip -l`
3. Configure Vercel:
   - `vercel.json` with build/dev commands
   - One-click deploy button in README
4. Attempt auto-deploy via `vercel deploy --prod` if `VERCEL_TOKEN` is in env
5. Otherwise: provide exact manual deploy commands for Troy
6. Verify live URL: page loads, all sections render, download works, no console errors

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Vercel serverless function 250MB limit | ZIP will be ~15MB — well under limit |
| ZIP streaming on serverless | Build in-memory and stream response (Vercel Node runtime supports this) |
| Existing `index.html` conflicts with new site | Keep as separate site, new site lives in `glitch-website/` |
| Free Vercel tier bandwidth limits | ZIP is small + edge-cached. Free tier: 100GB/mo — plenty for friends |
| Lost work in `glitch-website/` if it gets deleted | Git ignored separately, no risk to parent repo |

---

## Success Criteria

- [ ] Site loads in <2s on Vercel
- [ ] All sections render correctly on desktop + mobile
- [ ] Download button returns a valid ZIP
- [ ] ZIP unpacks and `setup.bat` runs without errors
- [ ] Lighthouse score >90 (Performance, Accessibility, Best Practices, SEO)
- [ ] Anti-slop audit passes (no generic AI patterns)
- [ ] One-click deploy works
- [ ] Troy can share the URL with friends

---

## Timeline (Autonomous Execution)

1. **Plan** ← *we are here*
2. **Scaffold** (5 min) — create `glitch-website/` with Next.js + deps
3. **Design tokens + UI primitives** (10 min)
4. **Build hero + features + architecture** (15 min)
5. **Build download endpoint** (10 min)
6. **Anti-slop audit + motion polish** (10 min)
7. **Local test** (5 min)
8. **Deploy to Vercel** (5 min)
9. **Verify + commit + memory update** (5 min)

Total: ~65 min autonomous execution. Will report at end.
