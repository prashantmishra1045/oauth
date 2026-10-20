import { describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/catalog";
import { listLibraryGuides } from "@/lib/guide/library";
import { DIFFICULTY_LABELS, checkGuideIntegrity } from "@/lib/guide/schema";
import { guideToMarkdown } from "@/lib/guide/markdown";

const guides = listLibraryGuides();

describe("library guides", () => {
  it("has guides", () => {
    expect(guides.length).toBeGreaterThan(0);
  });

  it.each(guides.map((g) => [g.slug, g] as const))("%s passes integrity checks", (_slug, g) => {
    expect(checkGuideIntegrity(g)).toEqual([]);
    expect(g.summary.difficultyLabel).toBe(DIFFICULTY_LABELS[g.summary.difficulty - 1]);
    expect(g.paths.find((p) => p.id === g.recommendedPathId)?.difficulty).toBe(g.summary.difficulty);
  });

  it.each(guides.map((g) => [g.slug, g] as const))("%s is in the catalog", (slug) => {
    expect(CATALOG.find((a) => a.slug === slug)).toBeTruthy();
  });

  it.each(guides.map((g) => [g.slug, g] as const))("%s exports to Markdown with every source", (_slug, g) => {
    const md = guideToMarkdown(g, `https://example.com/guides/${g.slug}`);
    expect(md).toContain(g.summary.headline);
    for (const s of g.sources) expect(md).toContain(s.url);
  });
});

describe("catalog", () => {
  it("has 100 unique slugs with 12 featured", () => {
    expect(CATALOG).toHaveLength(100);
    expect(new Set(CATALOG.map((a) => a.slug)).size).toBe(100);
    expect(CATALOG.filter((a) => a.featured)).toHaveLength(12);
  });
});
