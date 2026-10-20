# How Greenlight works

This explains the moving parts: what happens when someone opens a guide, what happens when they ask for an app that has no guide, and why each piece is built the way it is.

## The pieces

```
Browser
 ├─ /                    Library: 12 guide cards + the 100-app catalog + "look up any app" box
 ├─ /guides/[slug]       A guide (library or generated) with path tabs, checklist and evidence
 ├─ /generate/[jobId]    Live progress feed for a generation job
 └─ /method              How guides are made: evidence labels, difficulty scale, limitations

Next.js 16 on Vercel (Fluid compute, functions up to 300 s)
 ├─ POST /api/generate         start a job, or redirect to an existing guide
 ├─ GET  /api/jobs/[id]        job status + new events (polled every 1.2 s); also the watchdog
 ├─ POST /api/jobs/[id]/advance   internal hand-off between stages (shared secret)
 └─ GET  /api/guides/[slug]    guide JSON, or ?format=md for Markdown

lib/agent (the live agent)          lib/store                  data/
 resolve → research → draft →        FileStore (.data/, dev)     guides/*.json  library guides
 verify → finalize                   RedisStore (Upstash, prod)  apps.json      100-app catalog
 probes.ts / net.ts (read-only HTTP)                             composio-managed-auth.json
```

## The contract: `lib/guide/schema.ts`

Every guide (library or live) has the same shape, defined once with zod. The research agents that built the library validated against it, the live agent writes into it through structured outputs, and the UI renders it. Key parts:

- `summary`: headline verdict, difficulty 1–5 with its label, what drives the difficulty, best and worst case.
- `paths[]`: one per access tier. Each has hands-on effort (hours) and provider wait (days) as ranges with a basis and evidence, an end state, and `stages[]`. Each stage says who can connect at that point and contains owner-tagged `steps[]`.
- `requirements`, `nuances`, `blockers` (symptom → cause → how to proceed → where to escalate), `artifacts` (drafts the agent prepared), `oauth` (endpoints, PKCE, refresh tokens, redirect rules), `composio`.
- `probes[]`: exactly what was requested and what came back.
- `verification`: status plus a log of every checked claim with its verdict and before/after values.
- `sources[]`: every claim's evidence points at these by id.

`checkGuideIntegrity` enforces what types can't: cited source ids exist, "documented" and "reported" claims cite something, the label matches the number, and the recommended path exists.

## Live generation, step by step

1. **Start** (`POST /api/generate`). The query is matched against the catalog without calling a model: names, aliases ("x.com" → X), and domains ("notion.so" → Notion). If a library guide or a fresh generated guide exists, the browser goes straight to it. Otherwise a job is created (rate-limited per IP and per day) and run with `after()`, after the response is sent.
2. **Resolve.** Catalog apps skip the model. Unknown apps get a short Claude call with up to two web searches to pin down the official site, whose OAuth it uses (Instagram → Meta), and where the developer docs live. Duplicate requests for the same app join the job already running.
3. **Research.** One Claude agent loop (`lib/agent/loop.ts`) with server-side `web_search` and `web_fetch` plus three client tools: `probe_oauth_metadata`, `probe_authorize_endpoint` and `probe_page`. It ends by calling `submit_findings`: atomic facts, each with a topic, an evidence kind, a confidence, a source URL and a quoted excerpt. Every probe result is stored verbatim. The model's short progress notes (thinking display "updates") stream into the live feed.
4. **Draft.** One structured-output call turns the findings and probes into the guide JSON. `repairDraft` then fixes near-misses in code (a dangling citation becomes "inferred, low confidence"; a wrong label is recomputed) instead of spending another model call.
5. **Verify.** Code picks the claims a developer would plan around (wait and effort ranges, who can connect before review, mandatory requirements, high-impact nuances, token behaviour). A second agent loop re-reads the cited pages and searches for newer information. It returns verdicts with small typed corrections (a new range, new text, a lower confidence), never a rewritten guide. `applyVerification` applies them in code and logs before and after values. If the check can't finish, the guide is still published, clearly marked "Not fact-checked".
6. **Finalize.** Save the guide; the feed redirects to it.

### Staying inside serverless limits

A full run takes 3–4 minutes, longer than is comfortable for one 300-second function. So:

- Each stage has a time budget. An invocation starts the next stage only if that stage's budget still fits. Otherwise it saves the job, releases its lease and calls `/api/jobs/[id]/advance`, which continues in a fresh invocation.
- A lease (Redis `SET NX PX`) ensures only one runner works on a job at a time.
- The status endpoint is also a watchdog. If a job is waiting for a hand-off that never arrived, or its runner died, the next poll resumes it. Each stage gets at most two attempts.
- Inside a stage, a soft deadline tells the model to submit what it has, and a hard deadline stops the loop.

### Model and API choices

- `claude-opus-5-5` with adaptive thinking. Research and verification run at `medium` effort; drafting runs at `low`, because it transcribes findings rather than reasoning anew.
- Server-side fallbacks (`fallbacks: "default"`) so a safety-classifier false positive on security-flavoured research (OAuth, probes) reroutes instead of failing the job.
- Strict tool schemas plus zod validation on every tool input. `pause_turn` is resumed by hand, because the SDK's tool runner doesn't do it.
- The Anthropic client is built with an explicit API key and base URL, so it never picks up other credentials from the environment.

## The library build

The 12 library guides were produced ahead of time by a multi-agent run following the same protocol (`lib/agent/protocol.ts`):

1. **Research agent per app:** official docs, community reports, 3–8 live `curl` probes, then the guide JSON, validated against the schema.
2. **Adversarial verifier per app:** told to assume the guide is wrong. It re-fetches the cited sources, confirms that excerpts really appear, searches for 2025–2026 policy changes, corrects the guide in place, and logs every claim it checked.
3. **Calibration agent:** compares ratings and time scales across all guides, so "Hard" means the same thing for Slack and Instagram.

Results and corrections are summarised in [VERIFICATION.md](../VERIFICATION.md).

## Safety notes

- Probes go through `lib/agent/net.ts`: http(s) only, DNS resolved and private, loopback and link-local ranges rejected, redirects not followed, small bodies, short timeouts.
- Links from guides are rendered only if they are http(s). All guide text is rendered as text, never HTML.
- The stage hand-off endpoint requires a secret derived from the API key; the comparison is timing-safe.
- Cost controls: per-IP hourly and global daily limits on new generations; existing guides are always served from the store.
