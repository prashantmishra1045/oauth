import { LIBRARY_GUIDES_RAW } from "@/data/guides";
import { Guide, checkGuideIntegrity } from "./schema";

/**
 * The curated library: guides researched and adversarially verified ahead of
 * time (data/guides/*.json). Invalid files fail loudly at startup rather than
 * rendering half a guide.
 */
const guides: Guide[] = LIBRARY_GUIDES_RAW.map((raw, i) => {
  const parsed = Guide.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`library guide #${i} is invalid: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  }
  const problems = checkGuideIntegrity(parsed.data);
  if (problems.length) throw new Error(`library guide ${parsed.data.slug}: ${problems[0]}`);
  return parsed.data;
});

const bySlug = new Map(guides.map((g) => [g.slug, g]));

export function listLibraryGuides(): Guide[] {
  return [...guides].sort((a, b) => a.summary.difficulty - b.summary.difficulty || a.app.name.localeCompare(b.app.name));
}

export function getLibraryGuide(slug: string): Guide | null {
  return bySlug.get(slug) ?? null;
}

export function isLibrarySlug(slug: string): boolean {
  return bySlug.has(slug);
}
