import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Probe } from "@/lib/guide/schema";
import { BETAS, MODEL } from "./client";
import { addUsage, RefusalError, streamTurn } from "./loop";
import { RESEARCH_PROTOCOL } from "./protocol";
import { GuideDraft, type Findings, type NewJobEvent, type Resolution, type Usage } from "./types";

const SYSTEM = `${RESEARCH_PROTOCOL}

## Your task now
Write the guide from the research findings and probe results you are given.
- Use only facts from the findings and probes. If the guide needs something the findings lack, say so plainly with evidence kind "inferred", confidence "low", and add an open question.
- sources: one entry per distinct URL you cite, ids s1, s2, ...; use the excerpt from the findings for that URL. Every documented or reported claim cites at least one source id. "tested" claims cite no source; their note names the probe (e.g. "probe p2: authorize endpoint rejected an unknown client").
- Keep it tight for a live guide: 1-2 paths (two only when difficulty differs by access tier), 3-5 stages per path, 2-4 steps per stage, 5-8 requirements, 4-7 nuances, 3-5 blockers, 1-2 artifacts, at most 15 sources. Short, concrete sentences.
- ids are kebab-case and unique within their list.`;

// The schema only, without the helper's parse(): the SDK would otherwise parse
// inside the stream and hide refusals and truncation behind a generic parse error.
const DRAFT_SCHEMA = betaZodOutputFormat(GuideDraft).schema;

export async function draftGuide(args: {
  client: Anthropic;
  resolution: Resolution;
  composio: { managed: "yes" | "no" | "unknown"; toolkitSlug: string; note: string };
  findings: Findings;
  probes: Omit<Probe, "id">[];
  emit(e: NewJobEvent): void;
  usage: Usage;
  deadline: number;
}): Promise<GuideDraft> {
  const prompt = `Resolved app:
${JSON.stringify(args.resolution, null, 2)}

Composio (from a snapshot of Composio's managed-auth directory; use these values): managed = "${args.composio.managed}", toolkitSlug = "${args.composio.toolkitSlug}". Note: ${args.composio.note}

Probes that were run (ids p1..pn in this order):
${JSON.stringify(args.probes.map((p, i) => ({ id: `p${i + 1}`, ...p })), null, 2)}

Research findings:
${JSON.stringify(args.findings, null, 2)}

Write the guide now.`;

  const params = {
    model: MODEL,
    max_tokens: 48000,
    betas: BETAS,
    fallbacks: "default" as const,
    thinking: { type: "adaptive" as const, display: "updates" as const },
    system: SYSTEM,
    messages: [{ role: "user" as const, content: prompt }],
  };
  const effort = (process.env.GREENLIGHT_DRAFT_EFFORT as "low") || "low";

  const read = (msg: Anthropic.Beta.Messages.BetaMessage): GuideDraft => {
    addUsage(args.usage, msg);
    if (msg.stop_reason === "refusal") throw new RefusalError("The model declined to write the guide.");
    if (msg.stop_reason === "max_tokens") throw new Error("The guide draft hit the output limit.");
    const text = finalText(msg).replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("The guide draft was not valid JSON.");
    }
    const parsed = GuideDraft.safeParse(json);
    if (!parsed.success) {
      throw new Error(`The guide draft did not match the schema: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
    }
    return parsed.data;
  };

  try {
    return read(await streamTurn(args.client, { ...params, output_config: { effort, format: { type: "json_schema", schema: DRAFT_SCHEMA } } }, { abortAt: args.deadline }));
  } catch (err) {
    // A schema the structured-output compiler rejects is a 400; retry once as plain JSON validated locally.
    if (!(err instanceof Anthropic.BadRequestError)) throw err;
    args.emit({ stage: "draft", kind: "warn", message: "Structured output unavailable; drafting as plain JSON instead.", detail: err.message.slice(0, 200) });
    return read(
      await streamTurn(
        args.client,
        {
          ...params,
          output_config: { effort },
          messages: [
            {
              role: "user",
              content: `${prompt}\n\nReply with only the guide as one JSON object (no prose, no code fence) matching this JSON Schema:\n${JSON.stringify(DRAFT_SCHEMA)}`,
            },
          ],
        },
        { abortAt: args.deadline },
      ),
    );
  }
}

/** Text written after the last fallback marker (the declined model's partial text is not the answer). */
function finalText(msg: Anthropic.Beta.Messages.BetaMessage): string {
  const cut = msg.content.map((b) => b.type).lastIndexOf("fallback");
  return msg.content
    .slice(cut + 1)
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
