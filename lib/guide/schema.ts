import { z } from "zod";

/**
 * The guide contract. Library guides (data/guides/*.json), the live agent's
 * output and the UI all go through this schema.
 *
 * Every field is required (use "" or [] for "nothing to say") so the same
 * shape works as a Claude structured-output schema, which handles optional
 * fields poorly at this size.
 */

export const EvidenceKind = z
  .enum(["tested", "documented", "reported", "inferred"])
  .describe(
    "tested = an agent probe observed it; documented = official provider docs say it; reported = community/third-party sources say it; inferred = reasoning without a direct source",
  );

export const Confidence = z.enum(["high", "medium", "low"]);

export const Evidence = z.object({
  kind: EvidenceKind,
  sourceIds: z.array(z.string()).describe("ids from sources[] that support the claim"),
  confidence: Confidence,
  note: z.string().describe("short basis, e.g. a quoted phrase or why it is inferred; may be empty"),
});

export const Source = z.object({
  id: z.string().describe("short id like s1"),
  url: z.string(),
  title: z.string(),
  publisher: z.enum(["official", "composio", "community", "other"]),
  accessedAt: z.string().describe("YYYY-MM-DD"),
  excerpt: z.string().describe("a short quote from the source that supports the claims citing it"),
});

export const Owner = z
  .enum(["agent", "developer", "provider"])
  .describe("agent = an AI agent can do or prepare it; developer = a human must do it; provider = waiting on the provider");

export const Step = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  owner: Owner,
  agentAssist: z.string().describe("what an agent can do to help with this step; empty if nothing"),
  duration: z.string().describe("human estimate, e.g. '5 min', '1-2 h', '3-5 business days'"),
  url: z.string().describe("deep link for the step; empty if none"),
  evidence: Evidence,
});

export const StageKind = z.enum(["register", "configure", "test", "review", "live", "maintain"]);

export const Stage = z.object({
  id: z.string(),
  name: z.string(),
  kind: StageKind,
  access: z.string().describe("who can connect while the app is at this stage, e.g. 'Only test users you list (max 100); users see an unverified-app warning'"),
  steps: z.array(Step),
});

export const Range = z.object({
  min: z.number(),
  max: z.number(),
  label: z.string().describe("human label, e.g. '1-3 hours' or '4-8 weeks'"),
  basis: z.string().describe("what the estimate is based on"),
  evidence: Evidence,
});

export const Path = z.object({
  id: z.string().describe("kebab-case, e.g. 'restricted-scopes'"),
  name: z.string(),
  summary: z.string(),
  whenYouNeedIt: z.string(),
  exampleScopes: z.array(z.string()),
  difficulty: z.number().int().min(1).max(5),
  handsOnEffortHours: Range.describe("developer hands-on effort, in hours"),
  approvalWaitDays: Range.describe("calendar days waiting on the provider; 0-0 when no review"),
  endState: z.string().describe("what is true at the end, e.g. 'any Google user can connect without a warning screen'"),
  stages: z.array(Stage),
});

export const RequirementCategory = z.enum([
  "account",
  "legal",
  "domain",
  "branding",
  "security",
  "business",
  "technical",
  "cost",
]);

export const Requirement = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  category: RequirementCategory,
  mandatory: z.boolean(),
  pathIds: z.array(z.string()).describe("paths this applies to; empty = all paths"),
  evidence: Evidence,
});

export const Impact = z.enum(["high", "medium", "low"]);

export const Nuance = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  impact: Impact,
  evidence: Evidence,
});

export const Blocker = z.object({
  id: z.string(),
  title: z.string(),
  symptom: z.string().describe("what the developer sees"),
  cause: z.string(),
  resolution: z.string().describe("how to proceed"),
  escalation: z.string().describe("where to ask or appeal; empty if none known"),
  evidence: Evidence,
});

export const ProbeKind = z.enum([
  "oauth_metadata",
  "authorize_endpoint",
  "token_endpoint",
  "portal_access",
  "docs_fetch",
  "composio_lookup",
  "other",
]);

export const Probe = z.object({
  id: z.string(),
  name: z.string(),
  kind: ProbeKind,
  request: z.string().describe("exactly what was sent, e.g. 'GET https://accounts.google.com/.well-known/openid-configuration'"),
  observed: z.string().describe("what came back: status code and the relevant snippet"),
  conclusion: z.string(),
  outcome: z.enum(["confirmed", "contradicted", "inconclusive", "failed"]),
  ranAt: z.string().describe("ISO timestamp"),
});

export const Artifact = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum([
    "scope_justification",
    "manifest",
    "checklist",
    "demo_script",
    "policy_outline",
    "email",
    "config",
    "other",
  ]),
  format: z.enum(["text", "markdown", "json", "yaml"]),
  content: z.string(),
  howToUse: z.string(),
});

export const Verdict = z.enum(["supported", "corrected", "downgraded", "unverifiable"]);

export const VerificationEntry = z.object({
  id: z.string(),
  claim: z.string(),
  location: z.string().describe("where in the guide, e.g. 'paths[restricted-scopes].approvalWaitDays'"),
  verdict: Verdict,
  before: z.string().describe("claim before the check; empty when supported"),
  after: z.string().describe("claim after the check; empty when supported"),
  method: z.enum(["source_recheck", "probe", "cross_source"]),
  sourceIds: z.array(z.string()),
  note: z.string(),
});

export const DifficultyLabel = z.enum(["Self-serve", "Easy", "Moderate", "Hard", "Gated"]);

export const Tri = z.enum(["yes", "no", "unknown"]);

export const Guide = z.object({
  schemaVersion: z.literal(1),
  slug: z.string(),
  app: z.object({
    name: z.string(),
    website: z.string(),
    category: z.string(),
  }),
  provider: z.object({
    name: z.string().describe("whose OAuth this is, e.g. 'Google (Google Auth Platform)'"),
    developerPortalUrl: z.string(),
    docsUrl: z.string(),
    appConsoleUrl: z.string().describe("where you create the OAuth app"),
  }),
  oauthSupport: z.enum(["full", "limited", "none"]),
  summary: z.object({
    headline: z.string().describe("one-sentence verdict a developer can act on"),
    overview: z.string().describe("2-4 sentences"),
    difficulty: z.number().int().min(1).max(5),
    difficultyLabel: DifficultyLabel,
    drivers: z.array(z.string()).describe("what drives the difficulty"),
    bestCase: z.string(),
    worstCase: z.string(),
  }),
  recommendedPathId: z.string(),
  paths: z.array(Path).min(1),
  composio: z.object({
    managed: Tri.describe("whether Composio offers a managed OAuth app for this toolkit"),
    toolkitSlug: z.string(),
    note: z.string().describe("when you still need your own OAuth app"),
    evidence: Evidence,
  }),
  oauth: z.object({
    authorizationUrl: z.string(),
    tokenUrl: z.string(),
    pkce: z.enum(["required", "supported", "not_supported", "unknown"]),
    refreshTokens: z.string(),
    tokenLifetime: z.string(),
    redirectUris: z.string().describe("redirect URI rules: https, localhost, exact match, wildcards"),
    scopes: z.string().describe("how scopes work for this provider"),
    dynamicClientRegistration: Tri,
    evidence: Evidence,
  }),
  agentVsYou: z.object({
    agentCan: z.array(z.string()),
    youMust: z.array(z.string()),
  }),
  requirements: z.array(Requirement),
  nuances: z.array(Nuance),
  blockers: z.array(Blocker),
  probes: z.array(Probe),
  artifacts: z.array(Artifact),
  openQuestions: z.array(z.string()),
  verification: z.object({
    status: z.enum(["verified", "partial", "unverified"]),
    checkedAt: z.string(),
    summary: z.string(),
    entries: z.array(VerificationEntry),
  }),
  sources: z.array(Source).min(1),
  meta: z.object({
    generatedAt: z.string(),
    generatedBy: z.enum(["library", "live"]),
    model: z.string(),
    durationSec: z.number(),
    lastReviewedAt: z.string(),
  }),
});

export type Guide = z.infer<typeof Guide>;
export type Path = z.infer<typeof Path>;
export type Stage = z.infer<typeof Stage>;
export type Step = z.infer<typeof Step>;
export type Evidence = z.infer<typeof Evidence>;
export type Source = z.infer<typeof Source>;
export type Probe = z.infer<typeof Probe>;
export type Artifact = z.infer<typeof Artifact>;
export type VerificationEntry = z.infer<typeof VerificationEntry>;

export const DIFFICULTY_LABELS = ["Self-serve", "Easy", "Moderate", "Hard", "Gated"] as const;

/** Cross-reference checks the type system can't express. Returns human-readable problems. */
export function checkGuideIntegrity(g: Guide): string[] {
  const problems: string[] = [];
  const sourceIds = new Set(g.sources.map((s) => s.id));
  const pathIds = new Set(g.paths.map((p) => p.id));

  const dupes = (ids: string[], what: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) problems.push(`duplicate ${what} id "${id}"`);
      seen.add(id);
    }
  };
  dupes(g.sources.map((s) => s.id), "source");
  dupes(g.paths.map((p) => p.id), "path");

  const checkEvidence = (e: Evidence, where: string) => {
    for (const id of e.sourceIds) {
      if (!sourceIds.has(id)) problems.push(`${where}: unknown source id "${id}"`);
    }
    if ((e.kind === "documented" || e.kind === "reported") && e.sourceIds.length === 0) {
      problems.push(`${where}: ${e.kind} evidence must cite at least one source`);
    }
  };

  if (!pathIds.has(g.recommendedPathId)) {
    problems.push(`recommendedPathId "${g.recommendedPathId}" is not a path id`);
  }
  if (g.summary.difficultyLabel !== DIFFICULTY_LABELS[g.summary.difficulty - 1]) {
    problems.push(
      `summary.difficultyLabel "${g.summary.difficultyLabel}" does not match difficulty ${g.summary.difficulty} (expected "${DIFFICULTY_LABELS[g.summary.difficulty - 1]}")`,
    );
  }

  checkEvidence(g.composio.evidence, "composio");
  checkEvidence(g.oauth.evidence, "oauth");
  for (const p of g.paths) {
    checkEvidence(p.handsOnEffortHours.evidence, `paths[${p.id}].handsOnEffortHours`);
    checkEvidence(p.approvalWaitDays.evidence, `paths[${p.id}].approvalWaitDays`);
    if (p.handsOnEffortHours.min > p.handsOnEffortHours.max) problems.push(`paths[${p.id}].handsOnEffortHours min > max`);
    if (p.approvalWaitDays.min > p.approvalWaitDays.max) problems.push(`paths[${p.id}].approvalWaitDays min > max`);
    if (p.stages.length === 0) problems.push(`paths[${p.id}] has no stages`);
    for (const st of p.stages) {
      for (const step of st.steps) checkEvidence(step.evidence, `paths[${p.id}].stages[${st.id}].steps[${step.id}]`);
    }
  }
  for (const r of g.requirements) {
    checkEvidence(r.evidence, `requirements[${r.id}]`);
    for (const pid of r.pathIds) if (!pathIds.has(pid)) problems.push(`requirements[${r.id}]: unknown path id "${pid}"`);
  }
  for (const n of g.nuances) checkEvidence(n.evidence, `nuances[${n.id}]`);
  for (const b of g.blockers) checkEvidence(b.evidence, `blockers[${b.id}]`);
  for (const v of g.verification.entries) {
    for (const id of v.sourceIds) if (!sourceIds.has(id)) problems.push(`verification[${v.id}]: unknown source id "${id}"`);
  }
  return problems;
}
