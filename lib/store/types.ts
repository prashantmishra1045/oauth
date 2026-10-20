import type { Guide } from "@/lib/guide/schema";
import type { Job, JobEvent, NewJobEvent } from "@/lib/agent/types";

export interface GuideIndexEntry {
  slug: string;
  name: string;
  difficulty: number;
  difficultyLabel: string;
  generatedAt: string;
  verification: string;
}

export interface Store {
  readonly kind: "redis" | "file";
  /** true when state is shared across server instances */
  readonly durable: boolean;

  getJob(id: string): Promise<Job | null>;
  saveJob(job: Job): Promise<void>;
  appendEvents(id: string, events: NewJobEvent[]): Promise<void>;
  getEvents(id: string, fromSeq: number): Promise<JobEvent[]>;

  /** returns a token when acquired, null when someone else holds it */
  acquireLease(key: string, ttlMs: number): Promise<string | null>;
  /** releases only if the token still matches */
  releaseLease(key: string, token: string): Promise<void>;

  getGuide(slug: string): Promise<Guide | null>;
  saveGuide(guide: Guide): Promise<void>;
  listGuides(limit: number): Promise<GuideIndexEntry[]>;

  /** the job currently producing a guide for this slug, if any */
  getActiveJobForSlug(slug: string): Promise<string | null>;
  /** atomically claims the slug for jobId; returns whichever job holds the claim afterwards */
  claimActiveJob(slug: string, jobId: string, ttlSec: number): Promise<string>;
  /** drops the claim only if jobId still holds it */
  releaseActiveJob(slug: string, jobId: string): Promise<void>;

  /** increments a fixed-window counter and returns the new count */
  hit(key: string, windowSec: number): Promise<number>;

  /** estimated live-generation spend so far, in USD */
  getSpend(): Promise<number>;
  addSpend(usd: number): Promise<void>;
}

export function indexEntry(g: Guide): GuideIndexEntry {
  return {
    slug: g.slug,
    name: g.app.name,
    difficulty: g.summary.difficulty,
    difficultyLabel: g.summary.difficultyLabel,
    generatedAt: g.meta.generatedAt,
    verification: g.verification.status,
  };
}
