"use client";

import { useState } from "react";
import { useGenerate } from "./useGenerate";

const EXAMPLES = ["Gmail", "Spotify", "zoom.us", "Calendly", "Xero"];

export function LookupBox() {
  const [query, setQuery] = useState("");
  const { start, pending, error } = useGenerate();

  return (
    <div className="w-full max-w-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) start(query.trim());
        }}
        className="flex gap-2 rounded-xl border border-line bg-card p-1.5 shadow-sm focus-within:ring-2 focus-within:ring-emerald-500/30"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="App name or website, e.g. HubSpot or hubspot.com"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-base outline-none placeholder:text-zinc-400"
          aria-label="App name or website"
          maxLength={200}
        />
        <button
          type="submit"
          disabled={!query.trim() || pending !== null}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40"
        >
          {pending ? "Starting…" : "Get the guide"}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span>Try</span>
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => start(ex)} disabled={pending !== null} className="rounded-full border border-line bg-card px-2 py-0.5 hover:border-zinc-400 hover:text-zinc-800">
            {ex}
          </button>
        ))}
        <span>· apps without a guide are researched live by the agent (about 3–4 minutes)</span>
      </div>
      {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
    </div>
  );
}
