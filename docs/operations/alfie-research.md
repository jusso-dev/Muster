# Alfie governed research

Alfie reads only allowlisted HTTPS feeds. CISA KEV is built in. Additional origins require `MUSTER_RESEARCH_ALLOWED_FEED_ORIGINS` as a comma-separated origin allowlist before an administrator creates a watchlist.

`POST /api/v1/research-watchlists` requires `agents.manage`. A watchlist has vendor/technology terms, a room, a 15-minute to 7-day cadence, and bounded source count. PostgreSQL stores watchlists, runs, source-backed briefs, feedback, and audit events; BullMQ only carries durable identifiers.

Each scheduled run is bounded to five feeds, 200 feed records, 30,000 tokens, 500 cents, and 900 seconds. Feed text is untrusted evidence. Alfie does not execute content, make unsourced claims, or perform external actions. Repeated source identifiers deduplicate to one research item; material changes append an immutable thread update.

Analysts mark a brief `useful`, `irrelevant`, or `duplicate` through `POST /api/v1/research-items/:id/feedback`. They create an explicit, idempotent follow-up task through `POST /api/v1/research-items/:id/follow-up`; Alfie never creates external action automatically. Learning proposals are typed in `ResearchBrief` and remain null until governed evaluation and human approval are added through existing agent-learning controls.

## Live-source smoke

Run from an environment with outbound HTTPS. It refuses unless explicitly opted in and writes a timestamped citation JSON artifact with source URL, retrieval time, feed SHA-256, catalog version, and cited CVE IDs:

```sh
MUSTER_ALFIE_LIVE_SMOKE=true pnpm alfie:cisa-smoke
```

Attach generated `artifacts/alfie-cisa-smoke-*.json` to deployment evidence. Do not commit live feed contents or credentials.
