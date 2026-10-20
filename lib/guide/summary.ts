import type { Guide, Path } from "./schema";

export function recommendedPath(g: Guide): Path {
  return g.paths.find((p) => p.id === g.recommendedPathId) ?? g.paths[0];
}

/** Who can connect before the provider approves anything, on the recommended path. */
export function beforeApproval(g: Guide): string {
  const p = recommendedPath(g);
  const stage = p.stages.find((s) => s.kind === "test") ?? p.stages.find((s) => s.kind === "configure") ?? p.stages[0];
  return stage?.access ?? "";
}

export function cardInfo(g: Guide) {
  const p = recommendedPath(g);
  return {
    slug: g.slug,
    name: g.app.name,
    platform: g.provider.name,
    difficulty: g.summary.difficulty,
    label: g.summary.difficultyLabel,
    headline: g.summary.headline,
    effort: p.handsOnEffortHours.label,
    wait: p.approvalWaitDays.label,
    beforeApproval: beforeApproval(g),
    managed: g.composio.managed,
    verification: g.verification.status,
    pathName: p.name,
  };
}
export type CardInfo = ReturnType<typeof cardInfo>;
