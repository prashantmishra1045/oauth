"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CatalogApp } from "@/lib/catalog";
import { DifficultyBadge, ManagedBadge } from "./badges";
import { useGenerate } from "./useGenerate";

export interface GuideInfo {
  difficulty: number;
  label: string;
  effort: string;
  wait: string;
}

export function LibraryBrowser({ apps, guides }: { apps: CatalogApp[]; guides: Record<string, GuideInfo> }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [composio, setComposio] = useState("all");
  const [status, setStatus] = useState("all");
  const { start, pending, error } = useGenerate();

  const categories = useMemo(() => [...new Set(apps.map((a) => a.category))].sort(), [apps]);
  const rows = apps.filter((a) => {
    if (q && !`${a.name} ${a.website} ${a.providerPlatform}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (category !== "all" && a.category !== category) return false;
    if (composio !== "all" && a.composioManaged !== composio) return false;
    if (status === "ready" && !guides[a.slug]) return false;
    if (status === "todo" && guides[a.slug]) return false;
    return true;
  });

  const select = "rounded-lg border border-line bg-card px-2 py-1.5 text-sm";
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter apps" className={`${select} min-w-48 flex-1`} aria-label="Filter apps" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={select} aria-label="Category">
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select value={composio} onChange={(e) => setComposio(e.target.value)} className={select} aria-label="Composio">
          <option value="all">Composio: any</option>
          <option value="yes">Managed app available</option>
          <option value="no">Bring your own</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={select} aria-label="Guide status">
          <option value="all">All guides</option>
          <option value="ready">Ready to read</option>
          <option value="todo">Generate on demand</option>
        </select>
      </div>
      {error && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">App</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">OAuth platform</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">Composio</th>
              <th className="px-3 py-2 font-medium">Guide</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const g = guides[a.slug];
              return (
                <tr key={a.slug} className="border-b border-line/70 last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-zinc-500">{a.category}</div>
                  </td>
                  <td className="hidden px-3 py-2 text-zinc-600 md:table-cell">{a.providerPlatform}</td>
                  <td className="hidden px-3 py-2 sm:table-cell">
                    <ManagedBadge managed={a.composioManaged} />
                  </td>
                  <td className="px-3 py-2">
                    {g ? (
                      <Link href={`/guides/${a.slug}`} className="group inline-flex flex-wrap items-center gap-2">
                        <DifficultyBadge level={g.difficulty} label={g.label} />
                        <span className="text-xs text-zinc-500 group-hover:text-zinc-900">
                          {g.effort} · wait {g.wait} →
                        </span>
                      </Link>
                    ) : (
                      <button
                        onClick={() => start(a.name)}
                        disabled={pending !== null}
                        className="rounded-md border border-line px-2 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-400 disabled:opacity-40"
                      >
                        {pending === a.name ? "Starting…" : "Generate live"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                  No apps match. Type the name in the box above and the agent will research it.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
