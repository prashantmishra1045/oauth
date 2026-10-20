"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { JobEvent } from "@/lib/agent/types";
import { cx, safeHref } from "./badges";

interface JobView {
  id: string;
  query: string;
  status: "running" | "done" | "failed";
  stage: string;
  stageIndex: number;
  createdAt: string;
  updatedAt: string;
  appName: string | null;
  guideSlug: string | null;
  followJobId: string | null;
  factCheck: "verified" | "partial" | "unverified" | null;
  error: string | null;
  replay: boolean;
  usage: { webSearches: number; webFetches: number };
  probes: number;
  durable: boolean;
}

const STEPS = [
  { key: "resolve", label: "Identify the app" },
  { key: "research", label: "Read docs & probe endpoints" },
  { key: "draft", label: "Write the guide" },
  { key: "verify", label: "Fact-check claims" },
  { key: "finalize", label: "Publish" },
];
const VERIFY_STEP = 3;

const ICON: Record<JobEvent["kind"], string> = {
  stage: "▸",
  search: "🔎",
  fetch: "📄",
  probe: "🧪",
  note: "💭",
  finding: "📌",
  check: "✔︎",
  warn: "⚠️",
  error: "✖",
  done: "✅",
};

type StepState = "done" | "active" | "failed" | "skipped" | "partial" | "todo";

export function JobFeed({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [job, setJob] = useState<JobView | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const cursor = useRef(0);
  const log = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let notFound = 0;
    let first = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}?after=${cursor.current}`, { cache: "no-store" });
        if (res.status === 404) {
          // A few 404s are tolerated (a non-shared dev store can briefly miss a fresh job).
          if (++notFound >= 3) return setMissing(true);
          throw new Error("Waiting for the job to appear…");
        }
        if (!res.ok) throw new Error(`Status check failed (${res.status}).`);
        notFound = 0;
        const body = (await res.json()) as { job: JobView; events: JobEvent[] };
        if (stopped) return;
        setJob(body.job);
        setError(null);
        if (body.events.length) {
          cursor.current = body.events[body.events.length - 1].seq + 1;
          setEvents((prev) => [...prev, ...body.events]);
        }
        if (body.job.followJobId) return router.replace(`/generate/${body.job.followJobId}`);
        if (body.job.status === "done" && body.job.guideSlug) {
          // Only auto-open when the job finished while this page watched it; replace so Back skips the feed.
          if (!first) timer = setTimeout(() => router.replace(`/guides/${body.job.guideSlug}`), 2500);
          return;
        }
        if (body.job.status === "failed") return;
      } catch (err) {
        if (!stopped) setError((err as Error).message);
      } finally {
        first = false;
      }
      if (!stopped) timer = setTimeout(poll, 1200);
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId, router]);

  const running = job?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    // Follow new rows only while the reader is at the bottom of the log; never scroll the page.
    const el = log.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  if (missing) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">This generation job doesn&apos;t exist</h1>
        <p className="mt-2 text-zinc-600">The link may be wrong, or the job expired (jobs are kept for 14 days; the guides they produced are kept).</p>
        <Link href="/" className="mt-4 inline-block font-medium text-emerald-700 hover:underline">
          ← Back to the library
        </Link>
      </div>
    );
  }

  const end = job && job.status !== "running" ? Date.parse(job.updatedAt) : now;
  const elapsed = job ? Math.max(0, Math.round((end - Date.parse(job.createdAt)) / 1000)) : 0;

  const stepState = (i: number): StepState => {
    if (!job) return i === 0 ? "active" : "todo";
    if (job.status === "running") return i < job.stageIndex ? "done" : i === job.stageIndex ? "active" : "todo";
    if (job.status === "failed") return i < job.stageIndex ? "done" : i === job.stageIndex ? "failed" : "todo";
    // done: a job can end early (guide already existed), and the fact-check can end without checking anything
    if (i > job.stageIndex) return "skipped";
    if (i === VERIFY_STEP && job.factCheck === "unverified") return "skipped";
    if (i === VERIFY_STEP && job.factCheck === "partial") return "partial";
    return "done";
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <p className="text-sm font-medium text-emerald-700">Live agent</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">
        {job?.status === "done" ? "Researched" : job?.status === "failed" ? "Could not finish" : "Researching"} {job?.appName ?? job?.query ?? "…"}
      </h1>
      <p className="mt-2 text-zinc-600">
        The agent reads the provider&apos;s documentation, probes its OAuth endpoints, writes a guide, then fact-checks the guide&apos;s key claims against the sources.
        This usually takes 3–4 minutes; you can leave this page and come back with the same link.
      </p>
      {job?.replay && (
        <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
          Replay mode: no API key is configured, so this run replays a library guide to demonstrate the flow.
        </p>
      )}
      {job && !job.durable && <p className="mt-3 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600">Local file store in use: progress is kept on this server only.</p>}

      <ol className="mt-6 grid gap-2 sm:grid-cols-5">
        {STEPS.map((s, i) => {
          const st = stepState(i);
          return (
            <li
              key={s.key}
              className={cx(
                "rounded-lg border px-3 py-2 text-xs",
                st === "done" && "border-emerald-200 bg-emerald-50 text-emerald-900",
                st === "partial" && "border-amber-200 bg-amber-50 text-amber-900",
                st === "active" && "border-zinc-900 bg-white font-medium text-zinc-900 shadow-sm",
                st === "failed" && "border-rose-300 bg-rose-50 text-rose-900",
                (st === "todo" || st === "skipped") && "border-line bg-card text-zinc-400",
              )}
            >
              <div className="flex items-center gap-1.5">
                {st === "done" ? (
                  <span>✓</span>
                ) : st === "active" ? (
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                ) : st === "failed" ? (
                  <span>✖</span>
                ) : st === "skipped" ? (
                  <span>–</span>
                ) : st === "partial" ? (
                  <span>◐</span>
                ) : (
                  <span>{i + 1}</span>
                )}
                <span>{s.label}</span>
              </div>
              {st === "skipped" && i === VERIFY_STEP && <div className="mt-0.5 text-[10px]">not completed</div>}
              {st === "partial" && <div className="mt-0.5 text-[10px]">partly checked</div>}
            </li>
          );
        })}
      </ol>

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-500">
        <span>
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} {running ? "elapsed" : "total"}
        </span>
        {job && (
          <>
            <span>{job.usage.webSearches} searches</span>
            <span>{job.usage.webFetches} pages read</span>
            <span>{job.probes} probes</span>
          </>
        )}
      </div>

      <div
        ref={log}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="mt-4 max-h-[55vh] overflow-y-auto rounded-xl border border-line bg-card p-2"
        aria-live="polite"
      >
        {events.length === 0 && <p className="p-3 text-sm text-zinc-500">Starting…</p>}
        <ul className="space-y-0.5">
          {events.map((e) => (
            <li
              key={e.seq}
              className={cx(
                "flex gap-2 rounded-md px-2 py-1.5 text-sm",
                e.kind === "stage" && "mt-2 bg-zinc-50 font-medium",
                e.kind === "error" && "bg-rose-50 text-rose-900",
                e.kind === "warn" && "text-amber-900",
              )}
            >
              <span className="w-5 shrink-0 text-center" aria-hidden>
                {ICON[e.kind]}
              </span>
              <div className="min-w-0">
                <div className={cx("break-words", e.kind === "note" && "italic text-zinc-600")}>
                  {safeHref(e.url) && e.kind === "fetch" ? (
                    <>
                      Reading{" "}
                      <a href={safeHref(e.url)} target="_blank" rel="noreferrer" className="break-all text-blue-800 hover:underline">
                        {e.url}
                      </a>
                    </>
                  ) : (
                    e.message
                  )}
                </div>
                {e.detail && <div className="whitespace-pre-wrap break-words font-mono text-[11px] text-zinc-500">{e.detail}</div>}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {error && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{error} Retrying…</p>}
      {job?.status === "done" && job.guideSlug && (
        <div className="mt-4 flex items-center justify-between rounded-xl bg-emerald-600 px-4 py-3 text-white">
          <span>Guide ready.</span>
          <Link href={`/guides/${job.guideSlug}`} className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-emerald-800">
            Open guide
          </Link>
        </div>
      )}
      {job?.status === "failed" && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <b>The agent could not finish this guide.</b> {job.error}
          <div className="mt-2">
            <Link href="/" className="font-medium underline">
              Back to the library
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
