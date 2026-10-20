"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="no-print rounded-md border border-line bg-card px-2 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-400"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function ShareBar({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const btn = "rounded-lg border border-line bg-card px-3 py-1.5 text-sm font-medium text-zinc-700 hover:border-zinc-400";
  return (
    <div className="no-print flex flex-wrap gap-2">
      <button
        type="button"
        className={btn}
        onClick={async () => {
          await navigator.clipboard.writeText(window.location.href.split("#")[0]);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Link copied" : "Copy link"}
      </button>
      <a className={btn} href={`/api/guides/${slug}?format=md`}>
        Download Markdown
      </a>
      <button type="button" className={btn} onClick={() => window.print()}>
        Print / PDF
      </button>
    </div>
  );
}
