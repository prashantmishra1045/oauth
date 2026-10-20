import type { Probe } from "@/lib/guide/schema";
import { BlockedUrlError, probeFetch } from "./net";

/**
 * Read-only probes the research agent can run. Each returns a Probe record
 * (kept verbatim in the guide's "What we tested" section) plus a compact text
 * summary for the model.
 */

export interface ProbeResult {
  probe: Omit<Probe, "id">;
  summary: string;
}

const now = () => new Date().toISOString();

function snippet(text: string, max = 280): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function pageText(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
  return { title: snippet(title, 120), text: snippet(text, 600) };
}

function failure(name: string, kind: Probe["kind"], request: string, err: unknown): ProbeResult {
  const reason = err instanceof BlockedUrlError ? `blocked: ${err.message}` : `request failed: ${(err as Error).message}`;
  return {
    probe: { name, kind, request, observed: reason, conclusion: "Probe could not run.", outcome: "failed", ranAt: now() },
    summary: `${name}: ${reason}`,
  };
}

export async function probeOAuthMetadata(issuer: string): Promise<ProbeResult> {
  const base = issuer.replace(/\/+$/, "");
  const candidates = [`${base}/.well-known/openid-configuration`, `${base}/.well-known/oauth-authorization-server`];
  try {
    const u = new URL(base);
    if (u.pathname && u.pathname !== "/") {
      // RFC 8414 path insertion: https://host/.well-known/oauth-authorization-server/<path>
      candidates.push(`${u.origin}/.well-known/oauth-authorization-server${u.pathname}`);
      candidates.push(`${u.origin}/.well-known/openid-configuration${u.pathname}`);
    }
  } catch {
    return failure("OAuth metadata discovery", "oauth_metadata", `GET ${base}/.well-known/*`, new BlockedUrlError(`not a URL: ${issuer}`));
  }

  const tried: string[] = [];
  for (const url of candidates) {
    try {
      const res = await probeFetch(url, { maxBytes: 200_000 });
      tried.push(`${url} -> ${res.status}`);
      if (res.status !== 200) continue;
      let meta: Record<string, unknown>;
      try {
        meta = JSON.parse(res.body);
      } catch {
        continue;
      }
      const pkce = (meta.code_challenge_methods_supported as string[] | undefined) ?? [];
      const facts = {
        issuer: meta.issuer,
        authorization_endpoint: meta.authorization_endpoint,
        token_endpoint: meta.token_endpoint,
        registration_endpoint: meta.registration_endpoint ?? null,
        code_challenge_methods_supported: pkce,
        grant_types_supported: meta.grant_types_supported ?? null,
        token_endpoint_auth_methods_supported: meta.token_endpoint_auth_methods_supported ?? null,
        scopes_supported_count: Array.isArray(meta.scopes_supported) ? meta.scopes_supported.length : null,
      };
      const observed = `200 JSON: ${snippet(JSON.stringify(facts), 600)}`;
      const conclusion = [
        `Discovery document is published.`,
        pkce.length ? `PKCE methods advertised: ${pkce.join(", ")}.` : `No PKCE methods advertised (does not prove PKCE is unsupported).`,
        meta.registration_endpoint ? `Dynamic client registration endpoint advertised.` : `No dynamic client registration endpoint advertised.`,
      ].join(" ");
      return {
        probe: { name: "OAuth metadata discovery", kind: "oauth_metadata", request: `GET ${url}`, observed, conclusion, outcome: "confirmed", ranAt: now() },
        summary: `${url}: ${JSON.stringify(facts)}`,
      };
    } catch (err) {
      tried.push(`${url} -> ${(err as Error).message}`);
    }
  }
  const observed = tried.join("; ");
  return {
    probe: {
      name: "OAuth metadata discovery",
      kind: "oauth_metadata",
      request: candidates.map((c) => `GET ${c}`).join("; "),
      observed: snippet(observed, 600),
      conclusion: "No discovery document found; endpoints must come from the provider's docs.",
      outcome: "inconclusive",
      ranAt: now(),
    },
    summary: `No OAuth/OIDC discovery document at ${base}. Tried: ${observed}`,
  };
}

export async function probeAuthorizeEndpoint(authorizeUrl: string, scope: string): Promise<ProbeResult> {
  let url: URL;
  try {
    url = new URL(authorizeUrl);
  } catch {
    return failure("Authorization endpoint", "authorize_endpoint", `GET ${authorizeUrl}`, new BlockedUrlError("not a URL"));
  }
  url.searchParams.set("client_id", "greenlight-probe-invalid");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", "https://example.com/callback");
  url.searchParams.set("state", "greenlight-probe");
  if (scope) url.searchParams.set("scope", scope);
  const request = `GET ${url.toString()} (redirects not followed)`;
  try {
    const res = await probeFetch(url.toString());
    const { title, text } = pageText(res.body);
    let errorInfo = "";
    if (res.location) {
      try {
        const loc = new URL(res.location, url);
        const e = loc.searchParams.get("error");
        const d = loc.searchParams.get("error_description");
        errorInfo = e ? `redirect carries error=${e}${d ? ` (${snippet(d, 160)})` : ""}` : `redirects to ${loc.origin}${loc.pathname}`;
      } catch {
        errorInfo = `redirects to ${snippet(res.location, 160)}`;
      }
    }
    const errorText = /(invalid[_ ]client|unauthorized[_ ]client|client[_ ]id|invalid[_ ]request|not found|doesn.t exist|does not exist)/i.exec(text)?.[0] ?? "";
    const observed = [`HTTP ${res.status}`, errorInfo, title && `title "${title}"`, errorText && `page mentions "${errorText}"`, !errorInfo && !errorText ? `body: ${snippet(text, 200)}` : ""]
      .filter(Boolean)
      .join("; ");

    // Say only what was observed: a login redirect proves the endpoint is live, not that the client was checked.
    let conclusion: string;
    let outcome: Probe["outcome"] = "confirmed";
    if (res.status >= 500) {
      conclusion = "The authorization endpoint returned a server error; result inconclusive.";
      outcome = "inconclusive";
    } else if (/error=/.test(res.location) || /\/error/i.test(res.location) || errorText) {
      conclusion = "The authorization endpoint is live and rejects an unregistered client_id; a client ID from a registered app is required.";
    } else if (/log-?in|sign-?in|ServiceLogin|auth/i.test(res.location)) {
      conclusion = "The authorization endpoint is live; it sends the user to sign in before validating the client, so client validation could not be observed without an account.";
    } else if (res.status >= 400) {
      conclusion = `The authorization endpoint is live and rejected the request with HTTP ${res.status}.`;
    } else {
      conclusion = "The authorization endpoint responded, but the response did not show how it treats an unregistered client.";
      outcome = "inconclusive";
    }
    return {
      probe: { name: "Authorization endpoint with an unregistered client", kind: "authorize_endpoint", request, observed, conclusion, outcome, ranAt: now() },
      summary: `${request}: ${observed} — ${conclusion}`,
    };
  } catch (err) {
    return failure("Authorization endpoint with an unregistered client", "authorize_endpoint", request, err);
  }
}

export async function probePage(target: string, purpose: string): Promise<ProbeResult> {
  const name = purpose ? `Page check: ${snippet(purpose, 60)}` : "Developer portal access";
  const request = `GET ${target} (redirects not followed)`;
  try {
    const res = await probeFetch(target);
    const { title, text } = pageText(res.body);
    const loginRedirect = /log-?in|sign-?in|auth|accounts\./i.test(res.location);
    const loginWall = loginRedirect || /\b(sign in|log in|login)\b/i.test(title);
    const observed = [`HTTP ${res.status}`, res.location && `Location: ${snippet(res.location, 160)}`, title && `title "${title}"`, `text: ${snippet(text, 220)}`]
      .filter(Boolean)
      .join("; ");
    return {
      probe: {
        name,
        kind: "portal_access",
        request,
        observed,
        conclusion: loginWall
          ? "The page requires signing in; creating an app needs an account with the provider."
          : res.status >= 400
            ? "The page did not load publicly."
            : "The page is publicly reachable.",
        outcome: res.status >= 500 ? "inconclusive" : "confirmed",
        ranAt: now(),
      },
      summary: `${request}: ${observed}`,
    };
  } catch (err) {
    return failure(name, "portal_access", request, err);
  }
}
