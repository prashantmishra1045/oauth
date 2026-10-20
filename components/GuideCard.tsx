import Link from "next/link";
import type { CardInfo } from "@/lib/guide/summary";
import { DifficultyBadge, ManagedBadge, VerificationPill } from "./badges";

export function GuideCard({ c }: { c: CardInfo }) {
  return (
    <Link
      href={`/guides/${c.slug}`}
      className="group flex flex-col rounded-xl border border-line bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold tracking-tight">{c.name}</div>
          <div className="text-xs text-zinc-500">{c.platform}</div>
        </div>
        <DifficultyBadge level={c.difficulty} label={c.label} />
      </div>
      <p className="mt-3 line-clamp-3 text-sm text-zinc-700">{c.headline}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-zinc-50 p-2">
          <dt className="text-zinc-500">Hands-on</dt>
          <dd className="font-medium">{c.effort}</dd>
        </div>
        <div className="rounded-lg bg-zinc-50 p-2">
          <dt className="text-zinc-500">Provider wait</dt>
          <dd className="font-medium">{c.wait}</dd>
        </div>
      </dl>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
        <ManagedBadge managed={c.managed} />
        <VerificationPill status={c.verification} />
      </div>
    </Link>
  );
}
