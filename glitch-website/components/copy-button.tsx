"use client";

import { useState } from "react";
import { IconCopy, IconCheck } from "@/components/icons";

export function CopyButton({
  text,
  label = "Copy",
  className = "",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        /* noop */
      }
      document.body.removeChild(textarea);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted transition-colors hover:bg-bg-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
      aria-label={copied ? "Copied" : label}
    >
      {copied ? (
        <>
          <IconCheck className="h-3 w-3 text-green-500" />
          <span className="text-green-500">Copied</span>
        </>
      ) : (
        <>
          <IconCopy className="h-3 w-3" />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}
