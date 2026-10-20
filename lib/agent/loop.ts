import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { BETAS, MODEL } from "./client";
import type { NewJobEvent, StageName, Usage } from "./types";

type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaToolUnion = Anthropic.Beta.Messages.BetaToolUnion;
type BetaContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export class RefusalError extends Error {}
export class DeadlineError extends Error {}

export interface ClientTool {
  name: string;
  description: string;
  schema: z.ZodType;
  run(input: unknown): Promise<string>;
}

export interface LoopOptions<T> {
  client: Anthropic;
  stage: StageName;
  system: string;
  prompt: string;
  effort: Effort;
  tools: ClientTool[];
  webSearchMaxUses: number;
  webFetchMaxUses: number;
  submit: { name: string; description: string; schema: z.ZodType<T> };
  /** after this, the model is told to submit immediately */
  softDeadline: number;
  /** no request may still be running after this */
  hardDeadline: number;
  maxTurns: number;
  emit(event: NewJobEvent): void;
  usage: Usage;
}

/** zod -> JSON Schema accepted by strict tools: closed objects, every key required, no numeric/length constraints. */
export function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  const drop = ["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "multipleOf", "pattern"];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    for (const key of drop) delete obj[key];
    if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
      obj.additionalProperties = false;
      obj.required = Object.keys(obj.properties as object);
    }
    Object.values(obj).forEach(walk);
  };
  walk(json);
  return json;
}

let fastModeAvailable = process.env.GREENLIGHT_FAST_MODE === "1";

/**
 * Streams one request, aborting it at `abortAt` so no request outlives the
 * function that started it. In fast mode, a request the account can't run fast
 * is retried once at standard speed; fast mode is switched off only if that
 * retry succeeds (proof that fast mode was the problem).
 */
export async function streamTurn(
  client: Anthropic,
  params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
  opts: { abortAt: number; onBlock?: (block: BetaContentBlock) => void },
): Promise<BetaMessage> {
  const attempt = async (fast: boolean) => {
    const remaining = opts.abortAt - Date.now();
    if (remaining < 1000) throw new DeadlineError("out of time before the request started");
    const stream = client.beta.messages.stream(
      {
        ...params,
        betas: fast ? [...(params.betas ?? []), "fast-mode-2026-02-01"] : params.betas,
        ...(fast ? { speed: "fast" as const } : {}),
      },
      { signal: AbortSignal.timeout(remaining) },
    );
    if (opts.onBlock) stream.on("contentBlock", opts.onBlock);
    try {
      return await stream.finalMessage();
    } catch (err) {
      // APIUserAbortError is an APIError subclass, so check it first.
      if (err instanceof Anthropic.APIUserAbortError) throw new DeadlineError("request stopped at the stage deadline");
      throw err;
    }
  };
  if (!fastModeAvailable) return attempt(false);
  try {
    return await attempt(true);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return attempt(false);
    if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.PermissionDeniedError) {
      const msg = await attempt(false);
      fastModeAvailable = false;
      return msg;
    }
    throw err;
  }
}

/** Sums every attempt, including ones a safety classifier declined before a fallback model took over. */
export function addUsage(usage: Usage, msg: BetaMessage) {
  const iterations = (msg.usage.iterations ?? []) as Array<{
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  }>;
  const parts = iterations.length ? iterations : [msg.usage];
  for (const u of parts) {
    usage.inputTokens += u.input_tokens ?? 0;
    usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
    usage.outputTokens += u.output_tokens ?? 0;
  }
  usage.webSearches += msg.usage.server_tool_use?.web_search_requests ?? 0;
  usage.webFetches += msg.usage.server_tool_use?.web_fetch_requests ?? 0;
}

/**
 * The assistant content to send back after a mid-output fallback: blocks before
 * the last `fallback` marker drop thinking, tool_use and unpaired server_tool_use
 * (per the refusal/fallback docs); text, paired server-tool blocks and
 * everything after the marker are kept. Without a fallback, content is unchanged.
 */
export function echoContent(content: BetaContentBlock[]): BetaContentBlock[] {
  const cut = content.map((b) => b.type).lastIndexOf("fallback");
  if (cut < 0) return content;
  const before = content.slice(0, cut);
  const answered = new Set(
    before.filter((b) => b.type.endsWith("_tool_result")).map((b) => (b as unknown as { tool_use_id: string }).tool_use_id),
  );
  const kept = before.filter(
    (b) => b.type === "text" || b.type.endsWith("_tool_result") || (b.type === "server_tool_use" && answered.has(b.id)),
  );
  return [...kept, ...content.slice(cut)];
}

function describeBlock(block: BetaContentBlock, stage: StageName): NewJobEvent | null {
  if (block.type === "server_tool_use") {
    const input = (block.input ?? {}) as { query?: string; url?: string };
    if (block.name === "web_search" && input.query) return { stage, kind: "search", message: `Searching: ${input.query}` };
    if (block.name === "web_fetch" && input.url) return { stage, kind: "fetch", message: `Reading ${input.url}`, url: input.url };
    return null;
  }
  if (block.type === "web_search_tool_result") {
    const content = block.content as unknown;
    if (Array.isArray(content)) {
      const top = content.slice(0, 3).map((r: { title?: string }) => r.title).filter(Boolean);
      return { stage, kind: "search", message: `Found ${content.length} results`, detail: top.join(" · ") };
    }
    return { stage, kind: "warn", message: "A web search failed", detail: JSON.stringify(content).slice(0, 200) };
  }
  if (block.type === "web_fetch_tool_result") {
    const content = block.content as { type?: string; error_code?: string };
    if (content?.type === "web_fetch_tool_result_error" || content?.error_code) {
      return { stage, kind: "warn", message: `Could not read a page (${content.error_code ?? "error"})` };
    }
    return null;
  }
  if (block.type === "thinking" && block.thinking.trim()) {
    // With display "updates" these are the model's short progress notes, not raw reasoning.
    return { stage, kind: "note", message: block.thinking.trim().slice(0, 400) };
  }
  return null;
}

/**
 * Manual agentic loop (the SDK tool runner does not resume pause_turn, and we
 * need per-block progress events and deadlines). Ends when the model calls the
 * submit tool with input that validates. History is append-only: assistant
 * turns go back unchanged (apart from the documented fallback trimming), so
 * preserved-thinking checks never see an edited prefix.
 */
export async function runAgentLoop<T>(opts: LoopOptions<T>): Promise<T> {
  const { client, stage, emit } = opts;
  const clientTools = new Map(opts.tools.map((t) => [t.name, t]));

  const toolDefs: BetaToolUnion[] = [
    ...(opts.webSearchMaxUses > 0 ? [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: opts.webSearchMaxUses }] : []),
    ...(opts.webFetchMaxUses > 0
      ? [{ type: "web_fetch_20260209" as const, name: "web_fetch" as const, max_uses: opts.webFetchMaxUses, max_content_tokens: 12000 }]
      : []),
    ...[...opts.tools, opts.submit].map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: strictJsonSchema(t.schema) as Anthropic.Beta.Messages.BetaTool.InputSchema,
      strict: true,
      eager_input_streaming: true,
    })),
  ];

  const messages: BetaMessageParam[] = [{ role: "user", content: opts.prompt }];
  let nudges = 0;
  let warned = false;
  const warning = () => {
    if (warned || Date.now() < opts.softDeadline) return null;
    warned = true;
    return `Time is almost up. Do not search or fetch any more. Call ${opts.submit.name} now with everything you have; put anything unconfirmed in openQuestions.`;
  };
  /** A user turn, with the deadline warning appended when it is due. */
  const pushUser = (content: Anthropic.Beta.Messages.BetaContentBlockParam[]) => {
    const w = warning();
    messages.push({ role: "user", content: w ? [...content, { type: "text", text: w }] : content });
  };

  for (let turn = 0; turn < opts.maxTurns; turn++) {
    if (Date.now() > opts.hardDeadline - 5000) throw new DeadlineError(`${stage} ran out of time`);

    const msg = await streamTurn(
      client,
      {
        model: MODEL,
        max_tokens: 32000,
        betas: BETAS,
        fallbacks: "default",
        thinking: { type: "adaptive", display: "updates" },
        output_config: { effort: opts.effort },
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        tools: toolDefs,
        messages,
        // Automatic caching of the growing history: each turn re-sends every fetched page,
        // so this cuts the input cost of a research loop several-fold.
        cache_control: { type: "ephemeral" },
      },
      {
        abortAt: opts.hardDeadline,
        onBlock: (block) => {
          const event = describeBlock(block, stage);
          if (event) emit(event);
        },
      },
    );
    addUsage(opts.usage, msg);

    if (msg.stop_reason === "refusal") throw new RefusalError(`The model declined the ${stage} request.`);

    const content = echoContent(msg.content);
    messages.push({ role: "assistant", content });

    if (msg.stop_reason === "pause_turn") {
      // The API resumes from the trailing server tool call: add nothing that would end the turn.
      // A system message is allowed after an assistant turn ending in server-tool use.
      const last = content[content.length - 1];
      if (last?.type === "server_tool_use") {
        const w = warning();
        if (w) messages.push({ role: "system", content: w });
      }
      continue;
    }

    const toolUses = content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");

    if (toolUses.length === 0) {
      if (++nudges > 2) throw new Error(`${stage}: the model stopped without calling ${opts.submit.name}`);
      pushUser([
        {
          type: "text",
          text:
            msg.stop_reason === "max_tokens"
              ? `You ran out of output space. Call ${opts.submit.name} now, more concisely.`
              : `Call ${opts.submit.name} now with your results.`,
        },
      ]);
      continue;
    }

    if (msg.stop_reason === "max_tokens") {
      // A tool input cut off mid-generation can still parse, so run nothing; answer every call.
      if (++nudges > 2) throw new Error(`${stage}: output was cut off repeatedly`);
      pushUser(
        toolUses.map((use) => ({
          type: "tool_result" as const,
          tool_use_id: use.id,
          is_error: true,
          content: `Not run: your output was cut off before this call finished. Call ${opts.submit.name} again, more concisely.`,
        })),
      );
      continue;
    }

    const results = await Promise.all(
      toolUses.map(async (use): Promise<{ result: ToolResult; submitted?: T }> => {
        if (use.name === opts.submit.name) {
          const parsed = opts.submit.schema.safeParse(use.input);
          if (parsed.success) return { result: { type: "tool_result", tool_use_id: use.id, content: "Received." }, submitted: parsed.data };
          const issues = parsed.error.issues
            .slice(0, 8)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
          return { result: { type: "tool_result", tool_use_id: use.id, is_error: true, content: `Input did not match the schema: ${issues}. Fix it and call ${opts.submit.name} again.` } };
        }
        const tool = clientTools.get(use.name);
        if (!tool) return { result: { type: "tool_result", tool_use_id: use.id, is_error: true, content: `Unknown tool ${use.name}` } };
        const parsed = tool.schema.safeParse(use.input);
        if (!parsed.success) {
          return { result: { type: "tool_result", tool_use_id: use.id, is_error: true, content: `Invalid input: ${parsed.error.message.slice(0, 300)}` } };
        }
        try {
          return { result: { type: "tool_result", tool_use_id: use.id, content: await tool.run(parsed.data) } };
        } catch (err) {
          return { result: { type: "tool_result", tool_use_id: use.id, is_error: true, content: `Tool failed: ${(err as Error).message}` } };
        }
      }),
    );

    const submitted = results.find((r) => r.submitted !== undefined);
    if (submitted) return submitted.submitted as T;

    pushUser(results.map((r) => r.result));
  }
  throw new Error(`${stage}: no result after ${opts.maxTurns} turns`);
}
