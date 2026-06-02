#!/usr/bin/env node

import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const ZIP_PATH = resolve(__dirname, "..", "public", "downloads", "glitch-ai.zip");
const SITE_URL = "https://glitch-ai.vercel.app";
const REPO_URL = "https://github.com/Cothek/glitch-ai";

const token = process.env.VERCEL_TOKEN;
const vercelBin = (() => {
  try { return execSync("where vercel", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split("\n")[0]; }
  catch { return null; }
})();

console.log("=== Glitch Website Deploy ===\n");

if (!existsSync(ZIP_PATH)) {
  console.warn("⚠ Download ZIP not built yet.");
  console.warn(`  Run \`npm run build:zip\` first to create public/downloads/glitch-ai.zip\n`);
}

if (token && vercelBin) {
  console.log("✓ VERCEL_TOKEN present, Vercel CLI installed");
  console.log(`→ Running: vercel --prod --yes --token ***${token.slice(-4)}`);
  try {
    execSync(`"${vercelBin}" --prod --yes --token ${token}`, {
      cwd: __dirname + "/..",
      stdio: "inherit",
    });
    console.log(`\n✓ Deployed! Visit: ${SITE_URL}`);
  } catch (err) {
    console.error("\n✗ Deploy failed:", err.message);
    process.exit(1);
  }
} else {
  console.log("VERCEL_TOKEN not set. Three options:\n");
  console.log("OPTION A — One-click deploy (easiest):");
  console.log(`  Open: https://vercel.com/new/clone?repository-url=${encodeURIComponent(REPO_URL)}&project-name=glitch-website&root-directory=glitch-website\n`);
  console.log("OPTION B — Vercel web UI:");
  console.log("  1. Go to https://vercel.com/new");
  console.log("  2. Import the repo: Cothek/glitch-ai");
  console.log("  3. Set Root Directory to: glitch-website");
  console.log("  4. Click Deploy\n");
  console.log("OPTION C — CLI with token:");
  console.log("  1. Get a token: https://vercel.com/account/tokens");
  console.log("  2. Set it:  $env:VERCEL_TOKEN = \"vercel_xxx...\"");
  console.log("  3. Install CLI:  npm i -g vercel");
  console.log("  4. Run:  npm run deploy");
}
