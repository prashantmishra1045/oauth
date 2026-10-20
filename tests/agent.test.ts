import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assembleGuide, repairDraft } from "@/lib/agent/assemble";
import { lookupComposio } from "@/lib/agent/composio";
import { strictJsonSchema } from "@/lib/agent/loop";
import { assertPublicUrl, isPrivateAddress } from "@/lib/agent/net";
import { Findings, GuideDraft } from "@/lib/agent/types";
import { applyVerification, extractClaims, type VerifyOutput } from "@/lib/agent/verify";
import { matchCatalog } from "@/lib/catalog";
import { listLibraryGuides } from "@/lib/guide/library";
import { checkGuideIntegrity } from "@/lib/guide/schema";

const template = listLibraryGuides()[0];
const draftOf = () => GuideDraft.parse(structuredClone(template));
const liveGuide = () => assembleGuide({ slug: "test-app", draft: draftOf(), probes: [], model: "test", startedAt: "2026-10-19T00:00:00Z", durationSec: 1 });

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

describe("repairDraft", () => {
  it("downgrades evidence whose sources are missing instead of keeping a dangling citation", () => {
    const d = draftOf();
    d.requirements[0].evidence = { kind: "documented", sourceIds: ["nope"], confidence: "high", note: "" };
    const fixed = repairDraft(d);
    expect(fixed.requirements[0].evidence).toMatchObject({ kind: "inferred", confidence: "low", sourceIds: [] });
  });

  it("fixes the label, the recommended path and inverted ranges", () => {
    const d = draftOf();
    d.recommendedPathId = "does-not-exist";
    d.summary.difficultyLabel = "Gated";
    d.paths[0].approvalWaitDays.min = 10;
    d.paths[0].approvalWaitDays.max = 2;
    const fixed = repairDraft(d);
    expect(fixed.recommendedPathId).toBe(fixed.paths[0].id);
    expect(fixed.summary.difficulty).toBe(fixed.paths[0].difficulty);
    expect(fixed.paths[0].approvalWaitDays).toMatchObject({ min: 2, max: 10 });
    expect(["Self-serve", "Easy", "Moderate", "Hard", "Gated"][fixed.summary.difficulty - 1]).toBe(fixed.summary.difficultyLabel);
  });

  it("assembles a guide that passes integrity checks", () => {
    expect(checkGuideIntegrity(liveGuide())).toEqual([]);
  });
});

describe("applyVerification", () => {
  it("applies a range correction, logs before/after and cites the new source", () => {
    const g = liveGuide();
    const p = g.paths[0];
    const out: VerifyOutput = {
      checks: [
        check({ ref: `range:${p.id}:approvalWaitDays`, verdict: "corrected", newMin: 5, newMax: 15, newLabel: "1-3 weeks", sourceUrls: ["https://docs.example.com/review"], note: "docs say 1-3 weeks" }),
      ],
      openQuestions: ["Is there an expedited review?"],
      summary: "One correction.",
    };
    const v = applyVerification(g, out);
    const range = v.paths[0].approvalWaitDays;
    expect(range).toMatchObject({ min: 5, max: 15, label: "1-3 weeks" });
    const entry = v.verification.entries[0];
    expect(entry.verdict).toBe("corrected");
    expect(entry.before).not.toBe("");
    expect(entry.after).toContain("1-3 weeks");
    expect(entry.method).toBe("cross_source");
    const src = v.sources.find((s) => s.url === "https://docs.example.com/review");
    expect(src).toBeTruthy();
    expect(range.evidence.sourceIds).toContain(src!.id);
    expect(v.openQuestions).toContain("Is there an expedited review?");
    expect(checkGuideIntegrity(v)).toEqual([]);
    // the input guide is not mutated
    expect(g.paths[0].approvalWaitDays.label).not.toBe("1-3 weeks");
  });

  it("records a correction it cannot apply as unverifiable, not as fixed", () => {
    const g = liveGuide();
    const ref = `range:${g.paths[0].id}:handsOnEffortHours`;
    const v = applyVerification(g, { checks: [check({ ref, verdict: "corrected", newText: "text is not a range" })], openQuestions: [], summary: "" });
    expect(v.verification.entries[0].verdict).toBe("unverifiable");
    expect(v.verification.entries[0].after).toBe("");
  });

  it("ignores unknown refs and lowers confidence on downgrades", () => {
    const g = liveGuide();
    const req = g.requirements[0];
    const v = applyVerification(g, { checks: [check({ ref: "nope:1" }), check({ ref: `requirement:${req.id}`, verdict: "downgraded" })], openQuestions: [], summary: "" });
    expect(v.verification.entries).toHaveLength(1);
    expect(v.requirements[0].evidence.confidence).toBe("low");
  });

  it("marks a guide verified only when every high-impact check holds", () => {
    const g = liveGuide();
    const refs = extractClaims(g).filter((c) => c.ref.startsWith("range:"));
    expect(refs.length).toBeGreaterThan(0);
    const ok = applyVerification(g, { checks: refs.map((c) => check({ ref: c.ref })), openQuestions: [], summary: "" });
    expect(ok.verification.status).toBe("verified");
    const partial = applyVerification(g, { checks: refs.map((c, i) => check({ ref: c.ref, verdict: i === 0 ? "unverifiable" : "supported" })), openQuestions: [], summary: "" });
    expect(partial.verification.status).toBe("partial");
  });
});

describe("matchCatalog", () => {
  it.each([
    ["GitHub", "github"],
    ["https://www.notion.so/product", "notion"],
    ["x.com", "twitter"],
    ["X", "twitter"],
    ["Microsoft Graph", "outlook"],
    ["  hubspot ", "hubspot"],
  ])("%s -> %s", (q, slug) => {
    expect(matchCatalog(q)?.slug).toBe(slug);
  });

  it("does not invent matches", () => {
    expect(matchCatalog("Totally Unknown Product")).toBeNull();
  });
});

describe("composio lookup", () => {
  it("distinguishes a toolkit from its MCP variant", () => {
    expect(lookupComposio("Notion")?.slug).toBe("NOTION");
    expect(lookupComposio("Notion MCP")?.slug).toBe("NOTION_MCP");
    expect(lookupComposio("Spotify")?.managed).toBe(false);
    expect(lookupComposio("Gmail")?.managed).toBe(true);
  });
});

describe("probe URL guard", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])("%s is private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "142.250.72.14", "2606:4700::1111"])("%s is public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  it.each(["file:///etc/passwd", "http://localhost:3000", "http://169.254.169.254/latest", "https://user:pw@example.com", "http://internal"])("rejects %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toThrow();
  });
});

describe("strictJsonSchema", () => {
  it("closes every object, requires every key and drops unsupported constraints", () => {
    const schema = strictJsonSchema(Findings) as Record<string, unknown>;
    const text = JSON.stringify(schema);
    expect(text).not.toMatch(/"minLength"|"maximum"|"minItems"|"\$schema"/);
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      const o = node as Record<string, unknown>;
      if (o.type === "object" && o.properties) {
        expect(o.additionalProperties).toBe(false);
        expect(new Set(o.required as string[])).toEqual(new Set(Object.keys(o.properties as object)));
      }
      Object.values(o).forEach(walk);
    };
    walk(schema);
    expect(strictJsonSchema(z.object({ n: z.number().min(1) }))).toMatchObject({ properties: { n: { type: "number" } } });
  });
});
