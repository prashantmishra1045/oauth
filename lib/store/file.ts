import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Guide } from "@/lib/guide/schema";
import type { Job, JobEvent, NewJobEvent } from "@/lib/agent/types";
import { indexEntry, type GuideIndexEntry, type Store } from "./types";

/**
 * Local development store under .data/ (or /tmp on a read-only filesystem).
 * Not shared between server instances, so production should use Redis.
 */
export class FileStore implements Store {
  readonly kind = "file" as const;
  readonly durable = false;
  constructor(private root: string) {}

  private file(...parts: string[]) {
    return path.join(this.root, ...parts);
  }

  private async read<T>(file: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(file, "utf8")) as T;
    } catch {
      return null;
    }
  }

  private async write(file: string, value: unknown) {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(value));
    await rename(tmp, file);
  }

  /** Exclusive create: succeeds for exactly one caller while an unexpired holder exists. */
  private async claim(file: string, value: { owner: string; until: number }): Promise<string> {
    await mkdir(path.dirname(file), { recursive: true });
    for (let i = 0; i < 2; i++) {
      try {
        await writeFile(file, JSON.stringify(value), { flag: "wx" });
        return value.owner;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        const current = await this.read<{ owner: string; until: number }>(file);
        if (current && current.until > Date.now()) return current.owner;
        await rm(file, { force: true }); // expired: clear it and try once more
      }
    }
    return (await this.read<{ owner: string }>(file))?.owner ?? value.owner;
  }

  private async releaseIfOwner(file: string, owner: string) {
    const current = await this.read<{ owner: string }>(file);
    if (current?.owner === owner) await rm(file, { force: true });
  }

  getJob(id: string) {
    return this.read<Job>(this.file("jobs", `${id}.json`));
  }

  saveJob(job: Job) {
    return this.write(this.file("jobs", `${job.id}.json`), job);
  }

  async appendEvents(id: string, events: NewJobEvent[]) {
    if (events.length === 0) return;
    const file = this.file("events", `${id}.json`);
    const existing = (await this.read<JobEvent[]>(file)) ?? [];
    const at = new Date().toISOString();
    for (const e of events) existing.push({ ...e, seq: existing.length, at });
    await this.write(file, existing);
  }

  async getEvents(id: string, fromSeq: number) {
    const all = (await this.read<JobEvent[]>(this.file("events", `${id}.json`))) ?? [];
    return all.slice(fromSeq);
  }

  async acquireLease(key: string, ttlMs: number) {
    const token = randomUUID();
    const owner = await this.claim(this.file("leases", `${key}.json`), { owner: token, until: Date.now() + ttlMs });
    return owner === token ? token : null;
  }

  releaseLease(key: string, token: string) {
    return this.releaseIfOwner(this.file("leases", `${key}.json`), token);
  }

  getGuide(slug: string) {
    return this.read<Guide>(this.file("guides", `${slug}.json`));
  }

  saveGuide(guide: Guide) {
    return this.write(this.file("guides", `${guide.slug}.json`), guide);
  }

  async listGuides(limit: number): Promise<GuideIndexEntry[]> {
    let names: string[] = [];
    try {
      names = await readdir(this.file("guides"));
    } catch {
      return [];
    }
    const guides = await Promise.all(
      names.filter((n) => n.endsWith(".json")).map((n) => this.read<Guide>(this.file("guides", n))),
    );
    return guides
      .filter((g): g is Guide => g !== null)
      .map(indexEntry)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
      .slice(0, limit);
  }

  async getActiveJobForSlug(slug: string) {
    const v = await this.read<{ owner: string; until: number }>(this.file("active", `${slug}.json`));
    return v && v.until > Date.now() ? v.owner : null;
  }

  claimActiveJob(slug: string, jobId: string, ttlSec: number) {
    return this.claim(this.file("active", `${slug}.json`), { owner: jobId, until: Date.now() + ttlSec * 1000 });
  }

  releaseActiveJob(slug: string, jobId: string) {
    return this.releaseIfOwner(this.file("active", `${slug}.json`), jobId);
  }

  async getSpend() {
    return (await this.read<number>(this.file("spend.json"))) ?? 0;
  }

  async addSpend(usd: number) {
    if (usd > 0) await this.write(this.file("spend.json"), (await this.getSpend()) + usd);
  }

  async hit(key: string, windowSec: number) {
    const bucket = Math.floor(Date.now() / 1000 / windowSec);
    const file = this.file("ratelimit", `${key.replace(/[^a-zA-Z0-9:._-]/g, "_")}-${bucket}.json`);
    const n = ((await this.read<number>(file)) ?? 0) + 1;
    await this.write(file, n);
    return n;
  }
}
