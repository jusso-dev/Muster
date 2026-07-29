# ADR 0007 — Security Company OS UI foundation

## Status

Accepted (2026-07-30)

## Context

ADR 0006 correctly removed in-app chat and made the web surface an ops control
plane. Operators still needed a fuller **company OS** interaction model:
attention queue, missions, governance inbox, audit, integrations, and agent
workforce views — without becoming SIEM/EDR/SOAR/case/chat.

Meridian Company OS provides a strong IA and visual language reference, but its
local-first store, simulation clock, and Kimi runtime must not be copied into
Muster.

## Decision

1. **Positioning** — Muster web is the governed Security Company OS shell for an
   AI-enabled security company.
2. **Shell** — `CompanyOsShell` replaces narrow Health-only nav with Command,
   Operations, Missions, Teams, Agents, Capabilities, Approvals, Audit,
   Integrations, Settings.
3. **ADR 0006 preserved** — chat remains Slack/Hermes; no second chat product.
4. **Data** — PostgreSQL remains SoT; typed API client + React Query; fixtures
   only behind adapters with explicit `source: fixture`.
5. **New read APIs** — session/me, command/summary, missions, audit/events.
6. **Authz** — browser never supplies organisation/actor authority; server
   scopes every query; approval decisions remain `ApprovalDomainService`.
7. **Status vocabulary** — one shared severity / operational / health / approval
   system.

## Consequences

- PRODUCT.md and DESIGN.md describe the OS shell, not a minimal health page only.
- OpsShell is an alias of CompanyOsShell for existing pages.
- Teams and capability catalogue may show fixtures until domain APIs exist.
- Multi-org switcher is present but disabled until membership model exists.

## Alternatives considered

- Port Meridian store/simulation — rejected (violates authority and security model).
- Keep Health-only dashboard — rejected (insufficient for operations governance).
- Unified frontend domain store — rejected (competes with backend SoT).
