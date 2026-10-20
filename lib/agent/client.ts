import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";

export const MODEL = process.env.GREENLIGHT_MODEL || "claude-opus-5-5";

// thinking display "updates" streams the model's short progress notes between
// tool calls (shown in the live feed); "default" fallbacks reroute a request
// that a safety classifier declines instead of failing the job.
export const BETAS: Anthropic.Beta.AnthropicBeta[] = [
  "thinking-display-updates-2026-08-18",
  "server-side-fallback-2026-07-01",
];

export class ConfigError extends Error {}

export function liveGenerationConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Only the deployment's own ANTHROPIC_API_KEY is used. The key, the auth token
 * and the base URL are all set explicitly so the SDK never falls back to
 * ambient credentials (ANTHROPIC_AUTH_TOKEN, `ant` CLI profiles, or an
 * ANTHROPIC_BASE_URL proxy inherited from the shell).
 */
export function createClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ConfigError("Live generation is not configured: set ANTHROPIC_API_KEY for this deployment.");
  }
  return new Anthropic({
    apiKey,
    authToken: null,
    baseURL: process.env.GREENLIGHT_ANTHROPIC_BASE_URL || "https://api.anthropic.com",
    maxRetries: 2,
    timeout: 240_000,
  });
}

/** Shared secret for the internal stage-chaining endpoint, derived so no extra env var is needed. */
export function internalSecret(): string {
  const seed = process.env.GREENLIGHT_INTERNAL_SECRET || process.env.ANTHROPIC_API_KEY || "greenlight-dev";
  return createHash("sha256").update(`greenlight-advance:${seed}`).digest("hex");
}
