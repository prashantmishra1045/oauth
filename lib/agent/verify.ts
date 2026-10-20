import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Evidence, Guide, Source, VerificationEntry } from "@/lib/guide/schema";
import { runAgentLoop } from "./loop";
import type { NewJobEvent, Usage } from "./types";

/**
 * The verifier never rewrites the guide. It returns per-claim verdicts and
 * small typed corrections; code applies them and logs before/after, so every
 * change in a published guide is auditable.
 */

export interface Claim {
  ref: string;
  claim: string;
  citedUrls: string[];
}

export const Check = z.object({
  ref: z.string(),
  verdict: z.enum(["supported", "corrected", "downgraded", "unverifiable"]),
  note: z.string(),
  sourceUrls: z.array(z.string()),
  newText: z.string().describe('corrected text for a text claim; "" if unchanged'),
  newMin: z.number().describe("corrected range minimum; -1 if unchanged"),
  newMax: z.number().describe("corrected range maximum; -1 if unchanged"),
  newLabel: z.string().describe('corrected range label; "" if unchanged'),
  newConfidence: z.enum(["high", "medium", "low", "unchanged"]),
});
export type Check = z.infer<typeof Check>;

export const VerifyOutput = z.object({
  checks: z.array(Check),
  openQuestions: z.array(z.string()),
  summary: z.string(),
});
export type VerifyOutput = z.infer<typeof VerifyOutput>;

type Target = {
  get(): string;
  set(text: string): void;
  evidence: Evidence;
  range?: { min: number; max: number; label: string };
};

/** Every checkable claim in a guide, addressed by a stable ref. */
function targets(g: Guide): Map<string, Target> {
  const map = new Map<string, Target>();
  for (const p of g.paths) {
    for (const field of ["handsOnEffortHours", "approvalWaitDays"] as const) {
      const r = p[field];
      map.set(`range:${p.id}:${field}`, { get: () => `${r.label} (${r.min}-${r.max} ${field === "handsOnEffortHours" ? "hours" : "days"}); basis: ${r.basis}`, set: () => {}, evidence: r.evidence, range: r });
    }
    for (const st of p.stages) {
      // Stages carry no evidence of their own; give the claim a detached record (seeded with the
      // steps' citations for the verifier) so a verdict on the stage never alters a step's badge.
      const cited = [...new Set(st.steps.flatMap((s) => s.evidence.sourceIds))];
      const stageEvidence: Evidence = { kind: st.steps[0]?.evidence.kind ?? "inferred", sourceIds: cited, confidence: st.steps[0]?.evidence.confidence ?? "medium", note: "" };
      map.set(`stage:${p.id}:${st.id}`, { get: () => st.access, set: (t) => (st.access = t), evidence: stageEvidence });
      for (const step of st.steps) {
        map.set(`step:${p.id}:${st.id}:${step.id}`, { get: () => `${step.title}: ${step.detail}`, set: (t) => (step.detail = t), evidence: step.evidence });
      }
    }
  }
  for (const r of g.requirements) map.set(`requirement:${r.id}`, { get: () => `${r.title}: ${r.detail}`, set: (t) => (r.detail = t), evidence: r.evidence });
  for (const n of g.nuances) map.set(`nuance:${n.id}`, { get: () => `${n.title}: ${n.detail}`, set: (t) => (n.detail = t), evidence: n.evidence });
  for (const b of g.blockers) map.set(`blocker:${b.id}`, { get: () => `${b.title}: ${b.resolution}`, set: (t) => (b.resolution = t), evidence: b.evidence });
  for (const field of ["refreshTokens", "tokenLifetime", "redirectUris"] as const) {
    map.set(`oauth:${field}`, { get: () => g.oauth[field], set: (t) => (g.oauth[field] = t), evidence: g.oauth.evidence });
  }
  return map;
}

/** The high-impact claims worth a fact-check, most decision-relevant first. */
export function extractClaims(g: Guide): Claim[] {
  const urls = new Map(g.sources.map((s) => [s.id, s.url]));
  const cite = (e: Evidence) => e.sourceIds.map((id) => urls.get(id)).filter((u): u is string => Boolean(u));
  const all = targets(g);
  const pick = (ref: string): Claim | null => {
    const t = all.get(ref);
    return t ? { ref, claim: t.get(), citedUrls: cite(t.evidence) } : null;
  };
  const refs: string[] = [];
  const rec = g.paths.find((p) => p.id === g.recommendedPathId) ?? g.paths[0];
  for (const p of [rec, ...g.paths.filter((x) => x !== rec)]) {
    refs.push(`range:${p.id}:approvalWaitDays`, `range:${p.id}:handsOnEffortHours`);
    for (const st of p.stages) if (st.kind === "test" || st.kind === "review") refs.push(`stage:${p.id}:${st.id}`);
  }
  for (const r of g.requirements) if (r.mandatory) refs.push(`requirement:${r.id}`);
  for (const n of g.nuances) if (n.impact === "high") refs.push(`nuance:${n.id}`);
  refs.push("oauth:refreshTokens", "oauth:tokenLifetime");
  return refs.map(pick).filter((c): c is Claim => c !== null).slice(0, 16);
}

const SYSTEM = `You are an adversarial fact-checker for an OAuth app setup guide. You get the guide's high-impact claims, each with a ref and the URLs the guide cites for it. Assume some are wrong: stale policies, numbers the source does not state, community anecdotes presented as official, wrong scope classifications.

Check the most decision-relevant 8-12 claims (timelines, user caps before approval, costs, what triggers review, mandatory requirements). Open cited sources with web_fetch and confirm they support the claim; use web_search for newer or contradicting information. Budget: about 6 fetches and 3 searches.

Then call submit_verification once, with one check per claim you examined:
- supported: the source supports it.
- corrected: it is wrong. Give the corrected text in newText, or for range refs the corrected newMin/newMax/newLabel, and the sourceUrls that justify the correction.
- downgraded: only partly supported, or only community-reported; set a lower newConfidence.
- unverifiable: you could not confirm it; newConfidence "low".
Leave newText "" and newMin/newMax -1, newLabel "" when nothing changes.`;

export async function verifyGuide(args: {
  client: Anthropic;
  guide: Guide;
  emit(e: NewJobEvent): void;
  usage: Usage;
  softDeadline: number;
  hardDeadline: number;
}): Promise<VerifyOutput> {
  const claims = extractClaims(args.guide);
  args.emit({ stage: "verify", kind: "check", message: `Fact-checking ${claims.length} high-impact claims against their sources` });
  return runAgentLoop({
    client: args.client,
    stage: "verify",
    effort: (process.env.GREENLIGHT_VERIFY_EFFORT as "medium") || "medium",
    system: SYSTEM,
    prompt: `Guide: ${args.guide.app.name} (${args.guide.provider.name}). Today's date: ${new Date().toISOString().slice(0, 10)}.

Claims:
${JSON.stringify(claims, null, 2)}`,
    tools: [],
    webSearchMaxUses: 3,
    webFetchMaxUses: 6,
    submit: { name: "submit_verification", description: "Submit the fact-check results. Call exactly once.", schema: VerifyOutput },
    softDeadline: args.softDeadline,
    hardDeadline: args.hardDeadline,
    maxTurns: 10,
    emit: args.emit,
    usage: args.usage,
  });
}

function publisherFor(url: string, g: Guide): Source["publisher"] {
  try {
    const host = new URL(url).hostname;
    if (host.endsWith("composio.dev")) return "composio";
    const providerHosts = [g.provider.docsUrl, g.provider.developerPortalUrl, g.app.website]
      .map((u) => {
        try {
          return new URL(u).hostname.split(".").slice(-2).join(".");
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    return providerHosts.some((h) => host.endsWith(h)) ? "official" : "other";
  } catch {
    return "other";
  }
}

function rangeLabel(min: number, max: number, unit: "hours" | "days"): string {
  if (max === 0) return "None";
  return min === max ? `${min} ${unit}` : `${min}-${max} ${unit}`;
}

/** Applies verifier output to a copy of the guide and fills in the verification block. */
export function applyVerification(guide: Guide, out: VerifyOutput, checkedAt = new Date().toISOString()): Guide {
  const g: Guide = structuredClone(guide);
  const map = targets(g);
  const byUrl = new Map(g.sources.map((s) => [s.url, s.id]));
  const usedIds = new Set(g.sources.map((s) => s.id));
  const sourceIdFor = (url: string) => {
    const existing = byUrl.get(url);
    if (existing) return existing;
    // Ids can have gaps (repairDraft drops bad sources), so find one that is actually free.
    let n = g.sources.length + 1;
    while (usedIds.has(`s${n}`)) n++;
    const id = `s${n}`;
    usedIds.add(id);
    g.sources.push({ id, url, title: (() => { try { return new URL(url).hostname; } catch { return url; } })(), publisher: publisherFor(url, g), accessedAt: checkedAt.slice(0, 10), excerpt: "" });
    byUrl.set(url, id);
    return id;
  };

  const entries: VerificationEntry[] = [];
  for (const check of out.checks) {
    const t = map.get(check.ref);
    if (!t) continue;
    const before = t.get();
    const originallyCited = [...t.evidence.sourceIds];
    const sourceIds = check.sourceUrls.filter((u) => /^https?:\/\//.test(u)).map(sourceIdFor);
    let after = "";

    if (check.verdict === "corrected") {
      if (t.range) {
        // -1 means "keep this bound"; a label is derived when only the numbers change.
        const min = check.newMin >= 0 ? check.newMin : t.range.min;
        const max = check.newMax >= 0 ? check.newMax : t.range.max;
        const unit = check.ref.endsWith(":handsOnEffortHours") ? "hours" : "days";
        const numbersChanged = min !== t.range.min || max !== t.range.max;
        const label = check.newLabel.trim() || (numbersChanged ? rangeLabel(min, max, unit) : t.range.label);
        if (min <= max && (numbersChanged || label !== t.range.label)) {
          t.range.min = min;
          t.range.max = max;
          t.range.label = label;
          after = t.get();
        }
      } else if (check.newText.trim()) {
        t.set(check.newText.trim());
        after = t.get();
      }
      if (after) {
        for (const id of sourceIds) if (!t.evidence.sourceIds.includes(id)) t.evidence.sourceIds.push(id);
        if (sourceIds.length && t.evidence.kind === "inferred") t.evidence.kind = "documented";
      }
    }
    if (check.verdict === "corrected" && !after) {
      // The verifier said the claim is wrong but its correction could not be applied: never raise confidence.
      t.evidence.confidence = "low";
    } else if (check.newConfidence !== "unchanged") {
      t.evidence.confidence = check.newConfidence;
    } else if (check.verdict === "downgraded" || check.verdict === "unverifiable") {
      t.evidence.confidence = "low";
    }

    entries.push({
      id: `v${entries.length + 1}`,
      claim: before,
      location: check.ref,
      // A correction the code could not apply is recorded as unverifiable rather than claimed as fixed.
      verdict: check.verdict === "corrected" && !after ? "unverifiable" : check.verdict,
      before: after ? before : "",
      after,
      method: sourceIds.some((id) => !originallyCited.includes(id)) ? "cross_source" : "source_recheck",
      sourceIds,
      note: check.note,
    });
  }

  for (const q of out.openQuestions) if (q && !g.openQuestions.includes(q)) g.openQuestions.push(q);

  const highImpact = entries.filter((e) => e.location.startsWith("range:") || e.location.startsWith("stage:"));
  const allHighImpactOk = highImpact.length > 0 && highImpact.every((e) => e.verdict === "supported" || e.verdict === "corrected");
  const count = (v: VerificationEntry["verdict"]) => entries.filter((e) => e.verdict === v).length;
  // "Partly fact-checked" needs at least one claim the verifier actually confirmed, corrected or downgraded.
  const examined = entries.length - count("unverifiable");
  g.verification = {
    status: examined === 0 ? "unverified" : allHighImpactOk ? "verified" : "partial",
    checkedAt,
    summary: `${entries.length} claims checked: ${count("supported")} supported, ${count("corrected")} corrected, ${count("downgraded")} downgraded, ${count("unverifiable")} unverifiable. ${out.summary}`.trim(),
    entries,
  };
  g.meta.lastReviewedAt = checkedAt;
  return g;
}
