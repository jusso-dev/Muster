# Threat model

Scope: Muster ops API, optional status UI, and Mastra agent tools that call configured upstreams.

## Assets

- Ops API bearer token (`MUSTER_OPS_TOKEN`)  
- Upstream API tokens (endpoint, case, TI platforms)  
- LLM provider credentials  
- Briefing and tool outputs (fleet posture, case summaries, TI dispositions)  
- Availability of the ops service for triage bots  

## Trust boundaries

- Bot host / Slack bridge ↔ Muster ops over HTTP  
- Optional browser ↔ status UI  
- Muster ↔ endpoint, case, and TI APIs  
- Muster ↔ model provider (Mastra agent generate)  
- Untrusted natural-language prompts ↔ tool execution  

## Threats and controls

| Threat | Controls |
|--------|----------|
| Unauthenticated API use | `MUSTER_OPS_TOKEN`; private network; reverse-proxy auth |
| Token leakage | Env/secrets manager; no token logging; short-lived upstream tokens |
| Prompt injection via chat text | Tools return structured upstream data; instructions forbid inventing state; no shell tools in ops agent |
| Over-privileged upstream tokens | Prefer read-only scopes on Tawny/Kelpie/Brolga-compatible APIs |
| SSRF via misconfiguration | Operators set fixed base URLs; no user-controlled base URL in tools |
| Data exposure in Slack | Channel scoping; avoid dumping full TI packs unless needed; redact in bot layer if required |
| Model provider data handling | Choose providers per policy; disable agent generate if not needed and use REST-only |
| Supply-chain / image trust | Pinned CI builds; SBOM on published images when enabled |

## Residual risks

- A compromised bot host can call any Muster tool allowed by the ops token. Treat the bot host as high trust.  
- Upstream APIs may return sensitive fields; bot authors should filter before posting to public channels.  
- Agent generate depends on third-party model quality and availability.  

Review this model when adding write-side tools, new connectors, or public exposure of the ops port.
