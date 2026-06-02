import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { join } from "path";
import { lookup as lookupMime } from "./mime";

const ZIP_PATH = join(process.cwd(), "public", "downloads", "glitch-ai.zip");

// Disable static optimization — this route reads the filesystem.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getZipInfo() {
  try {
    const stats = await fs.stat(ZIP_PATH);
    // Read git SHA from a sidecar file written by build:zip, or fall back to "latest"
    let sha = "latest";
    try {
      const shaPath = join(process.cwd(), "public", "downloads", ".sha");
      sha = (await fs.readFile(shaPath, "utf8")).trim() || "latest";
    } catch {
      /* no sha file */
    }
    return { exists: true, stats, sha };
  } catch {
    return { exists: false, stats: null, sha: "latest" };
  }
}

export async function GET() {
  const info = await getZipInfo();
  if (!info.exists || !info.stats) {
    return NextResponse.json(
      {
        error: "Download not built",
        fix: "Run `npm run build:zip` locally and commit the resulting public/downloads/glitch-ai.zip file.",
        fallback: "https://github.com/Cothek/glitch-ai",
      },
      { status: 503 }
    );
  }

  const data = await fs.readFile(ZIP_PATH);
  const filename = `glitch-ai-${info.sha}.zip`;
  const mime = lookupMime(filename) ?? "application/zip";

  return new NextResponse(data as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(info.stats.size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "X-Glitch-Sha": info.sha,
      "X-Glitch-Size-Bytes": String(info.stats.size),
    },
  });
}

export async function HEAD() {
  const info = await getZipInfo();
  if (!info.exists || !info.stats) {
    return new NextResponse(null, { status: 503 });
  }
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(info.stats.size),
      "X-Glitch-Sha": info.sha,
    },
  });
}
