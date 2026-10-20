import type { Evidence, Guide } from "./schema";

const OWNER = { agent: "🤖 Agent", developer: "👤 You", provider: "⏳ Provider" } as const;
const KIND = { tested: "Tested", documented: "Documented", reported: "Reported", inferred: "Inferred" } as const;

/** A self-contained Markdown version of a guide, for pasting into a ticket, doc or PR. */
export function guideToMarkdown(g: Guide, url: string): string {
  const src = new Map(g.sources.map((s, i) => [s.id, i + 1]));
  const ev = (e: Evidence) => {
    const refs = e.sourceIds.map((id) => `[${src.get(id)}]`).join("");
    return `_(${KIND[e.kind]}, ${e.confidence} confidence${refs ? ` ${refs}` : ""})_`;
  };
  const lines: string[] = [];
  const push = (...l: string[]) => lines.push(...l);

  push(`# ${g.app.name}: OAuth app setup & approval guide`, "");
  push(`> ${g.summary.headline}`, "");
  push(`**Difficulty:** ${g.summary.difficulty}/5 (${g.summary.difficultyLabel}) · **OAuth platform:** ${g.provider.name} · **Composio managed app:** ${g.composio.managed}`);
  push(`**Verification:** ${g.verification.status} — ${g.verification.summary}`);
  push(`**Generated:** ${g.meta.generatedAt.slice(0, 10)} (${g.meta.generatedBy}) · **Online version:** ${url}`, "");
  push(g.summary.overview, "");
  if (g.summary.drivers.length) push(`**What drives the difficulty:** ${g.summary.drivers.join("; ")}`, "");
  push(`- **Best case:** ${g.summary.bestCase}`, `- **Worst case:** ${g.summary.worstCase}`, "");

  for (const p of g.paths) {
    const rec = p.id === g.recommendedPathId ? " (recommended)" : "";
    push(`## Path: ${p.name}${rec}`, "");
    push(p.summary, "", `**When you need it:** ${p.whenYouNeedIt}`);
    if (p.exampleScopes.length) push(`**Example scopes:** ${p.exampleScopes.map((s) => `\`${s}\``).join(", ")}`);
    push(
      `**Hands-on effort:** ${p.handsOnEffortHours.label} ${ev(p.handsOnEffortHours.evidence)}`,
      `**Waiting on the provider:** ${p.approvalWaitDays.label} ${ev(p.approvalWaitDays.evidence)}`,
      `**End state:** ${p.endState}`,
      "",
    );
    for (const st of p.stages) {
      push(`### ${st.name}`, "", `*Who can connect at this stage:* ${st.access}`, "");
      for (const step of st.steps) {
        push(`- [ ] **${step.title}** — ${OWNER[step.owner]} · ${step.duration} ${ev(step.evidence)}`);
        push(`  ${step.detail}`);
        if (step.agentAssist) push(`  *Agent can help:* ${step.agentAssist}`);
        if (step.url) push(`  ${step.url}`);
      }
      push("");
    }
  }

  push(`## What an agent can do vs. what you must do`, "", `**Agent can:**`, ...g.agentVsYou.agentCan.map((x) => `- ${x}`), "", `**You must:**`, ...g.agentVsYou.youMust.map((x) => `- ${x}`), "");

  push(`## Requirements`, "");
  const pathName = new Map(g.paths.map((p) => [p.id, p.name]));
  for (const r of g.requirements) {
    const scope = r.pathIds.length ? ` (only for: ${r.pathIds.map((id) => pathName.get(id) ?? id).join(", ")})` : "";
    push(`- [ ] **${r.title}**${r.mandatory ? "" : " (optional)"}${scope} — ${r.detail} ${ev(r.evidence)}`);
  }
  push("", `## Nuances`, "");
  for (const n of g.nuances) push(`- **${n.title}** (${n.impact} impact) — ${n.detail} ${ev(n.evidence)}`);
  push("", `## Blockers and how to proceed`, "");
  for (const b of g.blockers) {
    push(`### ${b.title}`, `- **Symptom:** ${b.symptom}`, `- **Cause:** ${b.cause}`, `- **How to proceed:** ${b.resolution}`);
    if (b.escalation) push(`- **Escalate:** ${b.escalation}`);
    push("");
  }

  push(`## OAuth details`, "", `| | |`, `|---|---|`);
  push(`| Authorization URL | ${g.oauth.authorizationUrl || "—"} |`, `| Token URL | ${g.oauth.tokenUrl || "—"} |`, `| PKCE | ${g.oauth.pkce} |`);
  push(`| Refresh tokens | ${g.oauth.refreshTokens} |`, `| Token lifetime | ${g.oauth.tokenLifetime} |`, `| Redirect URIs | ${g.oauth.redirectUris} |`);
  push(`| Scopes | ${g.oauth.scopes} |`, `| Dynamic client registration | ${g.oauth.dynamicClientRegistration} |`, "");
  push(`**Composio:** ${g.composio.note}`, "");

  if (g.artifacts.length) {
    push(`## Drafts prepared by the agent`, "");
    for (const a of g.artifacts) {
      // The fence must be longer than any backtick run inside the content, or embedded code blocks close it early.
      const longestRun = Math.max(0, ...(a.content.match(/`+/g) ?? []).map((s) => s.length));
      const fence = "`".repeat(Math.max(3, longestRun + 1));
      push(`### ${a.title}`, "", a.howToUse, "", fence + (a.format === "markdown" || a.format === "text" ? "" : a.format), a.content, fence, "");
    }
  }

  if (g.probes.length) {
    push(`## What we tested`, "");
    for (const p of g.probes) push(`- **${p.name}** (${p.outcome}, ${p.ranAt.slice(0, 10)}): \`${p.request}\` → ${p.observed}. ${p.conclusion}`);
    push("");
  }

  if (g.openQuestions.length) push(`## Not verified / open questions`, "", ...g.openQuestions.map((q) => `- ${q}`), "");

  push(`## Sources`, "");
  g.sources.forEach((s, i) => push(`${i + 1}. [${s.title}](${s.url}) — ${s.publisher}, accessed ${s.accessedAt}`));
  push("");
  return lines.join("\n");
}
