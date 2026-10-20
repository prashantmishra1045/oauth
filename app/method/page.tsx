import type { Metadata } from "next";
import Link from "next/link";
import { DifficultyBadge, EvidenceLegend } from "@/components/badges";
import { listLibraryGuides } from "@/lib/guide/library";

export const metadata: Metadata = { title: "How guides are made" };

const RUBRIC = [
  [1, "Self-serve", "Credentials in minutes; no review before any user can connect."],
  [2, "Easy", "Self-serve to production with light requirements (branding, a distribution toggle, an optional directory listing)."],
  [3, "Moderate", "A provider review or verification is needed for production, typically days; or real configuration work such as admin consent."],
  [4, "Hard", "Multi-week review, a security assessment, business verification or legal documents, or meaningful cost."],
  [5, "Gated", "Access needs a partner approval that may be denied, a paid tier or a business threshold. No guaranteed path."],
] as const;

export default function MethodPage() {
  const guides = listLibraryGuides();
  const entries = guides.flatMap((g) => g.verification.entries);
  const count = (v: string) => entries.filter((e) => e.verdict === v).length;
  const probes = guides.reduce((n, g) => n + g.probes.length, 0);
  const sources = guides.reduce((n, g) => n + g.sources.length, 0);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">How guides are made</h1>
      <p className="mt-3 text-zinc-700">
        A provider OAuth app (client ID, redirect URIs, scopes and an approval status) sits between your integration and every user who connects. Its approval
        status decides who can connect and what they see. Greenlight guides answer the planning questions: how hard is it, how long will I wait, what could block
        me, and what can an agent do for me.
      </p>

      <h2 className="mt-10 text-xl font-semibold tracking-tight">Decisions behind the format</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-zinc-700">
        <li>
          <b>A readiness ladder, not a tutorial.</b> Each path runs register → configure → test → review → live → maintain, and every stage says who can connect at
          that point (for example, &ldquo;only test users you list, maximum 100, with a warning screen&rdquo;).
        </li>
        <li>
          <b>Difficulty depends on access, not just the app.</b> Gmail sign-in scopes and Gmail read access are different projects. Guides model each access tier as a
          path and recommend the one an agent integration usually needs.
        </li>
        <li>
          <b>Effort and waiting are separate numbers.</b> Two hours of work followed by six weeks of review is a different plan from two days of work.
        </li>
        <li>
          <b>Every step has an owner:</b> 🤖 an agent can do or prepare it, 👤 you must do it (log in, accept terms, verify a business, pay), or ⏳ you wait on the
          provider. Prepared drafts such as scope justifications and manifests are included and ready to copy.
        </li>
        <li>
          <b>Composio-aware.</b> Each guide says whether Composio has a managed OAuth app for the toolkit, and when you still need your own: your branding on the
          consent screen, your own quota, custom scopes, or because no managed app exists.
        </li>
      </ul>

      <h2 className="mt-10 text-xl font-semibold tracking-tight">Evidence</h2>
      <p className="mt-2 text-zinc-700">Every claim carries one of four labels, a confidence, and the sources behind it.</p>
      <div className="mt-3">
        <EvidenceLegend />
      </div>
      <p className="mt-3 text-sm text-zinc-600">
        &ldquo;Tested&rdquo; means an agent made a real, read-only request during research: fetching the provider&apos;s OAuth discovery document, calling the authorization
        endpoint with an unregistered client to see how it responds, or loading the app console to see whether it sits behind a login. No accounts are created and no
        credentials are used, so anything that needs a signed-in account is documented or reported, not tested.
      </p>

      <h2 className="mt-10 text-xl font-semibold tracking-tight">Difficulty scale</h2>
      <ul className="mt-3 space-y-2">
        {RUBRIC.map(([n, label, text]) => (
          <li key={n} className="flex items-start gap-3">
            <DifficultyBadge level={n} label={label} />
            <span className="text-sm text-zinc-700">{text}</span>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-xl font-semibold tracking-tight">Two ways a guide gets made</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-card p-4 text-sm text-zinc-700">
          <h3 className="font-medium text-zinc-900">Library (deep)</h3>
          <p className="mt-1">
            A research agent per app reads the official docs and community reports, runs probes and writes the guide. A separate verifier agent then tries to
            refute its high-impact claims (timelines, user caps, costs, review triggers), re-reads the cited pages, searches for newer policy changes and corrects
            the guide. A calibration pass compares ratings across apps.
          </p>
          <p className="mt-2 text-zinc-600">
            So far: {guides.length} guides, {sources} sources, {probes} probes, {entries.length} claims fact-checked ({count("corrected")} corrected, {count("downgraded")}{" "}
            downgraded, {count("unverifiable")} unverifiable).
          </p>
        </div>
        <div className="rounded-xl border border-line bg-card p-4 text-sm text-zinc-700">
          <h3 className="font-medium text-zinc-900">Live (about 3–4 minutes)</h3>
          <p className="mt-1">
            For any other app: identify the app and whose OAuth it uses → research with web search, page reading and the same probes → write the guide → fact-check
            8–12 key claims against their sources. Corrections are applied by code and logged with before and after values, so every change is visible on the
            guide.
          </p>
        </div>
      </div>

      <h2 className="mt-10 text-xl font-semibold tracking-tight">Limitations</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-zinc-700">
        <li>No provider approvals were actually completed. Review times come from provider statements and community reports and are labelled as such.</li>
        <li>Policies change. Each guide shows when it was researched and last checked, and live guides are regenerated after 30 days.</li>
        <li>A live guide is checked by the same model family that wrote it. The check catches misread sources and stale numbers; it is not an independent audit.</li>
        <li>Steps that need a signed-in account (console screens, review forms) are described from documentation, not observed.</li>
      </ul>

      <p className="mt-10">
        <Link href="/" className="font-medium text-emerald-700 hover:underline">
          ← Back to the library
        </Link>
      </p>
    </div>
  );
}
