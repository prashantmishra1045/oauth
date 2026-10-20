import Anthropic from "@anthropic-ai/sdk";
import { randomBytes } from "node:crypto";
import { getLibraryGuide, isLibrarySlug, listLibraryGuides } from "@/lib/guide/library";
import { checkGuideIntegrity, type Guide, type Probe } from "@/lib/guide/schema";
import { matchCatalog, slugify } from "@/lib/catalog";
import { getStore } from "@/lib/store";
import { assembleGuide } from "./assemble";
import { createClient, internalSecret, liveGenerationConfigured, MODEL } from "./client";
import { composioNote, lookupComposio } from "./composio";
import { budgetUsd, estimateCostUsd, formatUsd } from "./cost";
import { draftGuide } from "./draft";
import { DeadlineError } from "./loop";
import { researchApp } from "./research";
import { resolutionFromCatalog, resolveApp } from "./resolve";
import { GuideDraft, STAGES, emptyUsage, type Job, type NewJobEvent, type StageName } from "./types";
import { applyVerification, verifyGuide } from "./verify";

/**
 * Live generation as a checkpointed job: resolve -> research -> draft ->
 * verify -> finalize. State is saved after every stage. One invocation runs
 * stages while their budgets fit under the platform limit, then hands off to a
 * fresh invocation (POST /api/jobs/[id]/advance); polling acts as a watchdog
 * that resumes a job whose hand-off was lost.
 */

const STAGE_BUDGET_MS: Record<StageName, number> = {
  resolve: 45_000,
  research: 190_000,
  draft: 250_000,
  verify: 170_000,
  finalize: 10_000,
};
const INVOCATION_BUDGET_MS = 280_000;
// Longer than the 300 s function limit, so a live runner never loses its lease;
// a killed runner's lease expires shortly after and a poll resumes the job.
const LEASE_MS = 310_000;
const MAX_ATTEMPTS = 2;
const GUIDE_FRESH_DAYS = 30;
const ACTIVE_CLAIM_SEC = 20 * 60;

export function replayEnabled(): boolean {
  return process.env.GREENLIGHT_REPLAY === "1" && process.env.VERCEL_ENV !== "production";
}

export type StartResult =
  | { kind: "guide"; slug: string }
  | { kind: "job"; jobId: string }
  | { kind: "error"; status: number; message: string };

const isFresh = (g: Guide) => Date.now() - Date.parse(g.meta.generatedAt) < GUIDE_FRESH_DAYS * 86_400_000;

/** The running job for a slug, clearing a stale claim left by a finished or failed job. */
async function runningJobFor(slug: string): Promise<string | null> {
  const store = getStore();
  const active = await store.getActiveJobForSlug(slug);
  if (!active) return null;
  if ((await store.getJob(active))?.status === "running") return active;
  await store.releaseActiveJob(slug, active);
  return null;
}

export async function startJob(args: { query: string; origin: string; ip: string }): Promise<StartResult> {
  const query = args.query.trim().replace(/\s+/g, " ");
  if (query.length < 2 || query.length > 200) return { kind: "error", status: 400, message: "Enter an app name or website (2-200 characters)." };

  const store = getStore();
  const catalog = matchCatalog(query);
  if (catalog) {
    if (isLibrarySlug(catalog.slug)) return { kind: "guide", slug: catalog.slug };
    const existing = await store.getGuide(catalog.slug);
    if (existing && isFresh(existing)) return { kind: "guide", slug: catalog.slug };
    const running = await runningJobFor(catalog.slug);
    if (running) return { kind: "job", jobId: running };
  }

  if (!liveGenerationConfigured() && !replayEnabled()) {
    return { kind: "error", status: 503, message: "Live generation is not configured on this deployment (ANTHROPIC_API_KEY is not set). The library guides still work." };
  }
  if (process.env.VERCEL && !store.durable && liveGenerationConfigured()) {
    // Without the shared store, jobs and rate limits live in one instance's /tmp: refuse rather than run uncapped.
    return { kind: "error", status: 503, message: "Live generation needs the shared Redis store (connect Upstash Redis to this Vercel project). The library guides still work." };
  }

  if (liveGenerationConfigured() && (await store.getSpend()) >= budgetUsd()) {
    return { kind: "error", status: 429, message: `This demo's API budget (${formatUsd(budgetUsd())}) is used up. Library guides are unaffected.` };
  }
  const perHour = Number(process.env.GENERATION_LIMIT_PER_HOUR || 3);
  const perDay = Number(process.env.GENERATION_LIMIT_PER_DAY || 15);
  if ((await store.hit(`ip:${args.ip}`, 3600)) > perHour) {
    return { kind: "error", status: 429, message: `Limit reached: ${perHour} new guides per hour from one address. Library guides are unaffected.` };
  }
  if ((await store.hit("global", 86_400)) > perDay) {
    return { kind: "error", status: 429, message: "This demo's daily generation budget is used up. Library guides are unaffected." };
  }

  const now = new Date().toISOString();
  const job: Job = {
    id: randomBytes(6).toString("base64url"),
    query,
    status: "running",
    stage: "resolve",
    waiting: true,
    origin: args.origin,
    createdAt: now,
    updatedAt: now,
    heartbeatAt: now,
    attempts: {},
    usage: emptyUsage(),
    probes: [],
    replay: !liveGenerationConfigured(),
  };
  if (catalog) {
    const holder = await store.claimActiveJob(catalog.slug, job.id, ACTIVE_CLAIM_SEC);
    if (holder !== job.id) return { kind: "job", jobId: holder }; // a concurrent request got there first
    job.resolution = resolutionFromCatalog(catalog);
    job.catalogSlug = catalog.slug;
  }
  await store.saveJob(job);
  await store.appendEvents(job.id, [{ stage: "resolve", kind: "stage", message: `Started a guide for "${query}"` }]);
  return { kind: "job", jobId: job.id };
}

function createEmitter(jobId: string) {
  const store = getStore();
  let buffer: NewJobEvent[] = [];
  let pending: Promise<void> = Promise.resolve();
  const flush = () => {
    const batch = buffer;
    buffer = [];
    pending = pending.then(() => store.appendEvents(jobId, batch)).catch((err) => console.error("event flush failed", err));
    return pending;
  };
  const timer = setInterval(flush, 800);
  return {
    emit: (e: NewJobEvent) => void buffer.push(e),
    close: async () => {
      clearInterval(timer);
      await flush();
    },
  };
}

function isRetryable(err: unknown): boolean {
  return (
    err instanceof DeadlineError ||
    err instanceof Anthropic.APIConnectionError ||
    err instanceof Anthropic.RateLimitError ||
    err instanceof Anthropic.InternalServerError
  );
}

export async function requestAdvance(job: Job): Promise<void> {
  try {
    await fetch(`${job.origin}/api/jobs/${job.id}/advance`, {
      method: "POST",
      headers: { "x-greenlight-secret": internalSecret() },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // The polling watchdog resumes the job if this hand-off is lost.
    console.warn(`advance hand-off failed for ${job.id}:`, (err as Error).message);
  }
}

/** Should a poll restart this job? (stage hand-off lost, or the runner died; the lease stops duplicates) */
export function needsResume(job: Job): boolean {
  return job.status === "running" && (job.waiting || Date.now() - Date.parse(job.updatedAt) > 20_000);
}

const slugOf = (job: Job) => job.resolution?.slug ?? job.catalogSlug;

/** singleProcess: run every stage here instead of handing off between serverless invocations (CLI use). */
export async function runJob(jobId: string, opts: { singleProcess?: boolean } = {}): Promise<void> {
  const store = getStore();
  const lease = await store.acquireLease(`job:${jobId}`, LEASE_MS);
  if (!lease) return;
  const invocationStart = Date.now();
  let released = false;
  const release = async () => {
    if (!released) {
      released = true;
      await store.releaseLease(`job:${jobId}`, lease);
    }
  };

  try {
    for (;;) {
      const job = await store.getJob(jobId);
      if (!job || job.status !== "running") return;

      const elapsed = Date.now() - invocationStart;
      if (!opts.singleProcess && elapsed > 1000 && elapsed + STAGE_BUDGET_MS[job.stage] > INVOCATION_BUDGET_MS) {
        job.waiting = true;
        job.updatedAt = new Date().toISOString();
        await store.saveJob(job);
        await release();
        await requestAdvance(job);
        return;
      }

      const stage = job.stage;
      const attempt = (job.attempts[stage] ?? 0) + 1;
      if (attempt > MAX_ATTEMPTS) {
        if (stage === "verify" && job.draft) {
          // Never lose a finished draft: publish it, clearly marked as not fact-checked.
          job.verified = unverifiedGuide(job, "Automatic fact-check did not complete in time.");
          job.stage = "finalize";
          job.waiting = true;
          job.updatedAt = new Date().toISOString();
          await store.saveJob(job);
          continue;
        }
        await fail(job, `The ${stage} step failed ${MAX_ATTEMPTS} times.`);
        return;
      }
      job.attempts[stage] = attempt;
      job.waiting = false;
      job.updatedAt = job.heartbeatAt = new Date().toISOString();
      await store.saveJob(job);

      const emitter = createEmitter(job.id);
      const stageStart = Date.now();
      emitter.emit({ stage, kind: "stage", message: attempt > 1 ? `Retrying: ${stage}` : `Step: ${stage}` });
      try {
        await runStage(job, stage, emitter.emit, stageStart + STAGE_BUDGET_MS[stage]);
        if (job.status === "running") {
          const next = STAGES[STAGES.indexOf(stage) + 1];
          if (next) job.stage = next;
          else job.status = "done";
        }
      } catch (err) {
        console.error(`job ${job.id} ${stage} failed:`, err);
        if (isRetryable(err) && attempt < MAX_ATTEMPTS) {
          emitter.emit({ stage, kind: "warn", message: `The ${stage} step hit a temporary problem; retrying.`, detail: (err as Error).message.slice(0, 300) });
          job.waiting = true;
        } else {
          emitter.emit({ stage, kind: "error", message: friendlyError(err) });
          await emitter.close();
          await recordSpend(job);
          await fail(job, friendlyError(err));
          return;
        }
      } finally {
        await emitter.close();
        await recordSpend(job);
      }
      job.updatedAt = new Date().toISOString();
      await store.saveJob(job);
    }
  } finally {
    await release();
  }
}

/** Adds this job's newly incurred (estimated) cost to the deployment's spend total. */
async function recordSpend(job: Job) {
  if (job.replay) return;
  const total = estimateCostUsd(job.usage);
  const delta = total - (job.recordedUsd ?? 0);
  if (delta <= 0) return;
  job.recordedUsd = total;
  await getStore().addSpend(delta);
}

function friendlyError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The deployment's Anthropic API key was rejected.";
  if (err instanceof Anthropic.PermissionDeniedError) return "The deployment's Anthropic API key is not allowed to use this model or tool.";
  if (err instanceof Anthropic.RateLimitError) return "The Anthropic API is rate-limiting this deployment; try again in a minute.";
  return (err as Error).message?.slice(0, 300) || "Unknown error";
}

async function fail(job: Job, message: string) {
  job.status = "failed";
  job.error = message;
  job.updatedAt = new Date().toISOString();
  const store = getStore();
  await store.saveJob(job);
  const slug = slugOf(job);
  if (slug) await store.releaseActiveJob(slug, job.id);
}

function buildGuide(job: Job): Guide {
  return assembleGuide({
    slug: job.resolution!.slug,
    draft: job.draft!,
    probes: job.probes,
    model: MODEL,
    startedAt: job.createdAt,
    durationSec: 0,
  });
}

function unverifiedGuide(job: Job, why: string): Guide {
  const guide = buildGuide(job);
  guide.verification.summary = `${why} Treat the claims as unverified.`;
  return guide;
}

async function runStage(job: Job, stage: StageName, emit: (e: NewJobEvent) => void, deadline: number): Promise<void> {
  if (job.replay) return runReplayStage(job, stage, emit);
  const store = getStore();
  const client = createClient();

  switch (stage) {
    case "resolve": {
      if (!job.resolution) {
        const { resolution, catalog } = await resolveApp({ client, query: job.query, emit, usage: job.usage, deadline: deadline - 3_000 });
        job.resolution = resolution;
        job.catalogSlug = catalog?.slug;
      }
      const r = job.resolution;
      emit({ stage, kind: "finding", message: `${r.name} — OAuth via ${r.providerPlatform || "unknown platform"}`, detail: r.note, url: r.website });
      if (await finishEarly(job, r.slug, emit)) return;
      const catalog = job.catalogSlug ? matchCatalog(job.catalogSlug) : null;
      const hit = lookupComposio(catalog?.composioToolkit ?? "", r.name, r.slug);
      job.composioNote = composioNote(hit, r.name);
      emit({ stage, kind: "finding", message: hit ? `Composio: ${hit.managed ? "managed OAuth app available" : "bring your own OAuth app"}` : "Composio: not in the managed-auth directory" });
      return;
    }
    case "research": {
      // Collected per attempt, so a retried research stage doesn't publish probes twice.
      const probes: Omit<Probe, "id">[] = [];
      const findings = await researchApp({
        client,
        resolution: job.resolution!,
        composioNote: job.composioNote ?? "",
        emit,
        usage: job.usage,
        softDeadline: deadline - 50_000,
        hardDeadline: deadline - 5_000,
        onProbe: (p) => probes.push(p),
      });
      job.probes = probes;
      job.findings = findings;
      const headline = findings.facts.filter((f) => ["pre_approval_limits", "review_process", "timeline", "cost"].includes(f.topic)).slice(0, 5);
      for (const f of headline) emit({ stage, kind: "finding", message: f.statement, detail: `${f.evidenceKind}, ${f.confidence} confidence`, url: f.sourceUrl || undefined });
      emit({ stage, kind: "note", message: `Research done: ${findings.facts.length} facts from ${findings.sources.length} sources, ${job.probes.length} probes.` });
      return;
    }
    case "draft": {
      const hit = lookupComposio(job.catalogSlug ? (matchCatalog(job.catalogSlug)?.composioToolkit ?? "") : "", job.resolution!.name, job.resolution!.slug);
      emit({ stage, kind: "note", message: "Writing the guide from the findings…" });
      job.draft = await draftGuide({
        client,
        resolution: job.resolution!,
        composio: { managed: hit ? (hit.managed ? "yes" : "no") : "unknown", toolkitSlug: hit?.slug ?? "", note: job.composioNote ?? "" },
        findings: job.findings!,
        probes: job.probes,
        emit,
        usage: job.usage,
        deadline: deadline - 3_000,
      });
      emit({ stage, kind: "note", message: `Draft ready: ${job.draft.summary.difficultyLabel} — ${job.draft.summary.headline}` });
      return;
    }
    case "verify": {
      const guide = buildGuide(job);
      try {
        const out = await verifyGuide({ client, guide, emit, usage: job.usage, softDeadline: deadline - 40_000, hardDeadline: deadline - 5_000 });
        const checked = applyVerification(guide, out);
        const problems = checkGuideIntegrity(checked);
        if (problems.length) {
          console.error(`verification produced an invalid guide for ${job.id}:`, problems);
          job.verified = unverifiedGuide(job, "The fact-check results could not be applied cleanly.");
          emit({ stage, kind: "warn", message: "Fact-check results could not be applied; publishing the guide marked as unverified." });
          return;
        }
        job.verified = checked;
        const v = checked.verification;
        emit({ stage, kind: "check", message: v.summary });
        for (const e of v.entries.filter((x) => x.verdict === "corrected").slice(0, 4)) {
          emit({ stage, kind: "check", message: `Corrected: ${e.after}`, detail: `was: ${e.before}` });
        }
      } catch (err) {
        if (isRetryable(err) && (job.attempts.verify ?? 0) < MAX_ATTEMPTS) throw err;
        // Publish rather than lose the work; the guide says plainly that it was not fact-checked.
        job.verified = unverifiedGuide(job, `Automatic fact-check did not complete (${friendlyError(err)}).`);
        emit({ stage, kind: "warn", message: "Fact-check did not complete; publishing the guide marked as unverified." });
      }
      return;
    }
    case "finalize": {
      const guide = job.verified!;
      guide.meta.durationSec = Math.round((Date.now() - Date.parse(job.createdAt)) / 1000);
      await store.saveGuide(guide);
      job.guideSlug = guide.slug;
      job.status = "done";
      await store.releaseActiveJob(guide.slug, job.id);
      emit({
        stage,
        kind: "done",
        message: `Guide published in ${guide.meta.durationSec}s`,
        detail: `${job.usage.webSearches} searches, ${job.usage.webFetches} pages read, ${job.probes.length} probes, ${guide.verification.entries.length} claims checked, about ${formatUsd(estimateCostUsd(job.usage))} in API usage`,
      });
      return;
    }
  }
}

/** Stops a job when the app already has a guide, or another job is producing one; otherwise claims the slug. */
async function finishEarly(job: Job, slug: string, emit: (e: NewJobEvent) => void): Promise<boolean> {
  const store = getStore();
  const existing = isLibrarySlug(slug) ? getLibraryGuide(slug) : await store.getGuide(slug);
  if (existing && (isLibrarySlug(slug) || isFresh(existing))) {
    job.guideSlug = slug;
    job.status = "done";
    if (job.catalogSlug) await store.releaseActiveJob(job.catalogSlug, job.id);
    emit({ stage: "resolve", kind: "done", message: `A guide for ${existing.app.name} already exists.` });
    return true;
  }
  let holder = await store.claimActiveJob(slug, job.id, ACTIVE_CLAIM_SEC);
  if (holder !== job.id && !(await runningJobFor(slug))) holder = await store.claimActiveJob(slug, job.id, ACTIVE_CLAIM_SEC);
  if (holder !== job.id) {
    job.status = "done";
    job.followJobId = holder;
    emit({ stage: "resolve", kind: "done", message: `Another request is already generating ${slug}; following it.` });
    return true;
  }
  return false;
}

/* ---------------- replay (local UI testing without an API key) ---------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Dev-only: walks the job through every stage using a library guide's recorded
 * probes and sources, so the live UI can be exercised without an API key. The
 * published guide is clearly labelled as replayed content.
 */
async function runReplayStage(job: Job, stage: StageName, emit: (e: NewJobEvent) => void) {
  const template = listLibraryGuides()[0];
  if (!template) throw new Error("Replay needs at least one library guide.");
  switch (stage) {
    case "resolve": {
      if (!job.resolution) {
        job.resolution = { name: job.query, slug: slugify(job.query), website: "", category: "Other", providerPlatform: "", developerDocsUrl: "", oauthLikely: "unknown", note: "Replay mode" };
      }
      emit({ stage, kind: "finding", message: `REPLAY: ${job.resolution.name} (content copied from the ${template.app.name} library guide)` });
      await sleep(600);
      return;
    }
    case "research": {
      job.probes = [];
      for (const s of template.sources.slice(0, 6)) {
        emit({ stage, kind: "fetch", message: `Reading ${s.url}`, url: s.url });
        await sleep(350);
      }
      for (const p of template.probes) {
        job.probes.push({ ...p });
        emit({ stage, kind: "probe", message: `${p.name}: ${p.outcome}`, detail: `${p.request}\n→ ${p.observed}` });
        await sleep(350);
      }
      return;
    }
    case "draft": {
      // GuideDraft.parse drops the fields code adds (slug, probes, verification, meta).
      job.draft = GuideDraft.parse(structuredClone(template));
      await sleep(1200);
      return;
    }
    case "verify": {
      const guide = assembleGuide({ slug: `replay-${job.resolution!.slug}`, draft: job.draft!, probes: job.probes, model: "replay", startedAt: job.createdAt, durationSec: 0 });
      guide.app.name = `${job.resolution!.name} (replay of ${template.app.name})`;
      guide.openQuestions.unshift(`REPLAY MODE: this content is the ${template.app.name} library guide, used to test the live flow without an API key.`);
      guide.verification = { ...template.verification, summary: `Replayed from the ${template.app.name} library guide.` };
      job.verified = guide;
      emit({ stage, kind: "check", message: guide.verification.summary });
      await sleep(600);
      return;
    }
    case "finalize": {
      const guide = job.verified!;
      guide.meta.durationSec = Math.round((Date.now() - Date.parse(job.createdAt)) / 1000);
      await getStore().saveGuide(guide);
      job.guideSlug = guide.slug;
      job.status = "done";
      emit({ stage, kind: "done", message: "Replay finished" });
      return;
    }
  }
}
