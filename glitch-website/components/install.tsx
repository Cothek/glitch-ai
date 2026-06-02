import { CopyButton } from "@/components/copy-button";
import { IconTerminal, IconCheck } from "@/components/icons";

const STEPS = [
  {
    n: 1,
    title: "Clone the repo",
    body: "Grab the launcher repo and its submodules.",
    code: "git clone https://github.com/Cothek/glitch-ai.git\ncd glitch-ai\ngit submodule update --init --recursive",
  },
  {
    n: 2,
    title: "Run setup",
    body: "Double-click setup.bat or run it in PowerShell. The first run downloads OpenCode and the Handy voice model.",
    code: ".\\setup.bat",
  },
  {
    n: 3,
    title: "Launch Glitch",
    body: "Pick a profile (or create a new one) and you're in.",
    code: ".\\launch-glitch.bat",
  },
  {
    n: 4,
    title: "Start chatting",
    body: "Type or press Ctrl+Space for voice. Glitch will introduce itself with a session brief and remember it next time.",
    code: "Hi Glitch — help me build a thing.",
  },
];

export function Install() {
  return (
    <section id="install" className="border-b border-border py-20 sm:py-28">
      <div className="mx-auto max-w-4xl px-6">
        <header className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Install in 30 seconds</p>
          <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            Four steps. Zero configuration.
          </h2>
          <p className="mt-4 text-text-muted">
            Windows, macOS, and Linux all work — the launchers are platform-specific but the engine is portable.
          </p>
        </header>

        <ol className="mt-14 space-y-6">
          {STEPS.map((step) => (
            <li
              key={step.n}
              className="group relative grid grid-cols-1 gap-4 rounded-lg border border-border bg-bg-elevated/40 p-5 sm:grid-cols-[auto,1fr] sm:gap-6 sm:p-6"
            >
              <div className="flex items-center gap-3 sm:flex-col sm:items-start">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft font-mono text-sm font-bold text-accent">
                  {step.n}
                </span>
                <h3 className="text-base font-semibold tracking-tight sm:mt-2">{step.title}</h3>
              </div>

              <div>
                <p className="text-sm text-text-muted">{step.body}</p>
                <div className="relative mt-3 overflow-hidden rounded-md border border-border bg-bg-code">
                  <div className="flex items-center justify-between border-b border-border bg-bg-elevated px-3 py-1.5">
                    <div className="flex items-center gap-1.5 font-mono text-[10px] text-text-dim">
                      <IconTerminal className="h-3 w-3" />
                      powershell
                    </div>
                    <CopyButton text={step.code} />
                  </div>
                  <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-text">
                    <code>{step.code}</code>
                  </pre>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 text-sm sm:flex-row sm:gap-6">
          <div className="flex items-center gap-2 text-text-muted">
            <IconCheck className="h-4 w-4 text-green-500" />
            <span>Windows 10 or 11</span>
          </div>
          <div className="flex items-center gap-2 text-text-muted">
            <IconCheck className="h-4 w-4 text-green-500" />
            <span>macOS 12+ / Linux</span>
          </div>
          <div className="flex items-center gap-2 text-text-muted">
            <IconCheck className="h-4 w-4 text-green-500" />
            <span>API key for an LLM provider</span>
          </div>
        </div>
      </div>
    </section>
  );
}
