import Link from "next/link";
import { IconGithub } from "@/components/icons";

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
          {/* Brand */}
          <div>
            <Link href="/" className="inline-flex items-center gap-2 font-mono text-sm font-semibold">
              <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
              <span className="gradient-text">glitch</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm text-text-muted">
              Your AI companion that actually remembers. Open source, your data stays local.
            </p>
          </div>

          {/* Links */}
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-text-dim">Project</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <a href="https://github.com/Cothek/glitch-ai" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-text-muted transition-colors hover:text-text">
                  <IconGithub className="h-3.5 w-3.5" />
                  glitch-ai
                </a>
              </li>
              <li>
                <a href="https://github.com/Cothek/glitch-engine" target="_blank" rel="noopener noreferrer" className="text-text-muted transition-colors hover:text-text">
                  glitch-engine
                </a>
              </li>
              <li>
                <a href="https://opencode.ai" target="_blank" rel="noopener noreferrer" className="text-text-muted transition-colors hover:text-text">
                  OpenCode
                </a>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-text-dim">Resources</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <a href="#install" className="text-text-muted transition-colors hover:text-text">Install guide</a>
              </li>
              <li>
                <a href="#architecture" className="text-text-muted transition-colors hover:text-text">Architecture</a>
              </li>
              <li>
                <a href="https://github.com/Cothek/glitch-ai/issues" target="_blank" rel="noopener noreferrer" className="text-text-muted transition-colors hover:text-text">Issues</a>
              </li>
              <li>
                <a href="https://github.com/Cothek/glitch-ai/blob/main/README.md" target="_blank" rel="noopener noreferrer" className="text-text-muted transition-colors hover:text-text">README</a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-border pt-6 text-xs text-text-dim sm:flex-row sm:items-center">
          <p>© 2026 Troy · Built with OpenCode</p>
          <p className="font-mono">
            <span aria-hidden className="mr-1">●</span>
            <span>v1.0 · public · open source</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
