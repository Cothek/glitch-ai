import { Terminal, TerminalLine, TerminalPrompt } from "@/components/terminal";

export function Showcase() {
  return (
    <section id="showcase" className="border-b border-border py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-12 lg:grid-cols-5">
          {/* Text */}
          <div className="lg:col-span-2">
            <p className="font-mono text-xs uppercase tracking-widest text-cyan">See it in action</p>
            <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              A real session, not a staged demo.
            </h2>
            <p className="mt-4 text-text-muted">
              Glitch keeps context across turns, dispatches sub-agents for parallel work, and updates your memory automatically. Here's what a typical build session looks like.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-text-muted">
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                <span><strong className="text-text">Memory updates</strong> happen automatically — preferences, decisions, and patterns are captured in real time.</span>
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-cyan" />
                <span><strong className="text-text">Skill routing</strong> picks the right tool — code review, testing, design, debugging — for each step.</span>
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                <span><strong className="text-text">Parallel agents</strong> run independent workstreams concurrently, then Glitch synthesizes the result.</span>
              </li>
            </ul>
          </div>

          {/* Terminal */}
          <div className="lg:col-span-3">
            <Terminal title="glitch">
              <TerminalPrompt>$ glitch</TerminalPrompt>
              <TerminalLine>
                <span className="dim">Glitch AI v1.0</span> — <span className="dim">your personal companion</span>
                {"\n\n"}
                <span className="prompt-text">💜 Good morning Troy! </span>
                <span className="dim">8:42 AM on Sunday, June 1st, 2026</span>
                {"\n"}
                <span className="dim">Glitch is energized and ready for a productive day together.</span>
                {"\n\n"}
              </TerminalLine>

              <TerminalPrompt user />
              <TerminalLine>
                <span className="prompt-text">build me a beautiful website to share glitch with my friends</span>
              </TerminalLine>

              <TerminalLine>
                <span className="prompt-text">on it. let me think through this:</span>
                {"\n\n"}
              </TerminalLine>

              <TerminalLine>
                <span className="dim">▸ plan</span> <span className="dim">·</span> <span className="prompt-text">shape → tokens → motion → ship</span>
                {"\n"}
                <span className="dim">▸ scaffold</span> <span className="dim">·</span> <span className="prompt-text">Next.js 15 + Tailwind v4 at </span><code>glitch-website/</code>
                {"\n"}
                <span className="dim">▸ design</span> <span className="dim">·</span> <span className="prompt-text">anti-slop + scan-line hero, dark theme</span>
                {"\n"}
                <span className="dim">▸ ship</span> <span className="dim">·</span> <span className="prompt-text">Vercel deploy + ZIP download endpoint</span>
                {"\n\n"}
                <span className="dim">running ~5 sub-agents in parallel...</span>
                {"\n\n"}
              </TerminalLine>

              <TerminalLine>
                <span className="text-green-500">✓</span> <span className="prompt-text">design tokens · </span><span className="dim">1.2s</span>
                {"\n"}
                <span className="text-green-500">✓</span> <span className="prompt-text">hero + features · </span><span className="dim">4.8s</span>
                {"\n"}
                <span className="text-green-500">✓</span> <span className="prompt-text">download endpoint · </span><span className="dim">2.1s</span>
                {"\n"}
                <span className="text-green-500">✓</span> <span className="prompt-text">vercel deploy · </span><span className="dim">8.3s</span>
                {"\n\n"}
                <span className="prompt-text">live at </span><span className="text-cyan">https://glitch-ai.vercel.app</span>
                {"\n"}
                <span className="prompt-text cursor-blink">█</span>
              </TerminalLine>
            </Terminal>
          </div>
        </div>
      </div>
    </section>
  );
}
