// Reusable terminal frame.

import type { ReactNode } from "react";

export function Terminal({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`terminal-frame ${className}`}>
      <div className="terminal-header">
        <span className="terminal-dot red" aria-hidden />
        <span className="terminal-dot yellow" aria-hidden />
        <span className="terminal-dot green" aria-hidden />
        {title && <span className="ml-2">{title}</span>}
      </div>
      <div className="terminal-body">{children}</div>
    </div>
  );
}

export function TerminalLine({ children }: { children: ReactNode }) {
  return <div className="whitespace-pre-wrap">{children}</div>;
}

export function TerminalPrompt({
  children,
  user = false,
}: {
  children?: ReactNode;
  user?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="prompt-symbol">$</span>
      <span className={user ? "prompt-text" : "prompt-cmd"}>{children ?? "glitch"}</span>
    </div>
  );
}
