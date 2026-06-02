import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://glitch-ai.vercel.app";

export const viewport: Viewport = {
  themeColor: "#0a0a0f",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Glitch — Your AI companion that actually remembers",
    template: "%s · Glitch",
  },
  description:
    "Portable AI companion environment with persistent memory, skills, and agents. One clone, one setup, ready on any PC. Open source, your data stays local.",
  keywords: [
    "AI companion",
    "personal AI",
    "persistent memory",
    "OpenCode",
    "agent skills",
    "Glitch",
    "Claude Code alternative",
    "open source AI",
    "memory AI",
    "local AI",
  ],
  authors: [{ name: "Troy", url: "https://github.com/Cothek" }],
  creator: "Troy",
  publisher: "Glitch",
  applicationName: "Glitch",
  category: "Developer Tools",
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "Glitch",
    title: "Glitch — Your AI companion that actually remembers",
    description:
      "Portable AI companion with persistent memory, skills, and agents. Open source. Your data stays local.",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Glitch — Your AI companion",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Glitch — Your AI companion that actually remembers",
    description:
      "Portable AI companion with persistent memory, skills, and agents.",
    images: ["/og-image.svg"],
    creator: "@cothek",
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: "/favicon.svg",
  },
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-bg text-text">{children}</body>
    </html>
  );
}
