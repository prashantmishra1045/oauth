import { DIFFICULTY_LABELS, Guide, checkGuideIntegrity, type Evidence, type Probe } from "@/lib/guide/schema";
import type { GuideDraft } from "./types";

/**
 * Deterministic fixes for a model-written draft, so a near-miss never blocks a
 * live guide: dangling source ids, labels that disagree with numbers, missing
 * path references. Each fix is conservative (it lowers confidence, never raises it).
 */
export function repairDraft(draft: GuideDraft): GuideDraft {
  const d: GuideDraft = structuredClone(draft);

  const seen = new Set<string>();
  d.sources = d.sources.filter((s) => {
    if (!s.url || seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
  const sourceIds = new Set(d.sources.map((s) => s.id));

  const fixEvidence = (e: Evidence) => {
    e.sourceIds = e.sourceIds.filter((id) => sourceIds.has(id));
    if ((e.kind === "documented" || e.kind === "reported") && e.sourceIds.length === 0) {
      e.kind = "inferred";
      e.confidence = "low";
      e.note = `${e.note ? `${e.note} ` : ""}(cited source missing)`.trim();
    }
  };

  const pathSeen = new Set<string>();
  for (const p of d.paths) {
    while (pathSeen.has(p.id)) p.id = `${p.id}-2`;
    pathSeen.add(p.id);
    p.difficulty = clampDifficulty(p.difficulty);
    for (const r of [p.handsOnEffortHours, p.approvalWaitDays]) {
      if (r.min > r.max) [r.min, r.max] = [r.max, r.min];
      if (r.min < 0) r.min = 0;
      fixEvidence(r.evidence);
    }
    for (const st of p.stages) for (const step of st.steps) fixEvidence(step.evidence);
  }
  const pathIds = new Set(d.paths.map((p) => p.id));
  if (!pathIds.has(d.recommendedPathId) && d.paths[0]) d.recommendedPathId = d.paths[0].id;
  const recommended = d.paths.find((p) => p.id === d.recommendedPathId);
  if (recommended) d.summary.difficulty = recommended.difficulty;
  d.summary.difficulty = clampDifficulty(d.summary.difficulty);
  d.summary.difficultyLabel = DIFFICULTY_LABELS[d.summary.difficulty - 1];

  for (const r of d.requirements) {
    r.pathIds = r.pathIds.filter((id) => pathIds.has(id));
    fixEvidence(r.evidence);
  }
  d.nuances.forEach((n) => fixEvidence(n.evidence));
  d.blockers.forEach((b) => fixEvidence(b.evidence));
  fixEvidence(d.composio.evidence);
  fixEvidence(d.oauth.evidence);
  return d;
}

function clampDifficulty(n: number): number {
  return Math.min(5, Math.max(1, Math.round(n || 3)));
}

export function assembleGuide(args: {
  slug: string;
  draft: GuideDraft;
  probes: Omit<Probe, "id">[] | Probe[];
  model: string;
  startedAt: string;
  durationSec: number;
}): Guide {
  const draft = repairDraft(args.draft);
  const now = new Date().toISOString();
  const guide: Guide = {
    schemaVersion: 1,
    slug: args.slug,
    ...draft,
    probes: args.probes.map((p, i) => ({ ...p, id: `p${i + 1}` })),
    verification: { status: "unverified", checkedAt: "", summary: "Verification has not run yet.", entries: [] },
    meta: {
      generatedAt: args.startedAt,
      generatedBy: "live",
      model: args.model,
      durationSec: args.durationSec,
      lastReviewedAt: now,
    },
  };
  const parsed = Guide.parse(guide);
  const problems = checkGuideIntegrity(parsed);
  if (problems.length) throw new Error(`assembled guide failed integrity checks: ${problems.slice(0, 3).join("; ")}`);
  return parsed;
}
