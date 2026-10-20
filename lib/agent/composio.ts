import snapshot from "@/data/composio-managed-auth.json";

/**
 * Whether Composio offers a managed OAuth app for a toolkit, from a snapshot of
 * https://docs.composio.dev/toolkits/managed-auth.md (date in the JSON).
 */

export interface ComposioToolkit {
  name: string;
  slug: string;
  managed: boolean;
  docsPath: string;
}

export const COMPOSIO_SOURCE_URL = "https://docs.composio.dev/toolkits/managed-auth";
export const COMPOSIO_CUSTOM_AUTH_URL = "https://docs.composio.dev/docs/authentication/custom-app-vs-managed-app";
export const COMPOSIO_SNAPSHOT_DATE = snapshot.fetchedAt;

const toolkits = snapshot.toolkits as ComposioToolkit[];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function lookupComposio(...candidates: string[]): ComposioToolkit | null {
  const keys = candidates.filter(Boolean).map(norm).filter(Boolean);
  // Exact matches only: "Notion" must not match "Notion MCP", which is a separate toolkit.
  for (const key of keys) {
    const hit = toolkits.find((t) => norm(t.name) === key || norm(t.slug) === key);
    if (hit) return hit;
  }
  return null;
}

export function composioNote(hit: ComposioToolkit | null, appName: string): string {
  if (!hit) {
    return `${appName} is not in Composio's managed-auth directory (snapshot ${COMPOSIO_SNAPSHOT_DATE}), so expect to bring your own OAuth app if you use it through Composio.`;
  }
  return hit.managed
    ? `Composio offers a managed OAuth app for ${hit.name} (toolkit ${hit.slug}), so you can start without your own. Bring your own for your branding on the consent screen, a dedicated quota, custom scopes or faster polling triggers.`
    : `${hit.name} (toolkit ${hit.slug}) is bring-your-own in Composio: you must register your own OAuth app and paste its client ID and secret into a Composio auth config.`;
}
