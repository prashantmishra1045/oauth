// End-to-end run of the live pipeline outside Next.js, printing the agent's
// progress as it happens. Used by the "Live agent smoke test" GitHub Action,
// which supplies ANTHROPIC_API_KEY from the repository secret.
//
// Usage: ANTHROPIC_API_KEY=... npx tsx scripts/smoke-live.ts "Calendly" [outDir]
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { replayEnabled, runJob, startJob } from "../lib/agent/pipeline";
import { liveGenerationConfigured, MODEL } from "../lib/agent/client";
import { estimateCostUsd, formatUsd } from "../lib/agent/cost";
import { Guide, checkGuideIntegrity } from "../lib/guide/schema";
import { getStore } from "../lib/store";

const query = process.argv[2];
const outDir = process.argv[3] ?? "smoke-output";
if (!query) {
  console.error('usage: tsx scripts/smoke-live.ts "<app name or URL>" [outDir]');
  process.exit(2);
}
if (!liveGenerationConfigured() && !replayEnabled()) {
  console.error("ANTHROPIC_API_KEY is not set (or set GREENLIGHT_REPLAY=1 to exercise the flow without it).");
  process.exit(2);
}

async function main() {
  const store = getStore();
  const started = Date.now();
  const res = await startJob({ query, origin: "http://localhost", ip: `smoke-${started}` });
  if (res.kind === "error") throw new Error(res.message);
  if (res.kind === "guide") {
    console.log(`"${query}" already has a guide (${res.slug}); pick an app outside the library.`);
    return;
  }

  let cursor = 0;
  const log: string[] = [];
  const printNew = async () => {
    for (const e of await store.getEvents(res.jobId, cursor)) {
      cursor = e.seq + 1;
      const line = `[${((Date.parse(e.at) - started) / 1000).toFixed(0).padStart(4)}s] ${e.stage.padEnd(8)} ${e.kind.padEnd(7)} ${e.message}${e.detail ? `\n${" ".repeat(24)}${e.detail.replace(/\n/g, `\n${" ".repeat(24)}`)}` : ""}`;
      log.push(line);
      console.log(line);
    }
  };
  const ticker = setInterval(printNew, 1000);
  await runJob(res.jobId, { singleProcess: true });
  clearInterval(ticker);
  await printNew();

  const job = await store.getJob(res.jobId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "events.log"), log.join("\n") + "\n");
  writeFileSync(path.join(outDir, "job.json"), JSON.stringify(job, null, 2));
  if (!job || job.status !== "done" || !job.guideSlug) {
    throw new Error(`job ended ${job?.status}: ${job?.error ?? "no guide"}`);
  }
  const guide = Guide.parse(await store.getGuide(job.guideSlug));
  const problems = checkGuideIntegrity(guide);
  writeFileSync(path.join(outDir, `${guide.slug}.json`), JSON.stringify(guide, null, 2));

  const summary = [
    `## Live agent smoke test: ${guide.app.name}`,
    "",
    `- Model: \`${MODEL}\` · duration ${guide.meta.durationSec}s`,
    `- Difficulty ${guide.summary.difficulty} (${guide.summary.difficultyLabel}) — ${guide.summary.headline}`,
    `- ${guide.paths.length} path(s), ${guide.sources.length} sources, ${guide.probes.length} probes`,
    `- Usage: ${job.usage.inputTokens} input + ${job.usage.cacheWriteTokens} cache-write + ${job.usage.cacheReadTokens} cache-read / ${job.usage.outputTokens} output tokens, ${job.usage.webSearches} searches, ${job.usage.webFetches} fetches — about ${formatUsd(estimateCostUsd(job.usage))}`,
    `- Verification: ${guide.verification.status} — ${guide.verification.summary}`,
    `- Integrity: ${problems.length ? problems.join("; ") : "ok"}`,
    "",
  ].join("\n");
  console.log(`\n${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (problems.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
