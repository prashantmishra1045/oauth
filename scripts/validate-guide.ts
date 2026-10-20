// Usage: npx tsx scripts/validate-guide.ts data/guides/github.json [more.json ...]
// Exits non-zero and prints every problem if any guide is invalid.
import { readFileSync } from "node:fs";
import { Guide, checkGuideIntegrity } from "../lib/guide/schema";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: tsx scripts/validate-guide.ts <guide.json> [...]");
  process.exit(2);
}

let failed = false;
for (const file of files) {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`✗ ${file}: not valid JSON — ${(err as Error).message}`);
    failed = true;
    continue;
  }
  const parsed = Guide.safeParse(raw);
  if (!parsed.success) {
    failed = true;
    console.error(`✗ ${file}: schema errors`);
    for (const issue of parsed.error.issues.slice(0, 40)) {
      console.error(`   - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    continue;
  }
  const problems = checkGuideIntegrity(parsed.data);
  if (problems.length) {
    failed = true;
    console.error(`✗ ${file}: integrity problems`);
    for (const p of problems.slice(0, 40)) console.error(`   - ${p}`);
    continue;
  }
  const g = parsed.data;
  console.log(
    `✓ ${file}: ${g.app.name} — difficulty ${g.summary.difficulty} (${g.summary.difficultyLabel}), ${g.paths.length} path(s), ${g.sources.length} sources, ${g.probes.length} probes, ${g.verification.entries.length} verification entries`,
  );
}
process.exit(failed ? 1 : 0);
