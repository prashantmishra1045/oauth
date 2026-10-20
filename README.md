# Greenlight: OAuth app setup & approval guides

**Live app:** _<add Vercel URL after first deploy>_ · **Verification report:** [VERIFICATION.md](VERIFICATION.md) · **How it works:** [docs/architecture.md](docs/architecture.md)

A developer building an AI agent wants their users to connect an app. Before launch they often need their own OAuth app with that provider, and getting it approved can take an hour or many weeks. Greenlight tells them how hard it will be, how long they will wait, what can block them, and what an agent can do for them.

- **Library:** a catalog of 100 OAuth apps, with 12 deeply researched and fact-checked guides covering different setup challenges, from self-serve (GitHub) through restricted-scope security assessments (Gmail) to partner-gated APIs (LinkedIn) and paid tiers (X).
- **Live generation:** type any app name or website. An agent identifies the app, reads the provider's docs, probes its OAuth endpoints, writes a guide, fact-checks the guide's key claims, and publishes a shareable page in about 3–4 minutes.

## What I learned, and the decisions it led to

A provider OAuth app (client ID, redirect URIs, scopes and an approval status) sits between a developer's integration (in Composio, an *auth config*) and every user's *connected account*. Its approval status decides **who can connect and what they see**: Google's 100-user cap and unverified-app screen, Meta's development mode, Spotify's allowlist, LinkedIn's gated products. Composio's managed apps remove all of this for prototyping. Developers bring their own app for their branding on the consent screen, their own quota, custom scopes, or because the toolkit has no managed app.

1. **A readiness ladder, not a tutorial.** Every path runs register → configure → test → review → live → maintain, and every stage states who can connect at that point. That is the question a developer is planning around.
2. **Difficulty depends on the access tier, not the app.** Gmail sign-in and Gmail read access are different projects (days of work versus a security assessment and weeks of review). Guides model tiers as separate paths and recommend the one an agent integration usually needs.
3. **Effort and waiting are separate numbers.** "Two hours of work, then 2–6 weeks waiting" calls for a different plan than "two days of work".
4. **Evidence on every claim.** Each claim is labelled *Tested* (an agent probe observed it), *Documented* (official docs), *Reported* (community sources) or *Inferred*, with a confidence and numbered sources. Every guide ends with a fact-check log and a list of what could not be verified.
5. **Owner on every step.** 🤖 an agent can do or prepare it (scope justifications, manifests, demo-video scripts, checklists, probes), 👤 you must do it (log in, accept terms, verify a business, pay), or ⏳ you wait on the provider.
6. **Shareable.** Permalinks, a progress checklist saved in the browser, Markdown export and print-friendly pages.

## Using agents

| | Library (deep) | Live (about 3–4 min) |
|---|---|---|
| Who runs it | Research agents ahead of time (one per app), then an **adversarial verifier per app** and a cross-app calibration pass | The deployed app, on the Claude API (`claude-opus-5-5`) |
| Research | Official docs, community reports, live probes | `web_search` + `web_fetch` + three probe tools |
| Checking | Verifier re-reads cited pages, searches for newer policy changes, corrects the guide | Verifier stage checks 8–12 high-impact claims; code applies typed corrections and logs before/after |

**Probes** are real, read-only HTTP requests: OAuth/OIDC discovery documents (PKCE methods, dynamic client registration), the authorization endpoint called with an unregistered client to see how it responds, and the app console to see whether it needs a login. They are SSRF-guarded: public hosts only, no redirects followed, no credentials. No accounts are created and nothing is submitted.

## Run it locally

Requires Node 22+.

```bash
npm install
npm run dev                     # http://localhost:3000, library only (live generation shows "not configured")
GREENLIGHT_REPLAY=1 npm run dev # also exercises the live flow by replaying a library guide (no API key)
ANTHROPIC_API_KEY=sk-ant-... npm run dev   # real live generation
npm test && npm run validate && npm run typecheck
```

Without Redis configured, jobs and generated guides are stored in `.data/`.

## Deploy (GitHub → Vercel)

1. Push this repo to GitHub.
2. Add repository secrets: `ANTHROPIC_API_KEY`, and `VERCEL_TOKEN` (created under Vercel → Account Settings → Tokens).
3. Run **Actions → Deploy to Vercel** (it also runs on every push to `main`). It creates the Vercel project on first run, copies `ANTHROPIC_API_KEY` from the GitHub secret into Vercel's production environment, then builds and deploys.
4. In Vercel → the `greenlight` project → Storage, add **Upstash Redis** (free) and connect it to the project. It sets `KV_REST_API_URL` / `KV_REST_API_TOKEN`, which Greenlight picks up. Re-run the deploy.
5. Optional: **Actions → Live agent smoke test** runs the whole live pipeline for one app with the secret key and uploads the guide.

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | (none) | Enables live generation. Used explicitly; the app never falls back to other ambient credentials. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_*`) | (none) | Shared store for jobs and generated guides. Needed on Vercel. |
| `GENERATION_BUDGET_USD` | 3.5 | Hard cap on estimated live-generation spend for the deployment; new jobs are refused once it's reached (checked before each job starts). |
| `GENERATION_LIMIT_PER_HOUR` / `GENERATION_LIMIT_PER_DAY` | 3 / 15 | Rate limits for new live guides (per IP / global). |
| `GREENLIGHT_MODEL` | `claude-opus-5-5` | Model for the live agent. |
| `GREENLIGHT_FAST_MODE` | off | `1` enables fast mode where the account supports it (faster output, higher price). |
| `GREENLIGHT_REPLAY` | off | `1` replays a library guide instead of calling the API (dev only). |

## Limitations

- No provider approvals were completed. Review times come from provider statements and community reports, and are labelled that way.
- Anything behind a provider login (console screens, review forms) is described from documentation, not observed.
- Live guides are fact-checked by the same model family that wrote them. The check catches misread sources and stale numbers; it is not an independent audit. The library guides got the deeper treatment.
- Policies change. Guides carry dates, and live guides regenerate after 30 days. A production version would re-verify the library on a schedule and track policy pages for changes.
- A live guide costs an estimated $0.50–1 in API usage (prompt caching keeps the research loop's re-sent pages cheap). Generation is rate-limited and capped by `GENERATION_BUDGET_USD`; each finished job shows its estimated cost.

## Repository layout

```
app/                    pages (library, guide, live feed, method) and API routes
components/             UI (guide view, path checklist, live feed, badges)
lib/agent/              live pipeline: resolve, research, draft, verify, probes, job orchestration
lib/guide/              guide schema (the contract), library loader, Markdown export
lib/store/              file store (dev) and Upstash Redis store (prod)
data/guides/*.json      the library guides
data/apps.json          the 100-app catalog
data/composio-managed-auth.json   snapshot of Composio's managed-auth directory
scripts/                guide validator, library index generator, live smoke test
.github/workflows/      CI, deploy to Vercel, live agent smoke test
```
