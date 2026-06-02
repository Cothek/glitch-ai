# Glitch Website

The marketing site for [Glitch AI](https://github.com/Cothek/glitch-ai) — a personal AI companion with persistent memory, skills, and agents.

**Live**: _(deployed URL here)_

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4** for styling
- **archiver** for ZIP building
- **Geist** + **Geist Mono** fonts (next/font)
- **Vercel** for hosting (one-click deploy)

## Project structure

```
glitch-website/
├── app/
│   ├── layout.tsx              # Root layout, fonts, metadata
│   ├── page.tsx                # Landing page (composes all sections)
│   ├── globals.css             # Design system (Tailwind v4 @theme)
│   └── api/
│       └── download/
│           ├── route.ts        # Serves the ZIP with proper headers
│           └── mime.ts         # Tiny mime-type lookup
├── components/                 # One component per landing section
│   ├── nav.tsx
│   ├── hero.tsx
│   ├── scan-lines.tsx          # Hero background animation
│   ├── features.tsx
│   ├── showcase.tsx            # Terminal-style demo
│   ├── architecture.tsx
│   ├── install.tsx
│   ├── copy-button.tsx         # Client component
│   ├── download.tsx
│   ├── footer.tsx
│   ├── terminal.tsx            # Reusable terminal frame
│   └── icons.tsx               # Inline SVG icons (no icon library)
├── lib/                        # Reserved for shared utilities
├── public/
│   ├── favicon.svg
│   ├── og-image.svg
│   ├── manifest.json
│   ├── images/                 # Screenshots
│   └── downloads/              # Built ZIP (gitignored, build:zip regenerates)
├── scripts/
│   └── build-zip.mjs           # Builds the download archive
├── next.config.ts
├── tailwind config             # Tailwind v4 (in CSS via @theme)
├── postcss.config.mjs
├── vercel.json                 # Vercel deployment config
├── tsconfig.json
├── package.json
└── README.md
```

## Develop

```bash
# Install deps
npm install

# Start the dev server (http://localhost:3000)
npm run dev

# Build the download ZIP (reads from ../ — the parent glitch-ai/ repo)
npm run build:zip

# Full production build
npm run build

# Serve the production build
npm start
```

## Deploy to Vercel

### One-click

Click this button (after pushing to GitHub):

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FCothek%2Fglitch-ai%2Ftree%2Fmain%2Fglitch-website&project-name=glitch-website&root-directory=glitch-website)

> **Important**: Set the **Root Directory** to `glitch-website` in the Vercel project settings.

### Manual

```bash
# Install Vercel CLI
npm i -g vercel

# First-time setup (will prompt for login + project creation)
cd glitch-website
vercel

# Production deploy
vercel --prod
```

### Configuration

In the Vercel dashboard for the project, set:

| Setting | Value |
|---|---|
| **Root Directory** | `glitch-website` |
| **Framework Preset** | Next.js (auto-detected) |
| **Build Command** | `npm run build` (default) |
| **Install Command** | `npm install` (default) |
| **Output Directory** | `.next` (default) |

Optional env vars:
- `NEXT_PUBLIC_SITE_URL` — your deployed URL (e.g. `https://glitch-ai.vercel.app`). Used for OpenGraph and canonical links.

## Download archive

The download button on the site points to `/api/download`, which serves `public/downloads/glitch-ai.zip`. The ZIP is built from the parent `glitch-ai/` repo and contains:

✅ **Included**:
- `glitch-memorycore/` (engine — public, 23 skills, identity, plugins)
- `scripts/`, `config/` (PowerShell launchers and configs)
- `setup.bat`, `launch-glitch*.bat`, `serve-glitch.bat` (Windows launchers)
- `opencode.json` (base config)
- `README.md`, `index.html` (docs)
- `INSTALL.txt` (quick start inside the ZIP)

❌ **Excluded**:
- `.git/` (history)
- `node_modules/` (installed by setup)
- `user/` (Troy's private data)
- `data/`, `tmp/` (runtime)
- `opencode/`, `handy-voice/`, `cloudflared.exe` (large binaries — downloaded on first run by `bootstrap.ps1`)
- `tools/`, `screenshots/`, `glitch-website/` (internal)
- `*.bak`, `*.log`, `*.zip`, `.env*`, `package-lock.json` (junk / secrets / locks)

### Updating the ZIP

The ZIP is **not** committed to the repo (it's in `.gitignore`). To update it:

```bash
# Locally:
cd glitch-website
npm run build:zip           # regenerates public/downloads/glitch-ai.zip
# Commit it explicitly (un-ignore for this commit):
git add -f public/downloads/glitch-ai.zip
git commit -m "release: zip for vX.Y.Z"
git push
```

On Vercel, the prebuild script runs `build:zip` automatically but **will skip** because the parent repo isn't deployed. The committed ZIP is the source of truth on Vercel.

## Design system

All design tokens live in `app/globals.css` under `@theme { ... }`. Tailwind v4 picks them up automatically.

| Token | Value |
|---|---|
| `bg`, `bg-elevated`, `bg-surface`, `bg-code` | Surface colors |
| `text`, `text-muted`, `text-dim` | Text scale |
| `border`, `border-strong` | Border colors |
| `accent` (purple), `cyan`, `green`, `amber`, `red` | Brand + semantic |
| `accent-soft`, `cyan-soft` | Soft variants (15% opacity) |
| `font-sans` (Geist), `font-mono` (Geist Mono) | Typography |
| `radius-sm`, `radius`, `radius-lg`, `radius-xl` | Spacing |
| `ease-out`, `ease-in-out` | Easing curves |
| `duration-fast`, `duration`, `duration-slow` | Animation durations |

## Anti-slop checklist

This site is intentionally NOT generic. We avoid:

- ❌ Stock photos
- ❌ "Trusted by 10,000+" social proof
- ❌ Cookie-cutter 3-column features
- ❌ Tailwind default blue-500
- ❌ Gratuitous gradients everywhere
- ❌ `text-3xl font-bold` for everything

Instead we use:

- ✅ Real product screenshots
- ✅ Terminal-style demos with authentic Glitch output
- ✅ Scan-line hero (echoing the existing glitch-ai landing)
- ✅ Custom monospace accents (Cascadia/JetBrains Mono)
- ✅ Restrained color: 90% neutral, accent only on CTAs
- ✅ Custom SVG icons (no icon library)
- ✅ Tasteful motion (max 3 simultaneous animations, reduced-motion respected)

## License

MIT — same as the parent Glitch project.
