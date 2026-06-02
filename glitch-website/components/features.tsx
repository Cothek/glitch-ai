import { IconBrain, IconSparkles, IconUsers, IconMic } from "@/components/icons";

const FEATURES = [
  {
    icon: IconBrain,
    title: "Memory that persists",
    body: "Glitch remembers your conversations, decisions, and projects across sessions. Start a task today, pick it up tomorrow with full context. No cold starts.",
    accent: "purple" as const,
  },
  {
    icon: IconSparkles,
    title: "Skills that adapt",
    body: "20+ built-in skills — code review, testing, brainstorming, design, debugging. Glitch picks the right one for each task, or you can add your own.",
    accent: "cyan" as const,
  },
  {
    icon: IconUsers,
    title: "Agents that delegate",
    body: "Glitch orchestrates specialized sub-agents — coder, reviewer, UI designer, tester — in parallel. You give the task. It handles the workflow.",
    accent: "purple" as const,
  },
  {
    icon: IconMic,
    title: "Voice or text",
    body: "Push-to-talk with Handy offline voice-to-text. Speak your prompts hands-free, or type. Glitch adapts to how you work best.",
    accent: "cyan" as const,
  },
];

const ACCENT_CLASS = {
  purple: "text-accent bg-accent-soft border-accent/20",
  cyan: "text-cyan bg-cyan-soft border-cyan/20",
};

export function Features() {
  return (
    <section id="features" className="border-b border-border py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <header className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">What makes Glitch different</p>
          <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            Not another chatbot. A companion that grows with you.
          </h2>
          <p className="mt-4 text-text-muted">
            Most AI tools forget everything between sessions. Glitch is built on the opposite idea: memory, context, and continuity are the product.
          </p>
        </header>

        <ul className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <li
                key={f.title}
                className="hover-lift group relative rounded-lg border border-border bg-bg-elevated/40 p-5"
              >
                <div
                  className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-md border ${ACCENT_CLASS[f.accent]}`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-muted">{f.body}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
