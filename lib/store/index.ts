import { Redis } from "@upstash/redis";
import path from "node:path";
import { FileStore } from "./file";
import { RedisStore } from "./redis";
import type { Store } from "./types";

export type { Store, GuideIndexEntry } from "./types";

let store: Store | null = null;

/**
 * Redis when Upstash credentials are present (UPSTASH_* or the KV_* names the
 * Vercel Marketplace integration sets), otherwise a local file store.
 */
export function getStore(): Store {
  if (store) return store;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    store = new RedisStore(new Redis({ url, token }));
  } else {
    // Vercel's filesystem is read-only outside /tmp.
    const root = process.env.VERCEL ? "/tmp/greenlight" : path.join(process.cwd(), ".data");
    store = new FileStore(root);
  }
  return store;
}
