// Regression tests for defects found in the adversarial code review.
import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { assembleGuide } from "@/lib/agent/assemble";
import { addUsage, echoContent } from "@/lib/agent/loop";
import { assertPublicUrl, isPrivateAddress, publicOnlyLookup } from "@/lib/agent/net";
import { GuideDraft, emptyUsage } from "@/lib/agent/types";
import { applyVerification, type VerifyOutput } from "@/lib/agent/verify";
import { matchCatalog } from "@/lib/catalog";
import { getLibraryGuide, listLibraryGuides } from "@/lib/guide/library";
import { guideToMarkdown } from "@/lib/guide/markdown";
import { checkGuideIntegrity } from "@/lib/guide/schema";

type Block = Anthropic.Beta.Messages.BetaContentBlock;
const template = listLibraryGuides()[0];
const liveGuide = () => assembleGuide({ slug: "test-app", draft: GuideDraft.parse(structuredClone(template)), probes: [], model: "test", startedAt: "2026-10-19T00:00:00Z", durationSec: 1 });
const check = (over: Partial<VerifyOutput["checks"][number]>): VerifyOutput["checks"][number] => ({
  ref: "",
  verdict: "supported",
  note: "",
  sourceUrls: [],
  newText: "",
  newMin: -1,
  newMax: -1,
  newLabel: "",
  newConfidence: "unchanged",
  ...over,
});
const verifyWith = (checks: VerifyOutput["checks"]) => applyVerification(liveGuide(), { checks, openQuestions: [], summary: "" });

describe("echoContent after a mid-output fallback", () => {
  it("drops the declined model's thinking, tool calls and unanswered server calls but keeps text and paired results", () => {
    const content = [
      { type: "thinking", thinking: "x", signature: "s" },
      { type: "text", text: "partial" },
      { type: "server_tool_use", id: "srv1", name: "web_search", input: {} },
      { type: "web_search_tool_result", tool_use_id: "srv1", content: [] },
      { type: "server_tool_use", id: "srv2", name: "web_fetch", input: {} },
      { type: "tool_use", id: "t1", name: "probe_page", input: {} },
      { type: "fallback", from: { model: "a" }, to: { model: "b" } },
      { type: "thinking", thinking: "y", signature: "s2" },
      { type: "tool_use", id: "t2", name: "submit_findings", input: {} },
    ] as unknown as Block[];
    const echoed = echoContent(content).map((b) => `${b.type}:${(b as { id?: string }).id ?? ""}`);
    expect(echoed).toEqual(["text:", "server_tool_use:srv1", "web_search_tool_result:", "fallback:", "thinking:", "tool_use:t2"]);
  });

  it("leaves content without a fallback unchanged", () => {
    const content = [{ type: "thinking", thinking: "x", signature: "s" }, { type: "tool_use", id: "t1", name: "a", input: {} }] as unknown as Block[];
    expect(echoContent(content)).toBe(content);
  });
});

describe("usage across fallback attempts", () => {
  it("sums usage.iterations when present", () => {
    const usage = emptyUsage();
    addUsage(usage, {
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        iterations: [
          { type: "message", input_tokens: 100, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          { type: "fallback_message", input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        ],
        server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 },
      },
    } as unknown as Anthropic.Beta.Messages.BetaMessage);
    expect(usage).toMatchObject({ inputTokens: 110, outputTokens: 2005, webSearches: 2, webFetches: 1 });
  });
});

describe("SSRF guard bypasses", () => {
  it.each(["::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1", "::"])("%s is private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://2130706433/", "http://0x7f.0.0.1/", "http://printer.local/"])("rejects %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toThrow();
  });

  it("checks addresses at connect time, so a name resolving to loopback is refused", async () => {
    const err = await new Promise<unknown>((resolve) => publicOnlyLookup("localhost", { all: true }, (e) => resolve(e)));
    expect(err).toBeTruthy();
  });
});

describe("catalog matching on shared hosts", () => {
  it.each([
    ["https://workspace.google.com/products/calendar/", "google-calendar"],
    ["https://workspace.google.com/products/gmail/", "gmail"],
    ["https://www.microsoft.com/microsoft-teams", "microsoft-teams"],
    ["https://www.atlassian.com/software/jira", "jira"],
    ["https://www.facebook.com/business/ads", "meta-ads"],
    ["https://zoom.com", "zoom"],
    ["x.com", "twitter"],
  ])("%s -> %s", (q, slug) => {
    expect(matchCatalog(q)?.slug).toBe(slug);
  });

  it.each(["https://workspace.google.com", "https://www.microsoft.com", "x.ai", "myapp.github.io", "coolapp.vercel.app"])("%s does not guess", (q) => {
    expect(matchCatalog(q)).toBeNull();
  });
});

describe("verification patch semantics", () => {
  it("derives a label when only the numbers are corrected", () => {
    const g = liveGuide();
    const p = g.paths[0];
    const v = verifyWith([check({ ref: `range:${p.id}:approvalWaitDays`, verdict: "corrected", newMin: 14, newMax: 28 })]);
    expect(v.paths[0].approvalWaitDays).toMatchObject({ min: 14, max: 28, label: "14-28 days" });
  });

  it("treats -1 as keep-this-bound", () => {
    const g = liveGuide();
    const p = g.paths[0];
    const oldMin = p.handsOnEffortHours.min;
    const v = verifyWith([check({ ref: `range:${p.id}:handsOnEffortHours`, verdict: "corrected", newMax: oldMin + 40, newLabel: "longer" })]);
    expect(v.paths[0].handsOnEffortHours).toMatchObject({ min: oldMin, max: oldMin + 40, label: "longer" });
    expect(v.verification.entries[0].verdict).toBe("corrected");
  });

  it("never raises confidence on a correction it could not apply", () => {
    const g = liveGuide();
    const p = g.paths[0];
    const v = verifyWith([check({ ref: `range:${p.id}:handsOnEffortHours`, verdict: "corrected", newConfidence: "high" })]);
    expect(v.verification.entries[0].verdict).toBe("unverifiable");
    expect(v.paths[0].handsOnEffortHours.evidence.confidence).toBe("low");
  });

  it("does not let a stage verdict change a step's evidence", () => {
    const g = liveGuide();
    const p = g.paths[0];
    const st = p.stages[0];
    const before = structuredClone(st.steps[0].evidence);
    const v = verifyWith([check({ ref: `stage:${p.id}:${st.id}`, verdict: "downgraded", sourceUrls: ["https://example.org/x"] })]);
    expect(v.paths[0].stages[0].steps[0].evidence).toEqual(before);
  });

  it("allocates a free source id even when ids have gaps", () => {
    const g = liveGuide();
    g.sources = g.sources.filter((s) => s.id !== "s2"); // leave a gap, as repairDraft can
    for (const e of [g.oauth.evidence, g.composio.evidence]) e.sourceIds = e.sourceIds.filter((id) => id !== "s2");
    const stripped = JSON.parse(JSON.stringify(g).replaceAll('"s2"', '"s1"'));
    const req = stripped.requirements[0];
    const v = applyVerification(stripped, { checks: [check({ ref: `requirement:${req.id}`, verdict: "corrected", newText: "fixed", sourceUrls: ["https://example.org/new"] })], openQuestions: [], summary: "" });
    expect(new Set(v.sources.map((s) => s.id)).size).toBe(v.sources.length);
    expect(checkGuideIntegrity(v)).toEqual([]);
  });

  it("is 'unverified' when nothing could be confirmed", () => {
    const g = liveGuide();
    const refs = g.paths.map((p) => `range:${p.id}:approvalWaitDays`);
    expect(verifyWith(refs.map((ref) => check({ ref, verdict: "unverifiable" }))).verification.status).toBe("unverified");
  });
});

describe("Markdown export", () => {
  it("keeps the document intact when an artifact contains its own code fences", () => {
    const g = structuredClone(template);
    g.artifacts = [{ id: "a", title: "Manifest", kind: "manifest", format: "markdown", content: "Intro\n```json\n{}\n```\nOutro", howToUse: "Paste it" }];
    const md = guideToMarkdown(g, "https://example.com");
    const after = md.slice(md.indexOf("## Drafts prepared by the agent"));
    expect(after).toContain("````\nIntro");
    expect(md.trimEnd().split("\n").filter((l) => /^`{3,}\s*$/.test(l) || /^`{3,}[a-z]+$/.test(l)).length % 2).toBe(0);
  });

  it("shows which path a requirement applies to", () => {
    const g = getLibraryGuide("gmail") ?? template;
    const scoped = g.requirements.find((r) => r.pathIds.length > 0);
    if (!scoped) return;
    const md = guideToMarkdown(g, "https://example.com");
    expect(md).toMatch(new RegExp(`\\*\\*${scoped.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\*\\*[^\\n]*only for:`));
  });
});
