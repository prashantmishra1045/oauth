import { Redis } from "@upstash/redis";
import { randomUUID } from "node:crypto";
import type { Guide } from "@/lib/guide/schema";
import type { Job, JobEvent, NewJobEvent } from "@/lib/agent/types";
import { indexEntry, type GuideIndexEntry, type Store } from "./types";

const JOB_TTL_SEC = 60 * 60 * 24 * 14;

// Delete a key only if it still holds the expected value (lease / claim owner).
const COMPARE_AND_DELETE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/** Upstash Redis store, shared by every server instance. */
export class RedisStore implements Store {
  readonly kind = "redis" as const;
  readonly durable = true;
  constructor(private redis: Redis) {}

  async getJob(id: string) {
    return (await this.redis.get<Job>(`gl:job:${id}`)) ?? null;
  }

  async saveJob(job: Job) {
    await this.redis.set(`gl:job:${job.id}`, job, { ex: JOB_TTL_SEC });
  }

  async appendEvents(id: string, events: NewJobEvent[]) {
    if (events.length === 0) return;
    const key = `gl:events:${id}`;
    const at = new Date().toISOString();
    // seq is assigned on read from list position, so concurrent appends stay consistent.
    await this.redis.rpush(key, ...events.map((e) => JSON.stringify({ ...e, at })));
    await this.redis.expire(key, JOB_TTL_SEC);
  }

  async getEvents(id: string, fromSeq: number): Promise<JobEvent[]> {
    const raw = await this.redis.lrange<string | Omit<JobEvent, "seq">>(`gl:events:${id}`, fromSeq, -1);
    return raw.map((r, i) => {
      const e = typeof r === "string" ? (JSON.parse(r) as Omit<JobEvent, "seq">) : r;
      return { ...e, seq: fromSeq + i };
    });
  }

  async acquireLease(key: string, ttlMs: number) {
    const token = randomUUID();
    const ok = await this.redis.set(`gl:lease:${key}`, token, { nx: true, px: ttlMs });
    return ok ? token : null;
  }

  async releaseLease(key: string, token: string) {
    await this.redis.eval(COMPARE_AND_DELETE, [`gl:lease:${key}`], [token]);
  }

  async getGuide(slug: string) {
    return (await this.redis.get<Guide>(`gl:guide:${slug}`)) ?? null;
  }

  async saveGuide(guide: Guide) {
    await this.redis.set(`gl:guide:${guide.slug}`, guide);
    await this.redis.zadd("gl:guides", { score: Date.parse(guide.meta.generatedAt) || Date.now(), member: guide.slug });
    await this.redis.set(`gl:guide-index:${guide.slug}`, indexEntry(guide));
  }

  async listGuides(limit: number): Promise<GuideIndexEntry[]> {
    const slugs = await this.redis.zrange<string[]>("gl:guides", 0, limit - 1, { rev: true });
    if (slugs.length === 0) return [];
    const entries = await this.redis.mget<(GuideIndexEntry | null)[]>(...slugs.map((s) => `gl:guide-index:${s}`));
    return entries.filter((e): e is GuideIndexEntry => e !== null);
  }

  async getActiveJobForSlug(slug: string) {
    return (await this.redis.get<string>(`gl:active:${slug}`)) ?? null;
  }

  async claimActiveJob(slug: string, jobId: string, ttlSec: number) {
    const ok = await this.redis.set(`gl:active:${slug}`, jobId, { nx: true, ex: ttlSec });
    if (ok) return jobId;
    return (await this.redis.get<string>(`gl:active:${slug}`)) ?? jobId;
  }

  async releaseActiveJob(slug: string, jobId: string) {
    await this.redis.eval(COMPARE_AND_DELETE, [`gl:active:${slug}`], [jobId]);
  }

  async getSpend() {
    return Number((await this.redis.get<number | string>("gl:spend-usd")) ?? 0);
  }

  async addSpend(usd: number) {
    if (usd > 0) await this.redis.incrbyfloat("gl:spend-usd", usd);
  }

  async hit(key: string, windowSec: number) {
    const bucket = Math.floor(Date.now() / 1000 / windowSec);
    const k = `gl:rl:${key}:${bucket}`;
    const n = await this.redis.incr(k);
    if (n === 1) await this.redis.expire(k, windowSec);
    return n;
  }
}
