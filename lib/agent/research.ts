import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Probe } from "@/lib/guide/schema";
import { COMPOSIO_CUSTOM_AUTH_URL, COMPOSIO_SOURCE_URL } from "./composio";
import { runAgentLoop, type ClientTool } from "./loop";
import { probeAuthorizeEndpoint, probeOAuthMetadata, probePage, type ProbeResult } from "./probes";
import { PROBE_GUIDANCE, RESEARCH_PROTOCOL } from "./protocol";
import { Findings, type NewJobEvent, type Resolution, type Usage } from "./types";

const SYSTEM = `${RESEARCH_PROTOCOL}

${PROBE_GUIDANCE}

## How to work in this session (live, about two to three minutes)
- Tools: web_search, web_fetch, and three read-only probes (probe_oauth_metadata, probe_authorize_endpoint, probe_page).
- Start by running the probes you can already aim (the likely OAuth issuer, the authorization endpoint, the app console) in parallel with your first searches.
- Plan the 4-6 searches that matter most: official app registration and OAuth docs, the review or verification process, limits before approval, recent policy changes (last 18 months), and real-world review times and rejection reasons.
- Read the 4-8 most authoritative pages. web_fetch can only open URLs that already appear in this conversation (this prompt or search results).
- Finish by calling submit_findings exactly once. Facts are atomic statements, each with the exact source URL and a short excerpt copied from that page. Record 15-35 facts covering every item in "What to establish". Label reported vs documented honestly; probe observations are "tested" with an empty sourceUrl.`;

export async function researchApp(args: {
  client: Anthropic;
  resolution: Resolution;
  composioNote: string;
  emit(e: NewJobEvent): void;
  usage: Usage;
  softDeadline: number;
  hardDeadline: number;
  onProbe(p: Omit<Probe, "id">): void;
}): Promise<Findings> {
  const record = (label: string) => (r: ProbeResult) => {
    args.onProbe(r.probe);
    args.emit({
      stage: "research",
      kind: "probe",
      message: `${label}: ${r.probe.outcome}`,
      detail: `${r.probe.request}\n→ ${r.probe.observed}`.slice(0, 600),
    });
    return r.summary;
  };

  const tools: ClientTool[] = [
    {
      name: "probe_oauth_metadata",
      description:
        "Fetch the OAuth/OIDC discovery documents for an issuer (/.well-known/openid-configuration and /.well-known/oauth-authorization-server). Returns endpoints, PKCE methods and whether dynamic client registration is advertised. Read-only.",
      schema: z.object({ issuer: z.string().describe("issuer base URL, e.g. https://accounts.google.com") }),
      run: async (input) => record("OAuth discovery")(await probeOAuthMetadata((input as { issuer: string }).issuer)),
    },
    {
      name: "probe_authorize_endpoint",
      description:
        "Send a GET to the provider's authorization endpoint with an unregistered client_id and a dummy redirect URI, without following redirects, and report how the provider responds. Confirms the endpoint is live and how it rejects unknown clients. Read-only.",
      schema: z.object({
        authorize_url: z.string().describe("the authorization endpoint, without query parameters"),
        scope: z.string().describe("a real scope for this provider, or empty"),
      }),
      run: async (input) => {
        const { authorize_url, scope } = input as { authorize_url: string; scope: string };
        return record("Authorization endpoint")(await probeAuthorizeEndpoint(authorize_url, scope));
      },
    },
    {
      name: "probe_page",
      description:
        "GET a public page (developer portal, app console, app review page) without following redirects and report status, redirect target and title, e.g. to see whether creating an app needs a login or a paid account. Read-only.",
      schema: z.object({ url: z.string(), purpose: z.string().describe("what you are checking, e.g. 'app console login wall'") }),
      run: async (input) => {
        const { url, purpose } = input as { url: string; purpose: string };
        return record("Page check")(await probePage(url, purpose));
      },
    },
  ];

  const prompt = `App to investigate:
${JSON.stringify(args.resolution, null, 2)}

Composio: ${args.composioNote}
Composio sources you may cite or fetch: ${COMPOSIO_SOURCE_URL} and ${COMPOSIO_CUSTOM_AUTH_URL}
Today's date: ${new Date().toISOString().slice(0, 10)}`;

  return runAgentLoop({
    client: args.client,
    stage: "research",
    effort: (process.env.GREENLIGHT_RESEARCH_EFFORT as "medium") || "medium",
    system: SYSTEM,
    prompt,
    tools,
    webSearchMaxUses: 6,
    webFetchMaxUses: 8,
    submit: {
      name: "submit_findings",
      description: "Submit the research findings. Call exactly once, at the end.",
      schema: Findings,
    },
    softDeadline: args.softDeadline,
    hardDeadline: args.hardDeadline,
    maxTurns: 14,
    emit: args.emit,
    usage: args.usage,
  });
}
