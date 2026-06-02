import Link from "next/link";
import { IconGithub, IconDownload } from "@/components/icons";

export function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/60">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 font-mono text-sm font-semibold tracking-tight">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]" />
          <span className="gradient-text">glitch</span>
          <span className="text-text-dim">/v1</span>
        </Link>

        <div className="hidden items-center gap-6 text-sm text-text-muted sm:flex">
          <a href="#features" className="transition-colors hover:text-text">Features</a>
          <a href="#showcase" className="transition-colors hover:text-text">Showcase</a>
          <a href="#architecture" className="transition-colors hover:text-text">Architecture</a>
          <a href="#install" className="transition-colors hover:text-text">Install</a>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="https://github.com/Cothek/glitch-ai"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden h-9 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:border-border-strong hover:text-text sm:inline-flex"
          >
            <IconGithub className="h-3.5 w-3.5" />
            Star
          </a>
          <a
            href="#download"
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-3 text-xs font-semibold text-bg transition-all hover:bg-accent-hover hover:shadow-[0_0_20px_var(--color-accent-soft)]"
          >
            <IconDownload className="h-3.5 w-3.5" />
            Download
          </a>
        </div>
      </div>
    </nav>
  );
}
