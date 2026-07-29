# Muster Product Context

## Register

product

## Users

Muster serves security operators, administrators, and trusted agent runtimes.
Humans configure and govern; agents act under policy. Analysts chat with agents
in **Slack** (or Hermes), not in the Muster web app.

## Product Purpose

Muster is the **governed operating system for an AI-enabled security company**.

It provides one operational control plane for security operations, incident
response coordination, threat hunting, detection engineering, vulnerability
management coordination, assurance/GRC workflows, customer engagements,
AI agents, human analysts, missions, approvals, evidence, integrations, and audit.

It owns installation credentials, approvals, audit, missions, operational
knowledge, Slack agent harness delivery, and governed connectors to upstream
products (Kelpie, Tawny, UniFi, Sentinel, Defender, cloud platforms, …).
PostgreSQL is authoritative; Redis/BullMQ are execution infrastructure.

**Chat is not the product.** Conversation happens in:

- **Slack** — Muster bot exposes Parker, Jessie, and Alfie
- **Hermes** — sessions/models; calls Muster over remote MCP

**Kelpie** remains formal case system of record. Muster does not replace SIEM,
EDR, SOAR, or case management. Connected platforms remain authoritative for
their own records; Muster coordinates and governs work around them.

Tagline: Governed OS for AI-enabled security companies.

## Web surfaces (Security Company OS)

| Nav | Purpose |
| --- | --- |
| Command | Attention, risk radar, agent status, live activity |
| Operations | Unified coordination work queue (not a second case system) |
| Missions | Governed mission definitions and runs |
| Teams | Workforce view (fixture until team API exists) |
| Agents | Agent scoreboard and dossiers |
| Capabilities | Capability pack catalogue (assignment still server-governed) |
| Approvals | Governance inbox for dangerous actions |
| Audit | Organisation-scoped activity and evidence links |
| Integrations | Connector and platform health (no secrets) |
| Settings | Slack and administration |

## Agent pack (Australian dog names)

| Agent | Vibe | Helps with |
| --- | --- | --- |
| **Parker** | Border Collie — focused ops lead | Executive/ops briefs, Kelpie case summaries (default Slack agent) |
| **Jessie** | Border Collie — hunter | Tawny hosts, UniFi traffic, bounded hunts |
| **Alfie** | Bearded Collie — researcher | Threat research, feeds, evidence-backed briefs |

Address in Slack: `Hey Jessie …`, `talk to Alfie …`, bare message → Parker.

## Brand Personality

Credible, utilitarian, restrained. Calm under pressure, precise about state and
authority. Direct, evidence-led language. Agents sound human and keen in Slack;
the web UI stays dense and operational.

## Anti-references

- Generic admin-template reskins and decorative executive dashboards
- Neon cyberpunk / Matrix treatments
- Cartoon mascots or robot emoji as agent identity in product chrome
- AI sparkle iconography and hype-heavy autonomy claims
- Slack branding or copied proprietary assets
- Interfaces that blur mocks, recommendations, approvals, and executed actions
- A second chat product inside Muster web
- Browser-side authoritative domain stores or simulated live company clocks

## Design Principles

1. Web UI answers: what needs attention, what is blocked, are agents and connectors healthy, and what was decided?
2. Dangerous actions stay capability-checked and approval-gated.
3. Evidence and provenance stay explicit; connector content is untrusted.
4. Prefer boring, readable ops UI over novelty.
5. Chat and investigation conversation stay in Slack/Hermes/Kelpie where they belong.
6. Organisation scoping is server-enforced; customer context is prepared but not fully portfolio-built yet.

## Accessibility & Inclusion

Target WCAG 2.2 AA where practical. Keyboard navigation, visible focus, semantic
structure, reduced motion, high contrast, non-colour-only status. Desktop primary.
