import { MODEL } from "./client";
import type { Usage } from "./types";

/**
 * Estimated API cost of a job, used for the deployment's spend cap and shown
 * on finished jobs. Prices are USD per million tokens (first-party API list
 * prices); cache writes use the 5-minute TTL rate (1.25x input).
 */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};
const WEB_SEARCH_USD = 0.01; // $10 per 1,000 searches

export function estimateCostUsd(usage: Usage, model = MODEL): number {
  const p = PRICES[model] ?? PRICES["claude-opus-5-5"];
  return (
    (usage.inputTokens * p.input + usage.cacheWriteTokens * p.input * 1.25 + usage.cacheReadTokens * p.cacheRead + usage.outputTokens * p.output) / 1e6 +
    usage.webSearches * WEB_SEARCH_USD
  );
}

export const formatUsd = (usd: number) => `$${usd.toFixed(2)}`;

/** Total the deployment may spend on live generation (checked before each new job starts). */
export function budgetUsd(): number {
  return Number(process.env.GENERATION_BUDGET_USD || 10);
}
