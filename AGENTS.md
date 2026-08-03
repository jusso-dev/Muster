# Contributor instructions

## Product direction

Muster is an **ops brain** for endpoint fleet, incident cases, and threat-intel context APIs.  
Humans chat in **Slack** (or another host). Agents use **Mastra** tools exposed by Muster.  

Do **not** add chat rooms, DMs, or in-app agent conversation UX.

See `PRODUCT.md` and `docs/architecture/0005-ops-brain-mastra.md`.

## Where to work

| Area | Path |
|------|------|
| Connectors + domain | `packages/ops` |
| Mastra agent + tools + HTTP | `apps/ops` |
| Optional status UI | `apps/web` (`/ops` only) |

## Engineering rules

- TypeScript strict mode.  
- Prefer small pure services over giant route handlers.  
- Upstream HTTP: timeouts, schema validation, no secret logging.  
- Label test doubles clearly; never present mock success as production delivery.  
- Dangerous actions: propose only unless an explicit upstream approval path exists.  
- Tests use synthetic data only.  

## Tooling

- **Mastra** — `createTool`, `Agent`, `Mastra` for tools Slack bots call.  
- **Zod** — tool and connector response schemas.  
- Do not introduce a second agent framework alongside Mastra for ops tools.  
