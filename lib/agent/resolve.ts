import type Anthropic from "@anthropic-ai/sdk";
import { CATALOG, hostOf, matchCatalog, slugify, type CatalogApp } from "@/lib/catalog";
import { isLibrarySlug } from "@/lib/guide/library";
import { runAgentLoop } from "./loop";
import { Resolution, type NewJobEvent, type Usage } from "./types";

export function resolutionFromCatalog(app: CatalogApp): Resolution {
  return {
    name: app.name,
    slug: app.slug,
    website: app.website,
    category: app.category,
    providerPlatform: app.providerPlatform,
    developerDocsUrl: "",
    oauthLikely: "yes",
    note: "Matched in the Greenlight catalog.",
  };
}

/** Cheap catalog match first; otherwise a short search to pin down which app and whose OAuth it is. */
export async function resolveApp(args: {
  client: Anthropic;
  query: string;
  emit(e: NewJobEvent): void;
  usage: Usage;
  deadline: number;
}): Promise<{ resolution: Resolution; catalog: CatalogApp | null }> {
  const catalog = matchCatalog(args.query);
  if (catalog) {
    args.emit({ stage: "resolve", kind: "note", message: `Matched "${args.query}" to ${catalog.name} in the catalog.` });
    return { resolution: resolutionFromCatalog(catalog), catalog };
  }

  const resolution = await runAgentLoop({
    client: args.client,
    stage: "resolve",
    effort: "low",
    system: `You identify software products for an OAuth setup research tool. Given a product name or URL, find the product's official website, whose OAuth it uses (the platform where a developer registers an OAuth app), and the developer documentation URL for OAuth or app registration. Use at most two searches. If the product does not offer OAuth to third-party developers, set oauthLikely to "no" and explain in note. Then call submit_resolution.`,
    prompt: `Product: ${args.query}`,
    tools: [],
    webSearchMaxUses: 2,
    webFetchMaxUses: 0,
    submit: { name: "submit_resolution", description: "Submit the identified product.", schema: Resolution },
    softDeadline: args.deadline - 15_000,
    hardDeadline: args.deadline,
    maxTurns: 4,
    emit: args.emit,
    usage: args.usage,
  });
  // A model-resolved app might still be in the catalog under its canonical name or site.
  const second = matchCatalog(resolution.name) ?? matchCatalog(resolution.website);
  if (second) return { resolution: resolutionFromCatalog(second), catalog: second };

  // Not a catalog app, so it may not take a catalog or library slug (that would publish
  // its content under another app's name).
  let slug = slugify(resolution.slug || resolution.name) || "app";
  if (CATALOG.some((a) => a.slug === slug) || isLibrarySlug(slug)) {
    slug = slugify(`${slug}-${hostOf(resolution.website) ?? "other"}`);
  }
  resolution.slug = slug;
  return { resolution, catalog: null };
}
