# Verification report

How the library guides were checked, what changed as a result, and what remains uncertain. Each guide page shows its own fact-check log, with every claim's verdict and before/after values (section "Fact-check").

## Method

1. **Research agent per app** (12 apps). It read official docs and community reports, ran 6–8 real read-only probes (OAuth/OIDC discovery documents, the authorization endpoint called with an unregistered client, developer-portal access), and wrote the guide. Its brief included my starting assumptions as *hypotheses to confirm or refute*.
2. **Adversarial verifier per app.** Told to assume the guide was wrong, it re-fetched cited pages, confirmed excerpts actually appear, searched for 2025–2026 policy changes, re-ran doubtful probes and corrected the guide in place. Every checked claim is logged. Verification ran twice for most guides (a rate-limit interruption led to a second pass), so many claims were checked by two independent verifiers.
3. **Calibration agent.** Compared difficulty ratings and time scales across all 12 guides and fixed internal inconsistencies, for example effort ranges smaller than the sum of a path's own steps.

## Results

**409 claims fact-checked:** 283 supported, **104 corrected**, 15 downgraded, 7 unverifiable.

| App | Difficulty | Fact-check | Checked | Supported | Corrected | Downgraded | Unverifiable | Probes | Sources |
|---|---|---|---|---|---|---|---|---|---|
| GitHub | 3 Moderate | verified | 30 | 23 | 5 | 2 | 0 | 6 | 40 |
| Gmail | 4 Hard | verified | 30 | 18 | 11 | 1 | 0 | 7 | 31 |
| HubSpot | 4 Hard | partial | 38 | 24 | 11 | 2 | 1 | 7 | 36 |
| Instagram | 4 Hard | verified | 48 | 32 | 13 | 3 | 0 | 7 | 41 |
| LinkedIn | 2 Easy | partial | 26 | 20 | 5 | 1 | 0 | 8 | 31 |
| Notion | 2 Easy | verified | 30 | 25 | 4 | 1 | 0 | 8 | 35 |
| Outlook (Microsoft Graph) | 3 Moderate | verified | 28 | 21 | 7 | 0 | 0 | 6 | 41 |
| Salesforce | 3 Moderate | verified | 33 | 23 | 9 | 1 | 0 | 8 | 36 |
| Shopify | 4 Hard | partial | 28 | 18 | 8 | 0 | 2 | 7 | 35 |
| Slack | 4 Hard | partial | 58 | 39 | 16 | 2 | 1 | 6 | 34 |
| Spotify | 5 Gated | partial | 27 | 20 | 5 | 1 | 1 | 6 | 30 |
| X (Twitter) | 3 Moderate | partial | 33 | 20 | 10 | 1 | 2 | 6 | 44 |

"Partial" means at least one high-impact claim (a wait time, or who can connect before review) ended up downgraded or unverifiable, usually because the only evidence is community reports.

## What I learned: my starting assumptions that were wrong

The research briefs contained my own prior understanding. Many of those assumptions were already out of date:

- **Spotify:** development mode allows **5 users**, not 25 (since Feb–Mar 2026), and the app owner needs Premium. Extended quota is only for organizations with roughly 250k monthly active users, so for most developers it's gated.
- **X:** the **Free tier ended on 6 Feb 2026**, and Basic and Pro were migrated to pay-per-use during 2026. The main gate is now cost plus new policy limits, such as replies only to accounts that summoned the agent, and prior approval for AI-generated replies.
- **Shopify:** merchants can no longer create custom apps in the admin (since 1 Jan 2026), and new public apps must use expiring offline tokens.
- **Salesforce:** creating classic connected apps is now **off in every org**. New integrations use External Client Apps, and an ECA works in other orgs only when installed from a managed package.
- **Slack:** for a *commercial* AI agent, the Marketplace listing is effectively required. Under the API Terms effective 10 Oct 2025, and the rate limits for unlisted apps (1 request per minute and 15 objects on `conversations.history` for new installs), a public-but-unlisted app is pilot-only. That's why Slack rates 4 and not 2.
- **GitHub:** OAuth App tokens now **expire after 8 hours by default** (from 2026-08-14), and orgs restrict OAuth apps by default. The rating moved from Easy to Moderate because of per-org owner approval.
- **Gmail:** the 100-user cap counts *new users over the project's lifetime*; it isn't a concurrent limit. `gmail.compose` and `gmail.metadata` are restricted too, so only `gmail.send` avoids the security assessment.
- **Notion:** public connections now issue rotating refresh tokens. Notion's hosted MCP server supports dynamic client registration, so an agent can connect without registering an app at all.

## Examples of corrections the verifiers made

- **Instagram:** App Review was "a decision within a week" according to Meta's walkthrough. Reports from 2026 show the dashboard warning of up to 20 days per round. The total wait changed to 1–13 weeks, labelled *reported*.
- **HubSpot:** the listing wait was 2–8 weeks. HubSpot's 60 days only start after feedback, which itself follows an initial review of up to 10 business days, so the wait became about 10 days to 10.5 weeks.
- **Outlook:** a Partner Program account and publisher verification were marked mandatory. Microsoft doesn't require them for admin consent, so they became optional, and the guide explains the consent policy instead.
- **Slack:** a demo video was listed as mandatory for Marketplace submission. It's encouraged, not required.
- **Salesforce:** the security-review wait was based on a 2023 starter pack. It now uses the current official figures: 4–13 weeks.
- **Shopify:** protected customer data access must be requested *before* submitting, because Shopify won't accept the request while the app is under review.
- **Quote checks:** several excerpts attributed to the wrong page (Instagram, GitHub, Composio) were re-attributed to the page that actually contains them, or rewritten verbatim.

The calibration pass re-fetched six high-impact excerpts (X pricing, Slack's 10-workspace gate, Spotify's 5-user and 250k-MAU figures, Gmail's assessment fee, HubSpot's install caps, Shopify's review time) and found all of them verbatim.

## What could not be verified

- **Anything behind a login:** console screens, review forms, Meta's Business Help Center and Microsoft 365 Message Center (read through third-party archives). These are labelled documented or reported, never tested.
- **Review durations without a provider SLA:** GitHub Marketplace, LinkedIn Community Management, Shopify, X AI-reply approval. These rely on community threads or vendor posts and are labelled *reported*, with low or medium confidence.
- **Composio specifics needing a Composio account:** whether custom auth configs refresh GitHub's 8-hour tokens or Instagram's long-lived tokens, the scopes Composio's managed apps hold, and which HubSpot token endpoint Composio calls. These are listed as open questions in the guides.
- **Known gap:** the calibration agent noticed that Composio's May 2026 security incident post lists several toolkits (including custom-auth connections) as revoked. Only the HubSpot guide mentions it, and adding it to the others would need new research.

## Code review

The app code was also reviewed by five independent reviewers, each looking at a different area (Claude API usage, job orchestration, security, guide logic, UI), with a skeptic agent trying to refute each finding. 31 of 37 findings were confirmed and fixed, and each has a regression test (`tests/review-regressions.test.ts`). Among them:

- An SSRF bypass via IPv4-mapped IPv6, and a DNS-rebinding gap. Addresses are now checked at connect time.
- Conversation edits that would break Opus 5.5's preserved-thinking checks.
- Requests that could outlive the 300-second function.
- Catalog URLs routing to the wrong app.

## Live pipeline

First production run (2026-10-20, https://greenlight-neon-rho.vercel.app/guides/calendly): **Calendly**, an app outside the library, went from request to published guide in **244 s**. It used 7 web searches, 14 page reads and 4 probes, and produced 28 researched facts from 10 sources. The fact-check examined 9 high-impact claims: 6 supported, 2 downgraded, 1 unverifiable. Estimated cost: about $1.07 (14.5k uncached input tokens, 88k cache-write tokens, 393k cache-read tokens, 21k output tokens).

Lessons from that run:

- The full guide schema is too large for the API's structured-output grammar compiler, which rejected it with a 400. The draft is now requested as plain JSON and validated locally with the same zod schema.
- `web_fetch` refuses URLs that haven't appeared earlier in the conversation (`url_not_in_prior_context`), as documented. The agent recovered by searching first.
