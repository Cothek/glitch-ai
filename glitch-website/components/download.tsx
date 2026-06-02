import { IconDownload, IconGithub, IconCheck } from "@/components/icons";

const REQUIREMENTS = [
  "Windows 10+, macOS 12+, or Linux",
  "API key for an LLM provider (OpenAI, Anthropic, etc.)",
  "GitHub account (for cloning)",
  "~500 MB disk (after bootstrap downloads OpenCode + Handy)",
];

export function Download() {
  return (
    <section id="download" className="border-b border-border py-20 sm:py-28">
      <div className="mx-auto max-w-4xl px-6">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-bg-elevated/60 to-bg p-8 sm:p-12">
          {/* Background glow */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-20 mx-auto h-40 max-w-md bg-accent opacity-20 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -bottom-20 right-0 h-40 max-w-xs bg-cyan opacity-10 blur-3xl"
          />

          <div className="relative">
            <p className="font-mono text-xs uppercase tracking-widest text-accent">Download</p>
            <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              Get Glitch on your machine.
            </h2>
            <p className="mt-3 max-w-xl text-text-muted">
              Free, open source, your data stays local. The download is a small archive — the first run downloads the OpenCode binary and Handy voice model on demand.
            </p>

            {/* Download button */}
            <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <a
                href="/api/download"
                download
                className="group inline-flex h-14 items-center gap-3 rounded-full bg-accent px-7 text-base font-semibold text-bg shadow-[0_0_30px_var(--color-accent-soft)] transition-all hover:scale-[1.02] hover:bg-accent-hover hover:shadow-[0_0_50px_var(--color-accent-soft)]"
              >
                <IconDownload className="h-5 w-5" />
                Download Glitch
                <span className="font-mono text-xs opacity-70">.zip</span>
              </a>

              <a
                href="https://github.com/Cothek/glitch-ai"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-14 items-center gap-2 rounded-full border border-border bg-bg-elevated/60 px-5 text-sm font-semibold text-text transition-colors hover:border-border-strong hover:bg-bg-elevated"
              >
                <IconGithub className="h-4 w-4" />
                Star on GitHub
              </a>
            </div>

            {/* Stats */}
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-text-dim">
              <span>~5 MB archive</span>
              <span aria-hidden>·</span>
              <span>Free, MIT-style license</span>
              <span aria-hidden>·</span>
              <span>No telemetry</span>
            </div>

            {/* Requirements */}
            <div className="mt-10 border-t border-border pt-6">
              <p className="font-mono text-[10px] uppercase tracking-widest text-text-dim">System requirements</p>
              <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {REQUIREMENTS.map((req) => (
                  <li key={req} className="flex items-start gap-2 text-sm text-text-muted">
                    <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                    <span>{req}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Alternative: clone from GitHub */}
            <div className="mt-8 rounded-lg border border-border bg-bg-code/60 p-4 text-sm">
              <p className="text-text-muted">
                <strong className="text-text">Prefer git?</strong> Clone directly from GitHub — same content, always up to date.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-md bg-bg/60 p-3 font-mono text-xs text-cyan">
                <code>git clone https://github.com/Cothek/glitch-ai.git</code>
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
