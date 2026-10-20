import { z } from "zod";
import { Guide, Probe } from "@/lib/guide/schema";

export const STAGES = ["resolve", "research", "draft", "verify", "finalize"] as const;
export type StageName = (typeof STAGES)[number];

export const STAGE_LABELS: Record<StageName, string> = {
  resolve: "Identify the app",
  research: "Investigate & probe",
  draft: "Write the guide",
  verify: "Check the claims",
  finalize: "Publish",
};

export type JobEventKind =
  | "stage"
  | "search"
  | "fetch"
  | "probe"
  | "note"
  | "finding"
  | "check"
  | "warn"
  | "error"
  | "done";

export interface JobEvent {
  seq: number;
  at: string;
  stage: StageName;
  kind: JobEventKind;
  message: string;
  detail?: string;
  url?: string;
}

export type NewJobEvent = Omit<JobEvent, "seq" | "at">;

/** What resolve settles on before any expensive research. */
export const Resolution = z.object({
  name: z.string(),
  slug: z.string().describe("kebab-case, e.g. 'google-calendar'"),
  website: z.string(),
  category: z.string(),
  providerPlatform: z.string().describe("whose OAuth this is, e.g. 'Google Auth Platform'"),
  developerDocsUrl: z.string(),
  oauthLikely: z.enum(["yes", "no", "unknown"]),
  note: z.string(),
});
export type Resolution = z.infer<typeof Resolution>;

export const FactTopic = z.enum([
  "registration",
  "oauth_technical",
  "access_tiers",
  "pre_approval_limits",
  "review_process",
  "timeline",
  "cost",
  "requirements",
  "ongoing",
  "blockers",
  "agent_vs_human",
  "composio",
  "other",
]);

export const Findings = z.object({
  app: z.object({ name: z.string(), website: z.string(), category: z.string() }),
  provider: z.object({
    name: z.string(),
    developerPortalUrl: z.string(),
    docsUrl: z.string(),
    appConsoleUrl: z.string(),
  }),
  oauthSupport: z.enum(["full", "limited", "none"]),
  accessTiers: z.array(
    z.object({
      name: z.string(),
      exampleScopes: z.array(z.string()),
      reviewNeeded: z.string().describe("what review this tier triggers, or 'none'"),
      note: z.string(),
    }),
  ),
  facts: z.array(
    z.object({
      topic: FactTopic,
      statement: z.string(),
      evidenceKind: z.enum(["tested", "documented", "reported", "inferred"]),
      confidence: z.enum(["high", "medium", "low"]),
      sourceUrl: z.string().describe("the page that supports it; empty for tested/inferred"),
      excerpt: z.string().describe("short quote from that page; empty if none"),
    }),
  ),
  sources: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      publisher: z.enum(["official", "composio", "community", "other"]),
    }),
  ),
  openQuestions: z.array(z.string()),
});
export type Findings = z.infer<typeof Findings>;

/** The part of a guide the model writes; code adds slug, probes, verification and meta. */
export const GuideDraft = Guide.omit({
  schemaVersion: true,
  slug: true,
  probes: true,
  verification: true,
  meta: true,
});
export type GuideDraft = z.infer<typeof GuideDraft>;

export interface Usage {
  /** uncached input tokens */
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  webSearches: number;
  webFetches: number;
}

export interface Job {
  id: string;
  query: string;
  status: "running" | "done" | "failed";
  stage: StageName;
  /** set when a stage has finished and the next one has not started */
  waiting: boolean;
  origin: string;
  createdAt: string;
  updatedAt: string;
  heartbeatAt: string;
  attempts: Partial<Record<StageName, number>>;
  usage: Usage;
  /** estimated cost already added to the deployment's spend total, in USD */
  recordedUsd?: number;
  resolution?: Resolution;
  catalogSlug?: string;
  composioNote?: string;
  /** ids are assigned when the guide is assembled */
  probes: Omit<Probe, "id">[];
  findings?: Findings;
  draft?: GuideDraft;
  verified?: Guide;
  guideSlug?: string;
  /** another job already producing the same guide */
  followJobId?: string;
  error?: string;
  replay?: boolean;
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, webSearches: 0, webFetches: 0 });
