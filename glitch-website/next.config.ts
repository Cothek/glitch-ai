import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the build output deterministic and small.
  poweredByHeader: false,
  // Allow images from the GitHub avatar/raw URLs if we ever need them.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "raw.githubusercontent.com" },
    ],
  },
  // Compress responses (Vercel does this automatically, but be explicit).
  compress: true,
  // We use archiver (Node-only) in the download route, so keep the Node runtime
  // available. The default is Node, so we don't need to set `experimental.nodeMiddleware`.
  experimental: {
    // Allow large server actions if we ever need them.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
