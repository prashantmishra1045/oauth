import { z } from "zod";
import raw from "@/data/apps.json";

/** The 100-app catalog: which apps the library covers or can generate on demand. */
export const CatalogApp = z.object({
  slug: z.string(),
  name: z.string(),
  website: z.string(),
  category: z.string(),
  composioToolkit: z.string(),
  composioManaged: z.enum(["yes", "no", "unknown"]),
  providerPlatform: z.string(),
  featured: z.boolean(),
});
export type CatalogApp = z.infer<typeof CatalogApp>;

export const CATALOG: CatalogApp[] = z.array(CatalogApp).parse(raw);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Registrable-ish host for matching: "https://www.notion.so/x" -> "notion.so" */
export function hostOf(input: string): string | null {
  const trimmed = input.trim();
  if (!/[.]/.test(trimmed) || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

const ALIASES: Record<string, string> = {
  x: "twitter",
  xcom: "twitter",
  twitterx: "twitter",
  googlemail: "gmail",
  microsoftoutlook: "outlook",
  microsoftgraph: "outlook",
  office365: "outlook",
};

function urlParts(input: string): { host: string; segs: string[] } | null {
  const host = hostOf(input);
  if (!host) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
    return { host, segs: url.pathname.toLowerCase().split("/").filter(Boolean) };
  } catch {
    return null;
  }
}

const CATALOG_URLS = CATALOG.map((app) => ({ app, url: urlParts(app.website) }));

/** Several catalog apps share a host (workspace.google.com, microsoft.com): pick by path, or decline to guess. */
function matchByUrl(q: { host: string; segs: string[] }): CatalogApp | null {
  const related = CATALOG_URLS.filter(
    (c): c is { app: CatalogApp; url: { host: string; segs: string[] } } =>
      c.url !== null && (c.url.host === q.host || q.host.endsWith(`.${c.url.host}`) || c.url.host.endsWith(`.${q.host}`)),
  );
  const exact = related.filter((c) => c.url.host === q.host);
  const pool = exact.length ? exact : related;
  const byPath = pool
    .filter((c) => c.url.segs.length > 0 && c.url.segs.every((s, i) => q.segs[i] === s))
    .sort((a, b) => b.url.segs.length - a.url.segs.length);
  if (byPath[0]) return byPath[0].app;
  if (pool.length === 1) return pool[0].app;
  const roots = pool.filter((c) => c.url.segs.length === 0);
  return roots.length === 1 ? roots[0].app : null;
}

const byName = (key: string) =>
  CATALOG.find((a) => norm(a.name) === key || norm(a.slug) === key || (a.composioToolkit !== "" && norm(a.composioToolkit) === key)) ?? null;

/** Matches a free-text query or URL to a catalog entry without calling a model. */
export function matchCatalog(query: string): CatalogApp | null {
  const q = urlParts(query);
  if (q) {
    const hit = matchByUrl(q);
    if (hit) return hit;
    // A bare domain that differs from the catalog's (notion.so vs notion.com) matches on its name part,
    // but not subdomains (myapp.github.io is not GitHub) and not via aliases (x.ai is not X).
    const labels = q.host.split(".");
    return labels.length === 2 ? byName(norm(labels[0])) : null;
  }
  const key = norm(query);
  if (!key) return null;
  const aliased = ALIASES[key];
  return (aliased ? CATALOG.find((a) => a.slug === aliased) : undefined) ?? byName(key);
}
