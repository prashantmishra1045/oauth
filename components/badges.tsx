import type { Evidence } from "@/lib/guide/schema";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/** Guide URLs come from model output and web pages; only http(s) links are ever rendered as links. */
export function safeHref(url: string | undefined | null): string | undefined {
  return url && /^https?:\/\//i.test(url.trim()) ? url.trim() : undefined;
}

export const DIFFICULTY_STYLE: Record<number, { pill: string; bar: string; text: string }> = {
  1: { pill: "bg-emerald-50 text-emerald-800 ring-emerald-200", bar: "bg-emerald-500", text: "text-emerald-700" },
  2: { pill: "bg-teal-50 text-teal-800 ring-teal-200", bar: "bg-teal-500", text: "text-teal-700" },
  3: { pill: "bg-amber-50 text-amber-800 ring-amber-200", bar: "bg-amber-500", text: "text-amber-700" },
  4: { pill: "bg-orange-50 text-orange-800 ring-orange-200", bar: "bg-orange-500", text: "text-orange-700" },
  5: { pill: "bg-rose-50 text-rose-800 ring-rose-200", bar: "bg-rose-500", text: "text-rose-700" },
};

export function DifficultyBadge({ level, label, size = "sm" }: { level: number; label: string; size?: "sm" | "lg" }) {
  const s = DIFFICULTY_STYLE[level] ?? DIFFICULTY_STYLE[3];
  return (
    <span
      className={cx("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-medium ring-1 ring-inset", s.pill, size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs")}
      title={`Difficulty ${level} of 5`}
    >
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={cx("h-1.5 w-1.5 rounded-full", i <= level ? s.bar : "bg-zinc-300/70")} />
        ))}
      </span>
      {label}
    </span>
  );
}

const OWNER = {
  agent: { label: "Agent", icon: "🤖", cls: "bg-violet-50 text-violet-800 ring-violet-200", title: "An agent can do or prepare this" },
  developer: { label: "You", icon: "👤", cls: "bg-sky-50 text-sky-800 ring-sky-200", title: "A human has to do this" },
  provider: { label: "Provider", icon: "⏳", cls: "bg-amber-50 text-amber-900 ring-amber-200", title: "Waiting on the provider" },
} as const;

export function OwnerBadge({ owner }: { owner: keyof typeof OWNER }) {
  const o = OWNER[owner];
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", o.cls)} title={o.title}>
      <span aria-hidden>{o.icon}</span>
      {o.label}
    </span>
  );
}

const EVIDENCE = {
  tested: { label: "Tested", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200", dot: "bg-emerald-500", help: "An agent probe observed this during research" },
  documented: { label: "Documented", cls: "bg-blue-50 text-blue-800 ring-blue-200", dot: "bg-blue-500", help: "Stated in official provider documentation" },
  reported: { label: "Reported", cls: "bg-amber-50 text-amber-900 ring-amber-200", dot: "bg-amber-500", help: "From community or third-party sources, not official" },
  inferred: { label: "Inferred", cls: "bg-zinc-100 text-zinc-700 ring-zinc-200", dot: "bg-zinc-400", help: "Reasoned from other facts; no direct source" },
} as const;

/** sourceNumbers maps source id -> its 1-based number in the Sources list (a plain object so client components can receive it). */
export function EvidenceBadge({ evidence, sourceNumbers }: { evidence: Evidence; sourceNumbers: Record<string, number> }) {
  const e = EVIDENCE[evidence.kind];
  const refs = evidence.sourceIds.filter((id) => id in sourceNumbers);
  const tip = `${e.label} · ${evidence.confidence} confidence — ${e.help}${evidence.note ? `\n${evidence.note}` : ""}`;
  return (
    <span className="inline-flex shrink-0 flex-wrap items-center gap-1 align-middle">
      <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", e.cls)} title={tip}>
        <span className={cx("h-1.5 w-1.5 rounded-full", e.dot)} aria-hidden />
        {e.label}
        {evidence.confidence !== "high" && <span className="font-normal opacity-75">· {evidence.confidence}</span>}
      </span>
      {refs.map((id) => (
        <a key={id} href={`#src-${id}`} className="text-[11px] font-medium text-zinc-500 hover:text-zinc-900" title="Jump to source">
          [{sourceNumbers[id]}]
        </a>
      ))}
    </span>
  );
}

export function EvidenceLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-zinc-600">
      {Object.entries(EVIDENCE).map(([k, e]) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className={cx("h-2 w-2 rounded-full", e.dot)} aria-hidden />
          <b className="font-medium text-zinc-800">{e.label}</b> {e.help.toLowerCase()}
        </span>
      ))}
    </div>
  );
}

export function ManagedBadge({ managed }: { managed: "yes" | "no" | "unknown" }) {
  const map = {
    yes: { t: "Composio-managed app available", c: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
    no: { t: "Bring your own OAuth app", c: "bg-zinc-100 text-zinc-700 ring-zinc-200" },
    unknown: { t: "Composio status unknown", c: "bg-zinc-50 text-zinc-500 ring-zinc-200" },
  }[managed];
  return <span className={cx("inline-flex shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", map.c)}>{map.t}</span>;
}

const VERDICT = {
  supported: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  corrected: "bg-blue-50 text-blue-800 ring-blue-200",
  downgraded: "bg-amber-50 text-amber-900 ring-amber-200",
  unverifiable: "bg-zinc-100 text-zinc-700 ring-zinc-200",
} as const;

export function VerdictBadge({ verdict }: { verdict: keyof typeof VERDICT }) {
  return <span className={cx("inline-flex shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset", VERDICT[verdict])}>{verdict}</span>;
}

const STATUS = {
  verified: { t: "Fact-checked", c: "bg-emerald-600 text-white" },
  partial: { t: "Partly fact-checked", c: "bg-amber-500 text-white" },
  unverified: { t: "Not fact-checked", c: "bg-zinc-500 text-white" },
} as const;

export function VerificationPill({ status }: { status: keyof typeof STATUS }) {
  const s = STATUS[status];
  return <span className={cx("inline-flex shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", s.c)}>{s.t}</span>;
}
