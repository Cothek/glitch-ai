import Link from "next/link";
import { ScanLines } from "@/components/scan-lines";
import { IconDownload, IconGithub, IconArrowRight } from "@/components/icons";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      {/* Scan lines layer */}
      <ScanLines count={90} />

      {/* Top radial accent */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-32 mx-auto h-64 max-w-3xl bg-accent opacity-20 blur-3xl"
      />

      <div className="relative mx-auto max-w-5xl px-6 pb-20 pt-20 sm:pt-28 lg:pt-32">
        {/* Terminal-style prompt chip */}
        <div className="mb-8 flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-elevated/80 px-3 py-1.5 font-mono text-xs text-text-muted">
            <span className="text-green-500">$</span>
            <span className="text-cyan">glitch init</span>
            <span>--portable</span>
          </div>
        </div>

        {/* Title */}
        <h1 className="text-balance text-center text-5xl font-extrabold tracking-tighter sm:text-6xl lg:text-7xl">
          <span className="gradient-text glow-purple inline-block">Glitch</span>
        </h1>

        {/* Subtitle */}
        <p className="mx-auto mt-6 max-w-2xl text-balance text-center text-lg text-text-muted sm:text-xl">
          Your AI companion that actually <em className="not-italic text-text">remembers</em>.
          <br className="hidden sm:inline" />
          Portable, persistent, private.
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          <Link
            href="#download"
            className="group inline-flex h-12 items-center gap-2 rounded-full bg-accent px-6 text-sm font-semibold text-bg transition-all hover:bg-accent-hover hover:shadow-[0_0_30px_var(--color-accent-soft)]"
          >
            <IconDownload className="h-4 w-4" />
            Download for Windows
            <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a
            href="https://github.com/Cothek/glitch-ai"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 items-center gap-2 rounded-full border border-border bg-bg-elevated/60 px-6 text-sm font-semibold text-text transition-all hover:border-border-strong hover:bg-bg-elevated"
          >
            <IconGithub className="h-4 w-4" />
            View on GitHub
          </a>
        </div>

        {/* Stats row */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-xs text-text-dim">
          <Stat color="green" label="23 skills" />
          <Stat color="purple" label="3-layer architecture" />
          <Stat color="cyan" label="Windows · macOS · Linux" />
          <Stat color="purple" label="Open source" />
        </div>
      </div>

      {/* Bottom fade for next section */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-bg"
      />
    </section>
  );
}

function Stat({ color, label }: { color: "green" | "purple" | "cyan"; label: string }) {
  const dotColor = {
    green: "bg-green-500 shadow-[0_0_8px_var(--color-green)]",
    purple: "bg-accent shadow-[0_0_8px_var(--color-accent)]",
    cyan: "bg-cyan shadow-[0_0_8px_var(--color-cyan)]",
  }[color];

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor} pulse-dot`} aria-hidden />
      {label}
    </span>
  );
}
