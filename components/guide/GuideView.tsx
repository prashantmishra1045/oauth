import type { Guide } from "@/lib/guide/schema";
import { beforeApproval, recommendedPath } from "@/lib/guide/summary";
import { cx, DifficultyBadge, EvidenceBadge, EvidenceLegend, ManagedBadge, safeHref, VerdictBadge, VerificationPill } from "../badges";
import { CopyButton, ShareBar } from "./CopyButton";
import { PathSection } from "./PathSection";

const SECTIONS = [
  ["paths", "Step by step"],
  ["agent", "Agent vs. you"],
  ["requirements", "Requirements"],
  ["nuances", "Nuances"],
  ["blockers", "Blockers"],
  ["artifacts", "Prepared drafts"],
  ["oauth", "OAuth details"],
  ["tested", "What we tested"],
  ["verification", "Fact-check"],
  ["sources", "Sources"],
] as const;

const IMPACT = { high: "bg-rose-500", medium: "bg-amber-500", low: "bg-zinc-300" } as const;
const CATEGORY_LABEL: Record<string, string> = {
  account: "Account",
  legal: "Legal",
  domain: "Domain",
  branding: "Branding",
  security: "Security",
  business: "Business",
  technical: "Technical",
  cost: "Cost",
};

function Section({ id, title, children, hint }: { id: string; title: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <section id={id} className="mt-12">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {hint}
      </div>
      {children}
    </section>
  );
}

export function GuideView({ guide: g, source }: { guide: Guide; source: "library" | "live" }) {
  const sourceNumbers: Record<string, number> = Object.fromEntries(g.sources.map((s, i) => [s.id, i + 1]));
  const rec = recommendedPath(g);
  const pathName = new Map(g.paths.map((p) => [p.id, p.name]));
  const counts = g.verification.entries.reduce<Record<string, number>>((acc, e) => ((acc[e.verdict] = (acc[e.verdict] ?? 0) + 1), acc), {});

  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-8 lg:grid-cols-[1fr_200px]">
      <article className="min-w-0">
        {g.openQuestions[0]?.startsWith("REPLAY MODE") && (
          <p className="mb-4 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">{g.openQuestions[0]}</p>
        )}
        <header>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>{g.app.category}</span>
            <span>·</span>
            <span>OAuth via {g.provider.name}</span>
            <span>·</span>
            <span>{source === "library" ? "Library guide" : "Generated live by the agent"}</span>
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">{g.app.name}: getting your OAuth app ready</h1>
          <p className="mt-3 max-w-3xl text-lg text-zinc-800">{g.summary.headline}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <DifficultyBadge level={g.summary.difficulty} label={g.summary.difficultyLabel} size="lg" />
            <VerificationPill status={g.verification.status} />
            <ManagedBadge managed={g.composio.managed} />
          </div>
        </header>

        <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Hands-on effort" value={rec.handsOnEffortHours.label} sub={`on the ${rec.name} path`} />
          <Tile label="Waiting on the provider" value={rec.approvalWaitDays.label} sub={rec.approvalWaitDays.evidence.kind === "reported" ? "community-reported" : rec.approvalWaitDays.evidence.kind} />
          <Tile label="Before approval" value={beforeApproval(g)} small />
          <Tile label="Composio" value={g.composio.managed === "yes" ? "Managed app available" : g.composio.managed === "no" ? "Bring your own app" : "Unknown"} sub={g.composio.toolkitSlug ? `toolkit ${g.composio.toolkitSlug}` : undefined} />
        </dl>

        <div className="mt-6 grid gap-4 md:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="text-zinc-700">{g.summary.overview}</p>
            {g.summary.drivers.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {g.summary.drivers.map((d) => (
                  <span key={d} className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700">
                    {d}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2 text-sm">
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-950">
              <b className="font-medium">Best case:</b> {g.summary.bestCase}
            </p>
            <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-950">
              <b className="font-medium">Worst case:</b> {g.summary.worstCase}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card p-3">
          <ShareBar slug={g.slug} />
          <span className="text-xs text-zinc-500">
            Researched {g.meta.generatedAt.slice(0, 10)} · last checked {(g.verification.checkedAt || g.meta.lastReviewedAt).slice(0, 10)}
          </span>
        </div>

        <Section id="paths" title="Step by step" hint={<EvidenceLegend />}>
          <PathSection slug={g.slug} paths={g.paths} recommendedPathId={g.recommendedPathId} sourceNumbers={sourceNumbers} />
        </Section>

        <Section id="agent" title="What an agent can do vs. what you must do">
          <div className="grid gap-4 md:grid-cols-2">
            <List title="🤖 An agent can" items={g.agentVsYou.agentCan} tone="border-violet-200 bg-violet-50/50" />
            <List title="👤 You must" items={g.agentVsYou.youMust} tone="border-sky-200 bg-sky-50/50" />
          </div>
        </Section>

        <Section id="requirements" title="Requirements">
          <ul className="divide-y divide-line rounded-xl border border-line bg-card">
            {g.requirements.map((r) => (
              <li key={r.id} className="flex gap-3 p-3">
                <span className="mt-0.5 w-20 shrink-0 text-xs font-medium uppercase tracking-wide text-zinc-500">{CATEGORY_LABEL[r.category]}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{r.title}</span>
                    {!r.mandatory && <span className="rounded bg-zinc-100 px-1.5 text-[11px] text-zinc-600">optional</span>}
                    {r.pathIds.length > 0 && <span className="text-[11px] text-zinc-500">only for: {r.pathIds.map((id) => pathName.get(id)).join(", ")}</span>}
                    <EvidenceBadge evidence={r.evidence} sourceNumbers={sourceNumbers} />
                  </div>
                  <p className="mt-0.5 text-sm text-zinc-700">{r.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="nuances" title="Nuances that could affect your setup">
          <ul className="grid gap-3 md:grid-cols-2">
            {[...g.nuances]
              .sort((a, b) => ["high", "medium", "low"].indexOf(a.impact) - ["high", "medium", "low"].indexOf(b.impact))
              .map((n) => (
                <li key={n.id} className="rounded-xl border border-line bg-card p-3">
                  <div className="flex items-center gap-2">
                    <span className={cx("h-2 w-2 shrink-0 rounded-full", IMPACT[n.impact])} title={`${n.impact} impact`} />
                    <span className="font-medium">{n.title}</span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-700">{n.detail}</p>
                  <div className="mt-1.5">
                    <EvidenceBadge evidence={n.evidence} sourceNumbers={sourceNumbers} />
                  </div>
                </li>
              ))}
          </ul>
        </Section>

        <Section id="blockers" title="If you get blocked">
          <div className="space-y-3">
            {g.blockers.map((b) => (
              <details key={b.id} className="group rounded-xl border border-line bg-card p-3 open:shadow-sm">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-2">
                  <span>
                    <span className="font-medium">{b.title}</span>
                    <span className="block text-sm text-zinc-600">{b.symptom}</span>
                  </span>
                  <span className="text-zinc-400 transition group-open:rotate-90">›</span>
                </summary>
                <dl className="mt-3 space-y-2 text-sm">
                  <div>
                    <dt className="font-medium text-zinc-500">Why it happens</dt>
                    <dd className="text-zinc-800">{b.cause}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-emerald-700">How to proceed</dt>
                    <dd className="text-zinc-800">{b.resolution}</dd>
                  </div>
                  {b.escalation && (
                    <div>
                      <dt className="font-medium text-zinc-500">Where to escalate</dt>
                      <dd className="text-zinc-800">{b.escalation}</dd>
                    </div>
                  )}
                  <dd>
                    <EvidenceBadge evidence={b.evidence} sourceNumbers={sourceNumbers} />
                  </dd>
                </dl>
              </details>
            ))}
          </div>
        </Section>

        {g.artifacts.length > 0 && (
          <Section id="artifacts" title="Drafts the agent prepared for you">
            <div className="space-y-4">
              {g.artifacts.map((a) => (
                <div key={a.id} className="rounded-xl border border-violet-200 bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-100 px-4 py-2.5">
                    <div>
                      <div className="font-medium">{a.title}</div>
                      <div className="text-xs text-zinc-600">{a.howToUse}</div>
                    </div>
                    <CopyButton text={a.content} />
                  </div>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed text-zinc-800">{a.content}</pre>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section id="oauth" title="OAuth details" hint={<EvidenceBadge evidence={g.oauth.evidence} sourceNumbers={sourceNumbers} />}>
          <div className="overflow-hidden rounded-xl border border-line bg-card">
            <table className="w-full table-fixed text-sm">
              <tbody className="divide-y divide-line">
                {(
                  [
                    ["Authorization URL", g.oauth.authorizationUrl, true],
                    ["Token URL", g.oauth.tokenUrl, true],
                    ["PKCE", g.oauth.pkce.replace("_", " "), false],
                    ["Refresh tokens", g.oauth.refreshTokens, false],
                    ["Token lifetime", g.oauth.tokenLifetime, false],
                    ["Redirect URIs", g.oauth.redirectUris, false],
                    ["Scopes", g.oauth.scopes, false],
                    ["Dynamic client registration", g.oauth.dynamicClientRegistration, false],
                    ["Composio", g.composio.note, false],
                  ] as const
                ).map(([k, v, mono]) => (
                  <tr key={k}>
                    <th className="w-32 bg-zinc-50 px-3 py-2 text-left align-top text-xs font-medium text-zinc-600 sm:w-44">{k}</th>
                    <td className={cx("px-3 py-2 text-zinc-800", mono && "break-all font-mono text-xs")}>{v || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="tested" title="What the agent tested" hint={<span className="text-xs text-zinc-500">Read-only probes, no credentials</span>}>
          {g.probes.length === 0 ? (
            <p className="text-sm text-zinc-600">No probes were run for this guide.</p>
          ) : (
            <ul className="space-y-2">
              {g.probes.map((p) => (
                <li key={p.id} className="rounded-xl border border-line bg-card p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <span
                      className={cx(
                        "rounded px-1.5 text-[11px] font-medium",
                        p.outcome === "confirmed" ? "bg-emerald-100 text-emerald-800" : p.outcome === "contradicted" ? "bg-rose-100 text-rose-800" : "bg-zinc-100 text-zinc-700",
                      )}
                    >
                      {p.outcome}
                    </span>
                    <span className="text-xs text-zinc-500">{p.ranAt.slice(0, 16).replace("T", " ")} UTC</span>
                  </div>
                  <code className="mt-1.5 block break-all rounded bg-zinc-50 px-2 py-1 font-mono text-[11px] text-zinc-700">{p.request}</code>
                  <p className="mt-1 break-words font-mono text-[11px] text-zinc-600">→ {p.observed}</p>
                  <p className="mt-1 text-zinc-800">{p.conclusion}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="verification" title="Fact-check" hint={<VerificationPill status={g.verification.status} />}>
          <p className="text-sm text-zinc-700">{g.verification.summary}</p>
          {g.verification.entries.length > 0 && (
            <>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-600">
                {(["supported", "corrected", "downgraded", "unverifiable"] as const).map((v) => (
                  <span key={v} className="inline-flex items-center gap-1">
                    <VerdictBadge verdict={v} /> {counts[v] ?? 0}
                  </span>
                ))}
              </div>
              <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-card text-sm">
                {g.verification.entries.map((e) => (
                  <li key={e.id} className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <VerdictBadge verdict={e.verdict} />
                      <span className="text-zinc-800">{e.claim}</span>
                    </div>
                    {e.after && (
                      <p className="mt-1 text-xs">
                        <span className="text-zinc-500 line-through">{e.before}</span> <span className="text-blue-800">→ {e.after}</span>
                      </p>
                    )}
                    {e.note && <p className="mt-1 text-xs text-zinc-600">{e.note}</p>}
                    {e.sourceIds.length > 0 && (
                      <p className="mt-1 text-[11px] text-zinc-500">
                        checked against{" "}
                        {e.sourceIds.map((id) => (
                          <a key={id} href={`#src-${id}`} className="mr-1 hover:text-zinc-900">
                            [{sourceNumbers[id] ?? "?"}]
                          </a>
                        ))}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {g.openQuestions.filter((q) => !q.startsWith("REPLAY MODE")).length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <h3 className="font-medium text-amber-950">What we could not verify</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-amber-950">
                {g.openQuestions
                  .filter((q) => !q.startsWith("REPLAY MODE"))
                  .map((q) => (
                    <li key={q}>{q}</li>
                  ))}
              </ul>
            </div>
          )}
        </Section>

        <Section id="sources" title="Sources">
          <ol className="space-y-2 text-sm">
            {g.sources.map((s, i) => (
              <li key={s.id} id={`src-${s.id}`} className="flex gap-2 p-1">
                <span className="w-6 shrink-0 text-right text-zinc-400">{i + 1}.</span>
                <div className="min-w-0">
                  {safeHref(s.url) ? (
                    <a href={safeHref(s.url)} target="_blank" rel="noreferrer" className="font-medium text-blue-800 hover:underline">
                      {s.title}
                    </a>
                  ) : (
                    <span className="font-medium">{s.title}</span>
                  )}{" "}
                  <span className="text-xs text-zinc-500">
                    {s.publisher} · accessed {s.accessedAt}
                  </span>
                  <div className="break-all text-xs text-zinc-500">{s.url}</div>
                  {s.excerpt && <blockquote className="mt-1 border-l-2 border-line pl-2 text-xs italic text-zinc-600">“{s.excerpt}”</blockquote>}
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-xs text-zinc-500">
            Generated by {g.meta.generatedBy === "library" ? "the library research agents" : "the live agent"} ({g.meta.model}) in {Math.round(g.meta.durationSec / 60) || "<1"} min.
          </p>
        </Section>
      </article>

      <aside className="no-print hidden lg:block">
        <nav className="sticky top-20 space-y-1 text-sm">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">On this page</div>
          {SECTIONS.filter(([id]) => id !== "artifacts" || g.artifacts.length > 0).map(([id, label]) => (
            <a key={id} href={`#${id}`} className="block rounded px-2 py-1 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900">
              {label}
            </a>
          ))}
        </nav>
      </aside>
    </div>
  );
}

function Tile({ label, value, sub, small }: { label: string; value: string; sub?: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-card p-3">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={cx("mt-0.5 font-semibold", small ? "line-clamp-4 text-sm font-medium" : "text-base")}>{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-zinc-500">{sub}</dd>}
    </div>
  );
}

function List({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return (
    <div className={cx("rounded-xl border p-4", tone)}>
      <h3 className="font-medium">{title}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-800">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
