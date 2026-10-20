"use client";

import { useEffect, useState } from "react";
import type { Path } from "@/lib/guide/schema";
import { cx, DifficultyBadge, EvidenceBadge, OwnerBadge, safeHref } from "../badges";

const LABELS = ["Self-serve", "Easy", "Moderate", "Hard", "Gated"];

const STAGE_TONE: Record<string, string> = {
  register: "bg-zinc-400",
  configure: "bg-sky-500",
  test: "bg-violet-500",
  review: "bg-amber-500",
  live: "bg-emerald-500",
  maintain: "bg-zinc-300",
};

function useChecklist(slug: string) {
  const key = `greenlight:${slug}:done`;
  const [done, setDone] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate saved progress after mount
      if (raw) setDone(JSON.parse(raw));
    } catch {
      /* storage unavailable: progress just isn't remembered */
    }
  }, [key]);
  const toggle = (id: string) =>
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  return { done, toggle };
}

export function PathSection({
  slug,
  paths,
  recommendedPathId,
  sourceNumbers,
}: {
  slug: string;
  paths: Path[];
  recommendedPathId: string;
  sourceNumbers: Record<string, number>;
}) {
  const [activeId, setActiveId] = useState(recommendedPathId);
  const { done, toggle } = useChecklist(slug);
  const path = paths.find((p) => p.id === activeId) ?? paths[0];
  const steps = path.stages.flatMap((s) => s.steps);
  const completed = steps.filter((s) => done[`${path.id}/${s.id}`]).length;

  return (
    <div>
      {paths.length > 1 && (
        <div className="no-print mb-4 flex flex-wrap gap-2" role="group" aria-label="Access level">
          {paths.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={p.id === path.id}
              onClick={() => setActiveId(p.id)}
              className={cx(
                "rounded-lg border px-3 py-2 text-left text-sm transition",
                p.id === path.id ? "border-zinc-900 bg-zinc-900 text-white" : "border-line bg-card text-zinc-700 hover:border-zinc-400",
              )}
            >
              <div className="font-medium">
                {p.name}
                {p.id === recommendedPathId && <span className={cx("ml-1.5 text-xs", p.id === path.id ? "text-emerald-300" : "text-emerald-700")}>recommended</span>}
              </div>
              <div className={cx("text-xs", p.id === path.id ? "text-zinc-300" : "text-zinc-500")}>
                {LABELS[p.difficulty - 1]} · {p.approvalWaitDays.label} wait
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h3 className="text-lg font-semibold tracking-tight">{path.name}</h3>
            <p className="mt-1 text-sm text-zinc-700">{path.summary}</p>
            <p className="mt-2 text-sm text-zinc-600">
              <b className="font-medium text-zinc-800">You need this when:</b> {path.whenYouNeedIt}
            </p>
            {path.exampleScopes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {path.exampleScopes.map((s) => (
                  <code key={s} className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-700">
                    {s}
                  </code>
                ))}
              </div>
            )}
          </div>
          <DifficultyBadge level={path.difficulty} label={LABELS[path.difficulty - 1]} size="lg" />
        </div>

        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-zinc-50 p-3">
            <dt className="text-xs text-zinc-500">Your hands-on effort</dt>
            <dd className="mt-0.5 font-semibold">{path.handsOnEffortHours.label}</dd>
            <dd className="mt-1 text-xs text-zinc-600">{path.handsOnEffortHours.basis}</dd>
            <dd className="mt-1">
              <EvidenceBadge evidence={path.handsOnEffortHours.evidence} sourceNumbers={sourceNumbers} />
            </dd>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3">
            <dt className="text-xs text-zinc-500">Waiting on the provider</dt>
            <dd className="mt-0.5 font-semibold">{path.approvalWaitDays.label}</dd>
            <dd className="mt-1 text-xs text-zinc-600">{path.approvalWaitDays.basis}</dd>
            <dd className="mt-1">
              <EvidenceBadge evidence={path.approvalWaitDays.evidence} sourceNumbers={sourceNumbers} />
            </dd>
          </div>
          <div className="rounded-lg bg-emerald-50 p-3">
            <dt className="text-xs text-emerald-800">When you&apos;re done</dt>
            <dd className="mt-0.5 text-sm font-medium text-emerald-950">{path.endState}</dd>
          </div>
        </dl>

        <div className="no-print mt-5 flex items-center gap-3 text-xs text-zinc-600">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${steps.length ? (completed / steps.length) * 100 : 0}%` }} />
          </div>
          {completed}/{steps.length} steps done <span className="text-zinc-400">(saved in this browser)</span>
        </div>

        <ol className="mt-5 space-y-6">
          {path.stages.map((stage, i) => (
            <li key={stage.id} className="relative pl-7">
              <span className={cx("absolute left-0 top-1 grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white", STAGE_TONE[stage.kind])}>{i + 1}</span>
              {i < path.stages.length - 1 && <span className="absolute left-[9px] top-7 h-[calc(100%-0.5rem)] w-px bg-line" aria-hidden />}
              <div className="flex flex-wrap items-baseline gap-2">
                <h4 className="font-semibold">{stage.name}</h4>
                <span className="text-xs uppercase tracking-wide text-zinc-400">{stage.kind}</span>
              </div>
              <p className="mt-1 rounded-md bg-violet-50/60 px-2.5 py-1.5 text-sm text-violet-950">
                <b className="font-medium">Who can connect:</b> {stage.access}
              </p>
              <ul className="mt-3 space-y-3">
                {stage.steps.map((step) => {
                  const id = `${path.id}/${step.id}`;
                  return (
                    <li key={step.id} className="flex gap-3">
                      <input
                        type="checkbox"
                        checked={Boolean(done[id])}
                        onChange={() => toggle(id)}
                        className="mt-1 h-4 w-4 shrink-0 accent-emerald-600"
                        aria-label={`Mark "${step.title}" done`}
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cx("font-medium", done[id] && "text-zinc-400 line-through")}>{step.title}</span>
                          <OwnerBadge owner={step.owner} />
                          <span className="text-xs text-zinc-500">{step.duration}</span>
                          <EvidenceBadge evidence={step.evidence} sourceNumbers={sourceNumbers} />
                        </div>
                        <p className="mt-1 text-sm text-zinc-700">{step.detail}</p>
                        {step.agentAssist && (
                          <p className="mt-1.5 text-sm text-violet-900">
                            <span aria-hidden>🤖 </span>
                            <b className="font-medium">Agent can help:</b> {step.agentAssist}
                          </p>
                        )}
                        {safeHref(step.url) && (
                          <a href={safeHref(step.url)} target="_blank" rel="noreferrer" className="mt-1 inline-block break-all text-xs text-blue-700 hover:underline">
                            {step.url}
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
