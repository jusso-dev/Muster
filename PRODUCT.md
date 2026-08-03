# Muster product

## Users

Security operators and a **workspace chat agent** (for example Slack). People chat in Slack or Teams, not inside Muster. The agent calls Muster tools to answer fleet, case, and threat-intel questions under time pressure.

## Purpose

**Muster is an ops brain for a security stack — not a chat product.**

It reads from systems of record and answers operational questions through tools:

| Upstream role | Typical authority |
|---------------|-------------------|
| Endpoint platform | Fleet health, host last-seen, detections |
| Case / IR platform | Open cases, aging, MTTR / SLA signals |
| Threat-intel API | Context packs for IPs, domains, hashes |

Reference open-source companions (optional, swappable):

- [Tawny](https://github.com/jusso-dev/tawny) — endpoints  
- [Kelpie](https://github.com/jusso-dev/Kelpie) — cases  
- [Brolga](https://github.com/jusso-dev/Brolga) — TI context (often fed by OpenCTI or similar)  

Muster exposes:

- **HTTP API** for bots and automation  
- **Mastra tools + agent** ([mastra.ai](https://mastra.ai/)) for tool-calling hosts  
- **Thin status UI** (optional) — read-only briefing, not the operating surface  

Tagline: **Ask the stack. Chat stays in Slack.**

## What Muster is not

- Not a replacement for Slack / Teams (no rooms or DMs as product)  
- Not the case system of record  
- Not an EDR or telemetry warehouse  
- Not a TI collector or feed pipeline  
- Not an autonomous response engine (no silent isolate/kill without upstream approval)  

## Primary jobs

1. **Fleet** — which hosts are healthy, stale, offline, noisy  
2. **Compromise signal** — host alerts + TI context on related observables  
3. **TI lookup** — context for an IP, domain, or hash  
4. **IR queue** — open cases, aging, unassigned, MTTR hints  
5. **Briefing** — one structured “what’s on fire” payload for digests and bots  

## Design principles

1. Chat UX lives in the workspace; Muster is tools and facts.  
2. Every answer should cite the upstream source.  
3. Prefer fail-closed, explicit configuration over silent mocks in production.  
4. Propose dangerous actions only; execution stays in the authoritative product.  
5. Small surface: API + Mastra tools first; UI last.  

## Brand personality

Credible, utilitarian, restrained. Direct and evidence-led. No AI sparkle theatre, no fake autonomy claims.
