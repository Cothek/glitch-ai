// Minimal mime-type lookup (avoid importing the full mime-types package)
const MAP: Record<string, string> = {
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".tgz": "application/gzip",
  ".json": "application/json",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

export function lookup(filename: string): string | undefined {
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return undefined;
  const ext = filename.slice(dot).toLowerCase();
  return MAP[ext];
}
